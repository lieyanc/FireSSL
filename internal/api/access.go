package api

import (
	"net/http"

	"github.com/lieyanc/FireSSL/internal/auth"
	"github.com/lieyanc/FireSSL/internal/iam"
	"github.com/lieyanc/FireSSL/internal/pki"
)

// TenantHeader selects the tenant an inventory request works in. Without
// it a system administrator works across the whole platform.
const TenantHeader = "X-FireSSL-Tenant"

// scope resolves the caller's tenant and checks perm in it, writing the
// error response when the request is denied.
func (s *Server) scope(w http.ResponseWriter, r *http.Request, perm iam.Perm) (pki.Scope, bool) {
	p := auth.FromContext(r.Context())
	id := r.Header.Get(TenantHeader)
	if id == "" {
		if p.Admin {
			return pki.Platform, true
		}
		fail(w, http.StatusForbidden, "tenant_required", "select a tenant to work in")
		return pki.Scope{}, false
	}
	if !s.allowed(w, p, id, perm) {
		return pki.Scope{}, false
	}
	return pki.Scope{Tenant: id}, true
}

// allowed checks perm in a tenant, writing the error response if denied.
func (s *Server) allowed(w http.ResponseWriter, p *auth.Principal, tenantID string, perm iam.Perm) bool {
	role, ok := s.role(p, tenantID)
	if !ok {
		fail(w, http.StatusForbidden, "forbidden", "you are not a member of this tenant")
		return false
	}
	if !role.Can(perm) {
		fail(w, http.StatusForbidden, "forbidden", "your role in this tenant does not allow this")
		return false
	}
	return true
}

// role is the caller's role in a tenant; administrators act as owners.
func (s *Server) role(p *auth.Principal, tenantID string) (iam.Role, bool) {
	if _, ok := s.Users.Tenant(tenantID); !ok {
		return "", false
	}
	if p.Admin {
		return iam.RoleOwner, true
	}
	return s.Users.Role(tenantID, p.ID)
}

// adminOnly restricts a handler to system administrators.
func adminOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if p := auth.FromContext(r.Context()); p == nil || !p.Admin {
			fail(w, http.StatusForbidden, "forbidden", "only a system administrator can do this")
			return
		}
		h(w, r)
	}
}

// actor names the caller in audit logs.
func actor(r *http.Request) string {
	if p := auth.FromContext(r.Context()); p != nil {
		return p.Username
	}
	return ""
}

// managePerm is what changing a record of kind takes.
func managePerm(kind string) iam.Perm {
	if kind == pki.KindCA {
		return iam.PermManageCA
	}
	return iam.PermIssue
}
