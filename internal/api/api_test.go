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
	"github.com/lieyanc/FireSSL/internal/iam"
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
	users, err := iam.Open(store.DataDir())
	if err != nil {
		t.Fatal(err)
	}
	a, err := auth.New(store, users)
	if err != nil {
		t.Fatal(err)
	}
	s := NewForTest(Deps{Store: store, PKI: p, Users: users, Auth: a, Started: time.Now()})
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

func decodeJSON[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %s: %v", w.Body, err)
	}
	return v
}

func TestTenantPermissions(t *testing.T) {
	admin, a := setupServer(t)
	admin.do("POST", "/api/auth/setup", map[string]string{"setupToken": a.SetupToken(), "username": "admin", "password": "password123"})

	newUser := func(name string) *client {
		if w := admin.do("POST", "/api/users", map[string]any{"username": name, "password": "password123"}); w.Code != http.StatusCreated {
			t.Fatalf("create user %s: %d %s", name, w.Code, w.Body)
		}
		c := &client{t: t, h: admin.h}
		if w := c.do("POST", "/api/auth/login", map[string]string{"username": name, "password": "password123"}); w.Code != http.StatusOK {
			t.Fatalf("login %s: %d", name, w.Code)
		}
		return c
	}
	owner, operator, viewer, outsider := newUser("owner"), newUser("operator"), newUser("viewer"), newUser("outsider")

	if w := owner.do("GET", "/api/settings", nil); w.Code != http.StatusForbidden {
		t.Fatalf("non-admin settings: %d", w.Code)
	}
	if w := owner.do("GET", "/api/overview", nil); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "tenant_required") {
		t.Fatalf("overview without tenant: %d %s", w.Code, w.Body)
	}

	w := admin.do("POST", "/api/tenants", map[string]string{"name": "Acme"})
	if w.Code != http.StatusCreated {
		t.Fatalf("create tenant: %d %s", w.Code, w.Body)
	}
	tenant := decodeJSON[tenantView](t, w).ID
	for name, role := range map[string]string{"owner": "owner", "operator": "operator", "viewer": "viewer"} {
		if w := admin.do("PUT", "/api/tenants/"+tenant+"/members", map[string]string{"username": name, "role": role}); w.Code != http.StatusOK {
			t.Fatalf("add %s: %d %s", name, w.Code, w.Body)
		}
	}
	in := func(c *client, method, path string, body any) *httptest.ResponseRecorder {
		return c.do(method, path, body, TenantHeader, tenant)
	}

	root := decodeJSON[pki.View](t, admin.do("POST", "/api/authorities", map[string]any{"subject": map[string]string{"commonName": "Root"}}))
	if w := in(owner, "POST", "/api/authorities", map[string]any{"subject": map[string]string{"commonName": "Owner Root"}}); w.Code != http.StatusForbidden {
		t.Fatalf("owner created root: %d", w.Code)
	}
	w = admin.do("POST", "/api/authorities", map[string]any{"issuerId": root.ID, "tenantId": tenant, "subject": map[string]string{"commonName": "Acme Issuing"}})
	if w.Code != http.StatusCreated {
		t.Fatalf("tenant sub-CA: %d %s", w.Code, w.Body)
	}
	sub := decodeJSON[pki.View](t, w)

	if w := in(viewer, "POST", "/api/certificates", map[string]any{"issuerId": sub.ID, "subject": map[string]string{"commonName": "v.example.com"}}); w.Code != http.StatusForbidden {
		t.Fatalf("viewer issued: %d", w.Code)
	}
	w = in(operator, "POST", "/api/certificates", map[string]any{"issuerId": sub.ID, "subject": map[string]string{"commonName": "o.example.com"}})
	if w.Code != http.StatusCreated {
		t.Fatalf("operator issue: %d %s", w.Code, w.Body)
	}
	leaf := decodeJSON[pki.View](t, w)
	if w := in(operator, "POST", "/api/authorities", map[string]any{"issuerId": sub.ID, "subject": map[string]string{"commonName": "Op Sub"}}); w.Code != http.StatusForbidden {
		t.Fatalf("operator created sub-CA: %d", w.Code)
	}
	if w := in(owner, "POST", "/api/authorities", map[string]any{"issuerId": sub.ID, "subject": map[string]string{"commonName": "Owner Sub"}}); w.Code != http.StatusCreated {
		t.Fatalf("owner sub-CA: %d %s", w.Code, w.Body)
	}
	if w := in(viewer, "GET", "/api/certificates/"+leaf.ID+"/export?format=key", nil); w.Code != http.StatusForbidden {
		t.Fatalf("viewer key export: %d", w.Code)
	}
	if w := in(viewer, "GET", "/api/certificates/"+leaf.ID+"/export?format=fullchain", nil); w.Code != http.StatusOK {
		t.Fatalf("viewer chain export: %d", w.Code)
	}
	if w := in(owner, "GET", "/api/authorities/"+root.ID+"/export?format=key", nil); w.Code != http.StatusForbidden {
		t.Fatalf("tenant exported the root key: %d", w.Code)
	}
	if w := in(outsider, "GET", "/api/certificates", nil); w.Code != http.StatusForbidden {
		t.Fatalf("outsider listed tenant: %d", w.Code)
	}
	// Owners manage members but cannot leave the tenant ownerless.
	if w := in(operator, "PUT", "/api/tenants/"+tenant+"/members", map[string]string{"username": "outsider", "role": "viewer"}); w.Code != http.StatusForbidden {
		t.Fatalf("operator managed members: %d", w.Code)
	}
	ownerID := decodeJSON[struct{ User struct{ ID string } }](t, owner.do("GET", "/api/auth/state", nil)).User.ID
	if w := owner.do("DELETE", "/api/tenants/"+tenant+"/members/"+ownerID, nil); w.Code != http.StatusConflict {
		t.Fatalf("last owner left: %d", w.Code)
	}
	if w := admin.do("DELETE", "/api/tenants/"+tenant, nil); w.Code != http.StatusConflict {
		t.Fatalf("deleted tenant with records: %d", w.Code)
	}

	// Disabling a user ends their sessions.
	viewerID := decodeJSON[struct{ User struct{ ID string } }](t, viewer.do("GET", "/api/auth/state", nil)).User.ID
	if w := admin.do("PATCH", "/api/users/"+viewerID, map[string]any{"disabled": true}); w.Code != http.StatusOK {
		t.Fatalf("disable: %d %s", w.Code, w.Body)
	}
	if w := in(viewer, "GET", "/api/certificates", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("disabled user still signed in: %d", w.Code)
	}
}
