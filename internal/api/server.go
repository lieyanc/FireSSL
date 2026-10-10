// Package api serves the REST API, the public CRL/CA endpoints and the
// embedded web UI.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/lieyanc/FireSSL/internal/auth"
	"github.com/lieyanc/FireSSL/internal/config"
	"github.com/lieyanc/FireSSL/internal/iam"
	"github.com/lieyanc/FireSSL/internal/pki"
	"github.com/lieyanc/FireSSL/internal/updater"
)

type Deps struct {
	Store   *config.Store
	PKI     *pki.Store
	Users   *iam.Store
	Auth    *auth.Service
	Updater *updater.Updater
	Started time.Time
	// SetLogLevel applies a new log level at runtime.
	SetLogLevel func(level string)
	// Restart re-execs the process; nil where unsupported.
	Restart func() error
	Web     fs.FS
}

type Server struct {
	Deps
	boot   *config.Config // config the process started with, for restart detection
	static *staticFS
	srv    *http.Server
}

// Start listens on the configured address and serves in the background.
func Start(d Deps) (*Server, error) {
	s := &Server{Deps: d, boot: d.Store.Get()}
	s.static = newStaticFS(d.Web)
	addr := net.JoinHostPort(s.boot.Server.Host, strconv.Itoa(s.boot.Server.Port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	s.srv = &http.Server{
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelDebug),
	}
	go s.srv.Serve(ln)
	slog.Info("web UI and API started", "addr", "http://"+addr)
	return s, nil
}

func (s *Server) Close() error { return s.srv.Close() }

// Handler exposes the routes for tests.
func (s *Server) Handler() http.Handler { return s.routes() }

// NewForTest builds a server without listening.
func NewForTest(d Deps) *Server {
	return &Server{Deps: d, boot: d.Store.Get(), static: newStaticFS(d.Web)}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	h := mux.HandleFunc

	// Public.
	h("GET /health", s.health)
	h("GET /api/version", s.version)
	h("GET /api/auth/state", s.authState)
	h("POST /api/auth/setup", s.setup)
	h("POST /api/auth/login", s.login)
	// Relying parties fetch revocation lists and issuer certificates
	// without credentials (CRL distribution point / AIA URLs).
	h("GET /crl/{file}", s.publicCRL)
	h("GET /ca/{file}", s.publicCACert)

	// Authenticated (enforced by withAuth for everything else under /api).
	// Inventory routes work in the tenant named by the TenantHeader.
	h("POST /api/auth/logout", s.logout)
	h("POST /api/auth/password", s.changePassword)

	h("GET /api/overview", s.overview)
	h("GET /api/pki/defaults", s.pkiDefaults)
	s.recordRoutes(mux, "/api/authorities", pki.KindCA)
	s.recordRoutes(mux, "/api/certificates", pki.KindLeaf)
	h("POST /api/authorities", s.createCA)
	h("POST /api/authorities/import", adminOnly(s.importCA))
	h("POST /api/authorities/{id}/tenant", adminOnly(s.assignTenant))
	h("POST /api/certificates", s.issue)
	h("POST /api/certificates/csr", s.signCSR)
	h("POST /api/certificates/{id}/renew", s.renew)
	h("POST /api/inspect", s.inspect)

	h("GET /api/tenants", s.listTenants)
	h("POST /api/tenants", adminOnly(s.createTenant))
	h("GET /api/tenants/{id}", s.getTenant)
	h("PATCH /api/tenants/{id}", adminOnly(s.updateTenant))
	h("DELETE /api/tenants/{id}", adminOnly(s.deleteTenant))
	h("PUT /api/tenants/{id}/members", s.setMember)
	h("DELETE /api/tenants/{id}/members/{userId}", s.removeMember)

	h("GET /api/users", adminOnly(s.listUsers))
	h("POST /api/users", adminOnly(s.createUser))
	h("PATCH /api/users/{id}", adminOnly(s.updateUser))
	h("DELETE /api/users/{id}", adminOnly(s.deleteUser))

	h("GET /api/settings", adminOnly(s.getSettings))
	h("PUT /api/settings", adminOnly(s.putSettings))
	h("POST /api/system/restart", adminOnly(s.restart))

	h("GET /api/update/status", adminOnly(s.updateStatus))
	h("POST /api/update/check", adminOnly(s.updateCheck))
	h("POST /api/update/apply", adminOnly(s.updateApply))
	h("POST /api/update/dismiss", adminOnly(s.updateDismiss))

	h("/api/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "not_found", "endpoint "+r.Method+" "+r.URL.Path+" not found")
	})
	mux.Handle("/", s.static)

	return s.withRecover(s.withHeaders(s.withAuth(mux)))
}

var publicPaths = map[string]bool{
	"/api/version":    true,
	"/api/auth/state": true,
	"/api/auth/setup": true,
	"/api/auth/login": true,
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		// Browsers attach cookies to cross-site requests; reject those for
		// state-changing calls.
		if unsafeMethod(r.Method) && crossSite(r) {
			fail(w, http.StatusForbidden, "forbidden", "cross-site request rejected")
			return
		}
		p := s.Auth.Authenticate(r)
		if p == nil && !publicPaths[r.URL.Path] {
			fail(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		if p != nil {
			r = r.WithContext(auth.NewContext(r.Context(), p))
		}
		next.ServeHTTP(w, r)
	})
}

func unsafeMethod(m string) bool {
	return m != http.MethodGet && m != http.MethodHead && m != http.MethodOptions
}

func crossSite(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	return err != nil || !strings.EqualFold(u.Host, r.Host)
}

func (s *Server) withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.Error("panic in HTTP handler", "path", r.URL.Path, "panic", v)
				fail(w, http.StatusInternalServerError, "internal", "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// Response helpers.

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func fail(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, apiError{Error: errCode, Message: msg})
}

// failErr maps domain errors to HTTP responses.
func failErr(w http.ResponseWriter, err error) {
	var (
		fe *config.FieldError
		ce *config.ConflictError
		fb *config.ForbiddenError
		rl *auth.RateLimitError
	)
	switch {
	case errors.As(err, &fe):
		writeJSON(w, http.StatusBadRequest, apiError{"validation", fe.Msg, fe.Field})
	case errors.As(err, &ce):
		fail(w, http.StatusConflict, "conflict", ce.Msg)
	case errors.As(err, &fb):
		fail(w, http.StatusForbidden, "forbidden", fb.Msg)
	case errors.Is(err, pki.ErrNotFound), errors.Is(err, iam.ErrNotFound):
		fail(w, http.StatusNotFound, "not_found", err.Error())
	case errors.As(err, &rl):
		w.Header().Set("Retry-After", strconv.Itoa(int(rl.RetryAfter.Seconds())+1))
		fail(w, http.StatusTooManyRequests, "rate_limited", rl.Error())
	case errors.Is(err, auth.ErrInvalidCredentials):
		fail(w, http.StatusUnauthorized, "unauthorized", err.Error())
	case errors.Is(err, auth.ErrBadSetupToken):
		fail(w, http.StatusForbidden, "forbidden", err.Error())
	case errors.Is(err, auth.ErrInitialized):
		fail(w, http.StatusConflict, "already_initialized", err.Error())
	case errors.Is(err, auth.ErrNotInitialized):
		fail(w, http.StatusConflict, "not_initialized", err.Error())
	default:
		slog.Error("request failed", "err", err)
		fail(w, http.StatusInternalServerError, "internal", err.Error())
	}
}

// decode reads a JSON body of at most limit bytes into v.
func decode(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	if err := dec.Decode(v); err != nil {
		if errors.Is(err, io.EOF) {
			fail(w, http.StatusBadRequest, "bad_request", "request body is required")
		} else {
			fail(w, http.StatusBadRequest, "bad_request", "invalid JSON: "+err.Error())
		}
		return false
	}
	return true
}
