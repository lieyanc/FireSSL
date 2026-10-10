// Package auth implements sign-in for the accounts in the user directory:
// bcrypt passwords, HMAC-signed session cookies, a one-time setup token for
// the first start (or after -reset-auth) and brute-force throttling.
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
	"github.com/lieyanc/FireSSL/internal/iam"
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
	ID       string
	Username string
	Admin    bool
}

func principal(u iam.User) *Principal {
	return &Principal{ID: u.ID, Username: u.Username, Admin: u.Admin}
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
	users    *iam.Store
	throttle *throttle

	mu         sync.Mutex
	setupToken string
}

// New returns the service, first moving the single administrator of
// earlier releases from the config file into the directory.
func New(store *config.Store, users *iam.Store) (*Service, error) {
	s := &Service{store: store, users: users, throttle: newThrottle(), setupToken: randomString(12)}
	a := store.Get().Auth
	if a.Username == "" || a.PasswordHash == "" {
		return s, nil
	}
	if _, ok := users.UserByName(a.Username); !ok {
		if _, err := users.CreateUser(iam.User{Username: a.Username, PasswordHash: a.PasswordHash, Admin: true}); err != nil {
			return nil, fmt.Errorf("migrate administrator: %w", err)
		}
	}
	if _, err := store.Update(func(c *config.Config) error {
		c.Auth.Username, c.Auth.PasswordHash = "", ""
		return nil
	}); err != nil {
		return nil, fmt.Errorf("migrate administrator: %w", err)
	}
	return s, nil
}

// Initialized reports whether a system administrator can sign in.
func (s *Service) Initialized() bool {
	return s.users.HasAdmin()
}

// SetupAvailable reports whether the setup token may create a system
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

// Setup creates the first system administrator. In recovery mode it
// instead resets the named account (creating it if needed) to an enabled
// administrator with the given password.
func (s *Service) Setup(token, username, pass string) (*Principal, error) {
	if !s.SetupAvailable() {
		return nil, ErrInitialized
	}
	s.mu.Lock()
	want := s.setupToken
	s.mu.Unlock()
	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(token)), []byte(want)) != 1 {
		return nil, ErrBadSetupToken
	}
	if err := ValidateUsername("username", username); err != nil {
		return nil, err
	}
	if err := ValidatePassword("password", pass); err != nil {
		return nil, err
	}
	hash, err := HashPassword(pass)
	if err != nil {
		return nil, err
	}
	recovery := s.store.Get().Auth.Recovery
	if !recovery && s.Initialized() {
		return nil, ErrInitialized
	}
	var u iam.User
	if existing, ok := s.users.UserByName(username); ok {
		u, err = s.users.UpdateUser(existing.ID, func(u *iam.User) error {
			u.PasswordHash, u.Admin, u.Disabled = hash, true, false
			u.SessionGen++
			return nil
		})
	} else {
		u, err = s.users.CreateUser(iam.User{Username: username, PasswordHash: hash, Admin: true})
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.store.Update(func(c *config.Config) error {
		c.Auth.Recovery = false
		// A new secret signs out every session.
		c.Auth.SessionSecret = randomString(32)
		return nil
	}); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.setupToken = randomString(12)
	s.mu.Unlock()
	return principal(u), nil
}

// Login checks credentials, throttling per client IP.
func (s *Service) Login(username, pass, ip string) (*Principal, error) {
	if !s.Initialized() {
		return nil, ErrNotInitialized
	}
	if wait := s.throttle.blocked(ip); wait > 0 {
		return nil, &RateLimitError{wait}
	}
	u, match := s.users.UserByName(username)
	hash := dummyHash
	if match {
		hash = u.PasswordHash
	}
	// Always run bcrypt so response time does not reveal the username.
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(pass)) != nil || !match || u.Disabled {
		s.throttle.fail(ip)
		return nil, ErrInvalidCredentials
	}
	s.throttle.reset(ip)
	return principal(u), nil
}

// dummyHash keeps unknown usernames as slow as real ones.
var dummyHash, _ = HashPassword(randomString(16))

// ChangeCredentials verifies the caller's current password and sets a new
// password and optionally a new username, signing out their other sessions.
func (s *Service) ChangeCredentials(p *Principal, current, next, username string) (*Principal, error) {
	if username != "" {
		if err := ValidateUsername("username", username); err != nil {
			return nil, err
		}
	}
	if err := ValidatePassword("newPassword", next); err != nil {
		return nil, err
	}
	hash, err := HashPassword(next)
	if err != nil {
		return nil, err
	}
	u, err := s.users.UpdateUser(p.ID, func(u *iam.User) error {
		if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(current)) != nil {
			return &config.FieldError{Field: "currentPassword", Msg: "current password is incorrect"}
		}
		if username != "" {
			u.Username = username
		}
		u.PasswordHash = hash
		u.SessionGen++
		return nil
	})
	if err != nil {
		return nil, err
	}
	return principal(u), nil
}

// UserChange is an administrator's edit of an account; nil fields are kept.
type UserChange struct {
	Username *string `json:"username"`
	Password *string `json:"password"`
	Admin    *bool   `json:"admin"`
	Disabled *bool   `json:"disabled"`
}

// CreateUser adds an account.
func (s *Service) CreateUser(username, pass string, admin bool) (iam.User, error) {
	if err := ValidateUsername("username", username); err != nil {
		return iam.User{}, err
	}
	if err := ValidatePassword("password", pass); err != nil {
		return iam.User{}, err
	}
	hash, err := HashPassword(pass)
	if err != nil {
		return iam.User{}, err
	}
	return s.users.CreateUser(iam.User{Username: username, PasswordHash: hash, Admin: admin})
}

// UpdateUser applies an administrator's change. A new password or
// disabling the account signs out its sessions.
func (s *Service) UpdateUser(id string, c UserChange) (iam.User, error) {
	if c.Username != nil {
		if err := ValidateUsername("username", *c.Username); err != nil {
			return iam.User{}, err
		}
	}
	var hash string
	if c.Password != nil {
		if err := ValidatePassword("password", *c.Password); err != nil {
			return iam.User{}, err
		}
		var err error
		if hash, err = HashPassword(*c.Password); err != nil {
			return iam.User{}, err
		}
	}
	return s.users.UpdateUser(id, func(u *iam.User) error {
		if c.Username != nil {
			u.Username = *c.Username
		}
		if c.Admin != nil {
			u.Admin = *c.Admin
		}
		if hash != "" {
			u.PasswordHash = hash
			u.SessionGen++
		}
		if c.Disabled != nil {
			if *c.Disabled && !u.Disabled {
				u.SessionGen++
			}
			u.Disabled = *c.Disabled
		}
		return nil
	})
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

func ValidatePassword(field, pass string) error {
	if n := utf8.RuneCountInString(pass); n < 8 || n > 128 {
		return &config.FieldError{Field: field, Msg: "password must be 8-128 characters"}
	}
	return nil
}

func HashPassword(pass string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	return string(h), err
}

// Sessions: value = base64url(userID|generation|expiry) "." base64url(hmac).
// The secret rotates on setup; a user's generation changes with their
// password or when they are disabled.

func sign(secret, payload string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// SetSession issues a session cookie for p.
func (s *Service) SetSession(w http.ResponseWriter, r *http.Request, p *Principal) {
	u, ok := s.users.User(p.ID)
	if !ok {
		return
	}
	a := s.store.Get().Auth
	exp := time.Now().Add(time.Duration(a.SessionTTL) * time.Second)
	payload := u.ID + "|" + strconv.Itoa(u.SessionGen) + "|" + strconv.FormatInt(exp.Unix(), 10)
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
	parts := strings.Split(payload, "|")
	if len(parts) != 3 {
		return nil
	}
	exp, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return nil
	}
	secret := s.store.Get().Auth.SessionSecret
	if secret == "" || !hmac.Equal([]byte(sig), []byte(sign(secret, payload))) {
		return nil
	}
	u, ok := s.users.User(parts[0])
	if !ok || u.Disabled || strconv.Itoa(u.SessionGen) != parts[1] {
		return nil
	}
	return principal(u)
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
