package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lieyanc/FireSSL/internal/auth"
	"github.com/lieyanc/FireSSL/internal/config"
	"github.com/lieyanc/FireSSL/internal/pki"
)

type client struct {
	t      *testing.T
	h      http.Handler
	cookie *http.Cookie
}

func (c *client) do(method, path string, body any, hdr ...string) *httptest.ResponseRecorder {
	c.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	r := httptest.NewRequest(method, path, &buf)
	r.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(hdr); i += 2 {
		r.Header.Set(hdr[i], hdr[i+1])
	}
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	for _, ck := range w.Result().Cookies() {
		if ck.Name == auth.CookieName {
			c.cookie = ck
		}
	}
	return w
}

func setupServer(t *testing.T) (*client, *auth.Service) {
	t.Helper()
	dir := t.TempDir()
	store, _, err := config.Open(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	p, err := pki.Open(store.DataDir(), func() pki.Options {
		return pki.Options{ExpiryWarn: 30 * 24 * time.Hour, DefaultAlg: pki.ECDSAP256, DefaultDays: 397}
	})
	if err != nil {
		t.Fatal(err)
	}
	a := auth.New(store)
	s := NewForTest(Deps{Store: store, PKI: p, Auth: a, Started: time.Now()})
	return &client{t: t, h: s.Handler()}, a
}

func TestAuthFlow(t *testing.T) {
	c, a := setupServer(t)
	if w := c.do("GET", "/api/overview", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous overview: %d", w.Code)
	}
	if w := c.do("POST", "/api/auth/setup", map[string]string{"setupToken": "wrong", "username": "admin", "password": "password123"}); w.Code != http.StatusForbidden {
		t.Fatalf("bad token: %d", w.Code)
	}
	tok := a.SetupToken()
	if w := c.do("POST", "/api/auth/setup", map[string]string{"setupToken": tok, "username": "admin", "password": "short"}); w.Code != http.StatusBadRequest {
		t.Fatalf("short password: %d", w.Code)
	}
	if w := c.do("POST", "/api/auth/setup", map[string]string{"setupToken": tok, "username": "admin", "password": "password123"}); w.Code != http.StatusOK {
		t.Fatalf("setup: %d %s", w.Code, w.Body)
	}
	if w := c.do("GET", "/api/overview", nil); w.Code != http.StatusOK {
		t.Fatalf("overview after setup: %d", w.Code)
	}
	if w := c.do("POST", "/api/auth/setup", map[string]string{"setupToken": tok, "username": "x", "password": "password123"}); w.Code != http.StatusConflict {
		t.Fatalf("second setup: %d", w.Code)
	}
	// Cross-site writes are rejected even with a valid session.
	if w := c.do("POST", "/api/auth/logout", nil, "Origin", "https://evil.example"); w.Code != http.StatusForbidden {
		t.Fatalf("cross-site logout: %d", w.Code)
	}

	// Changing the password signs out other sessions.
	old := c.cookie
	if w := c.do("POST", "/api/auth/password", map[string]string{"currentPassword": "password123", "newPassword": "password456"}); w.Code != http.StatusOK {
		t.Fatalf("change password: %d %s", w.Code, w.Body)
	}
	stale := &client{t: t, h: c.h, cookie: old}
	if w := stale.do("GET", "/api/overview", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("stale session still valid: %d", w.Code)
	}

	anon := &client{t: t, h: c.h}
	if w := anon.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "password123"}); w.Code != http.StatusUnauthorized {
		t.Fatalf("old password accepted: %d", w.Code)
	}
	if w := anon.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "password456"}); w.Code != http.StatusOK {
		t.Fatalf("login: %d", w.Code)
	}
}

func TestIssueAndDownload(t *testing.T) {
	c, a := setupServer(t)
	c.do("POST", "/api/auth/setup", map[string]string{"setupToken": a.SetupToken(), "username": "admin", "password": "password123"})

	w := c.do("POST", "/api/authorities", map[string]any{"subject": map[string]string{"commonName": "API Root"}})
	if w.Code != http.StatusCreated {
		t.Fatalf("create CA: %d %s", w.Code, w.Body)
	}
	var ca pki.View
	json.Unmarshal(w.Body.Bytes(), &ca)

	w = c.do("POST", "/api/certificates", map[string]any{"issuerId": ca.ID, "subject": map[string]string{"commonName": "bad name!"}})
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"field":"sans.dns"`) {
		t.Fatalf("validation error: %d %s", w.Code, w.Body)
	}
	w = c.do("POST", "/api/certificates", map[string]any{"issuerId": ca.ID, "subject": map[string]string{"commonName": "api.example.com"}})
	if w.Code != http.StatusCreated {
		t.Fatalf("issue: %d %s", w.Code, w.Body)
	}
	var leaf pki.View
	json.Unmarshal(w.Body.Bytes(), &leaf)

	w = c.do("GET", "/api/certificates/"+leaf.ID+"/export?format=fullchain", nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Header().Get("Content-Disposition"), "api.example.com.fullchain.pem") {
		t.Fatalf("export: %d %v", w.Code, w.Header())
	}
	if w := c.do("GET", "/api/authorities/"+leaf.ID, nil); w.Code != http.StatusNotFound {
		t.Fatalf("leaf served as CA: %d", w.Code)
	}
	if w := c.do("DELETE", "/api/authorities/"+ca.ID, nil); w.Code != http.StatusConflict {
		t.Fatalf("delete CA with certificates: %d", w.Code)
	}
	// CRLs are public.
	anon := &client{t: t, h: c.h}
	if w := anon.do("GET", "/crl/"+ca.ID+".crl", nil); w.Code != http.StatusOK || w.Header().Get("Content-Type") != "application/pkix-crl" {
		t.Fatalf("public CRL: %d", w.Code)
	}
	if w := anon.do("GET", "/api/certificates/"+leaf.ID+"/export?format=key", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous key export: %d", w.Code)
	}
}
