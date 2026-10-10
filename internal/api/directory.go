package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/lieyanc/FireSSL/internal/auth"
	"github.com/lieyanc/FireSSL/internal/config"
	"github.com/lieyanc/FireSSL/internal/iam"
)

// Users and tenants as the API presents them (never with password hashes).

type userView struct {
	ID        string           `json:"id"`
	Username  string           `json:"username"`
	Admin     bool             `json:"admin"`
	Disabled  bool             `json:"disabled"`
	CreatedAt time.Time        `json:"createdAt"`
	Tenants   []iam.Membership `json:"tenants"`
}

func (s *Server) userView(u iam.User) userView {
	return userView{ID: u.ID, Username: u.Username, Admin: u.Admin, Disabled: u.Disabled,
		CreatedAt: u.CreatedAt, Tenants: s.Users.Memberships(u.ID)}
}

type memberView struct {
	UserID   string   `json:"userId"`
	Username string   `json:"username"`
	Role     iam.Role `json:"role"`
	Disabled bool     `json:"disabled,omitempty"`
}

type tenantView struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	MemberCount int       `json:"memberCount"`
	RecordCount int       `json:"recordCount"`
	// Detail responses only.
	Role    iam.Role     `json:"role,omitempty"` // the caller's
	Members []memberView `json:"members,omitempty"`
}

func (s *Server) tenantView(t iam.Tenant, p *auth.Principal, full bool) tenantView {
	v := tenantView{ID: t.ID, Name: t.Name, Description: t.Description, CreatedAt: t.CreatedAt,
		MemberCount: len(t.Members), RecordCount: s.PKI.TenantRecords(t.ID)}
	if full {
		v.Role, _ = s.role(p, t.ID)
		v.Members = []memberView{}
		for _, m := range t.Members {
			if u, ok := s.Users.User(m.UserID); ok {
				v.Members = append(v.Members, memberView{UserID: u.ID, Username: u.Username, Role: m.Role, Disabled: u.Disabled})
			}
		}
	}
	return v
}

// Tenants.

// listTenants returns every tenant to administrators, otherwise the
// caller's own.
func (s *Server) listTenants(w http.ResponseWriter, r *http.Request) {
	p := auth.FromContext(r.Context())
	items := []tenantView{}
	for _, t := range s.Users.Tenants() {
		if _, ok := s.role(p, t.ID); ok {
			items = append(items, s.tenantView(t, p, false))
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type tenantBody struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (s *Server) createTenant(w http.ResponseWriter, r *http.Request) {
	var b tenantBody
	if !decode(w, r, &b, 4<<10) {
		return
	}
	t, err := s.Users.CreateTenant(b.Name, b.Description)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("tenant created", "id", t.ID, "name", t.Name, "user", actor(r))
	writeJSON(w, http.StatusCreated, s.tenantView(t, auth.FromContext(r.Context()), true))
}

func (s *Server) getTenant(w http.ResponseWriter, r *http.Request) {
	p := auth.FromContext(r.Context())
	t, ok := s.Users.Tenant(r.PathValue("id"))
	if !ok {
		fail(w, http.StatusNotFound, "not_found", "tenant not found")
		return
	}
	if !s.allowed(w, p, t.ID, iam.PermView) {
		return
	}
	writeJSON(w, http.StatusOK, s.tenantView(t, p, true))
}

func (s *Server) updateTenant(w http.ResponseWriter, r *http.Request) {
	var b tenantBody
	if !decode(w, r, &b, 4<<10) {
		return
	}
	t, err := s.Users.UpdateTenant(r.PathValue("id"), b.Name, b.Description)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("tenant updated", "id", t.ID, "name", t.Name, "user", actor(r))
	writeJSON(w, http.StatusOK, s.tenantView(t, auth.FromContext(r.Context()), true))
}

func (s *Server) deleteTenant(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if n := s.PKI.TenantRecords(id); n > 0 {
		failErr(w, &config.ConflictError{Msg: "the tenant still owns CAs or certificates; delete them or assign its CAs elsewhere first"})
		return
	}
	if err := s.Users.DeleteTenant(id); err != nil {
		failErr(w, err)
		return
	}
	slog.Info("tenant deleted", "id", id, "user", actor(r))
	w.WriteHeader(http.StatusNoContent)
}

// Members. Owners manage their tenant's members; administrators all.

func (s *Server) setMember(w http.ResponseWriter, r *http.Request) {
	p := auth.FromContext(r.Context())
	tid := r.PathValue("id")
	if !s.allowed(w, p, tid, iam.PermMembers) {
		return
	}
	var b struct {
		Username string   `json:"username"`
		Role     iam.Role `json:"role"`
	}
	if !decode(w, r, &b, 4<<10) {
		return
	}
	u, ok := s.Users.UserByName(b.Username)
	if !ok {
		failErr(w, &config.FieldError{Field: "username", Msg: "no user with this name"})
		return
	}
	if !p.Admin && b.Role != iam.RoleOwner && s.lastOwner(tid, u.ID) {
		failErr(w, &config.ConflictError{Msg: "a tenant needs at least one owner"})
		return
	}
	t, err := s.Users.SetMember(tid, u.ID, b.Role)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("tenant member set", "tenant", tid, "member", u.Username, "role", b.Role, "user", actor(r))
	writeJSON(w, http.StatusOK, s.tenantView(t, p, true))
}

func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	p := auth.FromContext(r.Context())
	tid, uid := r.PathValue("id"), r.PathValue("userId")
	if !s.allowed(w, p, tid, iam.PermMembers) {
		return
	}
	if !p.Admin && s.lastOwner(tid, uid) {
		failErr(w, &config.ConflictError{Msg: "a tenant needs at least one owner"})
		return
	}
	t, err := s.Users.RemoveMember(tid, uid)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("tenant member removed", "tenant", tid, "member", uid, "user", actor(r))
	writeJSON(w, http.StatusOK, s.tenantView(t, p, true))
}

// lastOwner reports whether userID is the only owner of a tenant. Owners
// may not leave their tenant ownerless; administrators may.
func (s *Server) lastOwner(tenantID, userID string) bool {
	t, _ := s.Users.Tenant(tenantID)
	owners, isOwner := 0, false
	for _, m := range t.Members {
		if m.Role == iam.RoleOwner {
			owners++
			isOwner = isOwner || m.UserID == userID
		}
	}
	return isOwner && owners == 1
}

// Users (administrators only).

func (s *Server) listUsers(w http.ResponseWriter, _ *http.Request) {
	items := []userView{}
	for _, u := range s.Users.Users() {
		items = append(items, s.userView(u))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Admin    bool   `json:"admin"`
	}
	if !decode(w, r, &b, 4<<10) {
		return
	}
	u, err := s.Auth.CreateUser(b.Username, b.Password, b.Admin)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("user created", "id", u.ID, "username", u.Username, "admin", u.Admin, "user", actor(r))
	writeJSON(w, http.StatusCreated, s.userView(u))
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	var b auth.UserChange
	if !decode(w, r, &b, 4<<10) {
		return
	}
	p := auth.FromContext(r.Context())
	id := r.PathValue("id")
	if id == p.ID && ((b.Admin != nil && !*b.Admin) || (b.Disabled != nil && *b.Disabled)) {
		failErr(w, &config.ConflictError{Msg: "you cannot disable your own account or remove your own administrator rights"})
		return
	}
	u, err := s.Auth.UpdateUser(id, b)
	if err != nil {
		failErr(w, err)
		return
	}
	if id == p.ID && b.Password != nil {
		// The new password signed out this session too; keep it.
		s.Auth.SetSession(w, r, p)
	}
	slog.Info("user updated", "id", u.ID, "username", u.Username, "admin", u.Admin, "disabled", u.Disabled,
		"passwordReset", b.Password != nil, "user", actor(r))
	writeJSON(w, http.StatusOK, s.userView(u))
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == auth.FromContext(r.Context()).ID {
		failErr(w, &config.ConflictError{Msg: "you cannot delete your own account"})
		return
	}
	if err := s.Users.DeleteUser(id); err != nil {
		failErr(w, err)
		return
	}
	slog.Info("user deleted", "id", id, "user", actor(r))
	w.WriteHeader(http.StatusNoContent)
}
