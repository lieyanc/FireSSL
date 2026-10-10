// Package auth implements the administrator login: a bcrypt password stored
// in the config, HMAC-signed session cookies, a one-time setup token for the
// first start (or after -reset-auth) and brute-force throttling.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"github.com/lieyanc/FireSSL/internal/config"
)

const CookieName = "firessl_session"

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrNotInitialized     = errors.New("admin account not set up")
	ErrInitialized        = errors.New("admin account already set up")
	ErrBadSetupToken      = errors.New("invalid setup token")
)

// RateLimitError means the client must wait before trying again.
type RateLimitError struct{ RetryAfter time.Duration }

func (e *RateLimitError) Error() string {
	return fmt.Sprintf("too many failed attempts, retry in %s", e.RetryAfter.Round(time.Second))
}

// Principal is an authenticated caller.
type Principal struct {
	Username string
}

type ctxKey struct{}

func NewContext(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// FromContext returns the caller, or nil for anonymous requests.
func FromContext(ctx context.Context) *Principal {
	p, _ := ctx.Value(ctxKey{}).(*Principal)
	return p
}

type Service struct {
	store    *config.Store
	throttle *throttle

	mu         sync.Mutex
	setupToken string
}

func New(store *config.Store) *Service {
	return &Service{store: store, throttle: newThrottle(), setupToken: randomString(12)}
}

// Initialized reports whether the administrator can sign in.
func (s *Service) Initialized() bool {
	a := s.store.Get().Auth
	return a.Username != "" && a.PasswordHash != ""
}

// SetupAvailable reports whether the setup token may (re)create the
// administrator: before the first start completes, or after -reset-auth.
func (s *Service) SetupAvailable() bool {
	return s.store.Get().Auth.Recovery || !s.Initialized()
}

// SetupToken is the one-time secret required to create the administrator;
// empty when setup is unavailable.
func (s *Service) SetupToken() string {
	if !s.SetupAvailable() {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.setupToken
}

// Setup creates the administrator, or replaces it in recovery mode.
func (s *Service) Setup(token, username, pass string) error {
	if !s.SetupAvailable() {
		return ErrInitialized
	}
	s.mu.Lock()
	want := s.setupToken
	s.mu.Unlock()
	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(token)), []byte(want)) != 1 {
		return ErrBadSetupToken
	}
	if err := ValidateUsername("username", username); err != nil {
		return err
	}
	if err := validatePassword("password", pass); err != nil {
		return err
	}
	hash, err := hashPassword(pass)
	if err != nil {
		return err
	}
	_, err = s.store.Update(func(c *config.Config) error {
		if !c.Auth.Recovery && c.Auth.Username != "" && c.Auth.PasswordHash != "" {
			return ErrInitialized
		}
		c.Auth.Username, c.Auth.PasswordHash = username, hash
		c.Auth.Recovery = false
		// A new secret signs out every session of a replaced administrator.
		c.Auth.SessionSecret = randomString(32)
		return nil
	})
	if err == nil {
		s.mu.Lock()
		s.setupToken = randomString(12)
		s.mu.Unlock()
	}
	return err
}

// Login checks credentials, throttling per client IP.
func (s *Service) Login(username, pass, ip string) (*Principal, error) {
	if !s.Initialized() {
		return nil, ErrNotInitialized
	}
	if wait := s.throttle.blocked(ip); wait > 0 {
		return nil, &RateLimitError{wait}
	}
	a := s.store.Get().Auth
	hash := dummyHash
	match := subtle.ConstantTimeCompare([]byte(username), []byte(a.Username)) == 1
	if match {
		hash = a.PasswordHash
	}
	// Always run bcrypt so response time does not reveal the username.
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(pass)) != nil || !match {
		s.throttle.fail(ip)
		return nil, ErrInvalidCredentials
	}
	s.throttle.reset(ip)
	return &Principal{Username: a.Username}, nil
}

// dummyHash keeps unknown usernames as slow as real ones.
var dummyHash, _ = hashPassword(randomString(16))

// ChangeCredentials verifies the current password and sets a new password
// and optionally a new username, signing out all other sessions.
func (s *Service) ChangeCredentials(current, next, username string) (*Principal, error) {
	if username != "" {
		if err := ValidateUsername("username", username); err != nil {
			return nil, err
		}
	}
	if err := validatePassword("newPassword", next); err != nil {
		return nil, err
	}
	hash, err := hashPassword(next)
	if err != nil {
		return nil, err
	}
	c, err := s.store.Update(func(c *config.Config) error {
		if bcrypt.CompareHashAndPassword([]byte(c.Auth.PasswordHash), []byte(current)) != nil {
			return &config.FieldError{Field: "currentPassword", Msg: "current password is incorrect"}
		}
		if username != "" {
			c.Auth.Username = username
		}
		c.Auth.PasswordHash = hash
		c.Auth.SessionSecret = randomString(32)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &Principal{Username: c.Auth.Username}, nil
}

func ValidateUsername(field, name string) error {
	if n := utf8.RuneCountInString(name); n < 1 || n > 64 {
		return &config.FieldError{Field: field, Msg: "username must be 1-64 characters"}
	}
	for _, r := range name {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return &config.FieldError{Field: field, Msg: "username must not contain spaces"}
		}
	}
	return nil
}

func validatePassword(field, pass string) error {
	if n := utf8.RuneCountInString(pass); n < 8 || n > 128 {
		return &config.FieldError{Field: field, Msg: "password must be 8-128 characters"}
	}
	return nil
}

func hashPassword(pass string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	return string(h), err
}

// Sessions: value = base64url(username|expiry) "." base64url(hmac). The
// secret rotates whenever the credentials change.

func sign(secret, payload string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// SetSession issues a session cookie for the administrator.
func (s *Service) SetSession(w http.ResponseWriter, r *http.Request) {
	a := s.store.Get().Auth
	exp := time.Now().Add(time.Duration(a.SessionTTL) * time.Second)
	payload := a.Username + "|" + strconv.FormatInt(exp.Unix(), 10)
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sign(a.SessionSecret, payload),
		Path:     "/",
		Expires:  exp,
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func ClearSession(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteLaxMode,
	})
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// Authenticate returns the caller, or nil.
func (s *Service) Authenticate(r *http.Request) *Principal {
	c, err := r.Cookie(CookieName)
	if err != nil {
		return nil
	}
	enc, sig, ok := strings.Cut(c.Value, ".")
	if !ok {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return nil
	}
	payload := string(raw)
	name, expiry, ok := strings.Cut(payload, "|")
	if !ok {
		return nil
	}
	exp, err := strconv.ParseInt(expiry, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return nil
	}
	a := s.store.Get().Auth
	if a.SessionSecret == "" || a.PasswordHash == "" || name != a.Username ||
		!hmac.Equal([]byte(sig), []byte(sign(a.SessionSecret, payload))) {
		return nil
	}
	return &Principal{Username: name}
}

func randomString(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)[:n]
}

// ClientIP returns the peer IP. X-Forwarded-For / X-Real-IP are honored only
// from a loopback peer (a reverse proxy on the same host) so remote clients
// cannot spoof their address to dodge throttling.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			first, _, _ := strings.Cut(xff, ",")
			return strings.TrimSpace(first)
		}
		if xr := r.Header.Get("X-Real-IP"); xr != "" {
			return strings.TrimSpace(xr)
		}
	}
	return host
}

// throttle blocks an IP after repeated login failures, doubling the lockout.
type throttle struct {
	mu sync.Mutex
	m  map[string]*attempts
}

type attempts struct {
	fails int
	last  time.Time
	until time.Time
}

const (
	freeAttempts = 5
	baseLockout  = time.Minute
	maxLockout   = 15 * time.Minute
	failWindow   = 15 * time.Minute
)

func newThrottle() *throttle { return &throttle{m: make(map[string]*attempts)} }

func (t *throttle) blocked(ip string) time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	if a := t.m[ip]; a != nil {
		return time.Until(a.until)
	}
	return 0
}

func (t *throttle) fail(ip string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	for k, a := range t.m { // opportunistic cleanup
		if now.Sub(a.last) > failWindow && now.After(a.until) {
			delete(t.m, k)
		}
	}
	a := t.m[ip]
	if a == nil {
		a = &attempts{}
		t.m[ip] = a
	}
	a.fails++
	a.last = now
	if over := a.fails - freeAttempts; over >= 0 {
		a.until = now.Add(min(baseLockout<<min(over, 10), maxLockout))
	}
}

func (t *throttle) reset(ip string) {
	t.mu.Lock()
	delete(t.m, ip)
	t.mu.Unlock()
}
