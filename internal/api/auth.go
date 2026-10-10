package api

import (
	"log/slog"
	"net/http"

	"github.com/lieyanc/FireSSL/internal/auth"
	"github.com/lieyanc/FireSSL/internal/iam"
)

func (s *Server) authState(w http.ResponseWriter, r *http.Request) {
	p := auth.FromContext(r.Context())
	out := map[string]any{"initialized": s.Auth.Initialized(), "setupAvailable": s.Auth.SetupAvailable(), "authenticated": p != nil}
	if p != nil {
		out["username"] = p.Username
		out["user"] = map[string]any{"id": p.ID, "username": p.Username, "admin": p.Admin}
		// Administrators act as owners of every tenant.
		tenants := s.Users.Memberships(p.ID)
		if p.Admin {
			tenants = []iam.Membership{}
			for _, t := range s.Users.Tenants() {
				tenants = append(tenants, iam.Membership{TenantID: t.ID, TenantName: t.Name, Role: iam.RoleOwner})
			}
		}
		out["tenants"] = tenants
	}
	writeJSON(w, http.StatusOK, out)
}

type credentials struct {
	SetupToken string `json:"setupToken,omitempty"`
	Username   string `json:"username"`
	Password   string `json:"password"`
}

type account struct {
	Username string `json:"username"`
}

func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	var b credentials
	if !decode(w, r, &b, 4<<10) {
		return
	}
	recovery := s.Store.Get().Auth.Recovery
	p, err := s.Auth.Setup(b.SetupToken, b.Username, b.Password)
	if err != nil {
		slog.Warn("admin setup failed", "client", auth.ClientIP(r), "err", err)
		failErr(w, err)
		return
	}
	slog.Info("admin account set up", "username", p.Username, "recovery", recovery, "client", auth.ClientIP(r))
	s.Auth.SetSession(w, r, p)
	writeJSON(w, http.StatusOK, account{p.Username})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var b credentials
	if !decode(w, r, &b, 4<<10) {
		return
	}
	ip := auth.ClientIP(r)
	p, err := s.Auth.Login(b.Username, b.Password, ip)
	if err != nil {
		slog.Warn("login failed", "username", b.Username, "client", ip, "err", err)
		failErr(w, err)
		return
	}
	s.Auth.SetSession(w, r, p)
	slog.Info("login succeeded", "username", p.Username, "client", ip)
	writeJSON(w, http.StatusOK, account{p.Username})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	auth.ClearSession(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var b struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
		Username        string `json:"username"`
	}
	if !decode(w, r, &b, 4<<10) {
		return
	}
	p, err := s.Auth.ChangeCredentials(auth.FromContext(r.Context()), b.CurrentPassword, b.NewPassword, b.Username)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("credentials changed", "username", p.Username, "client", auth.ClientIP(r))
	// Other sessions are signed out by the new generation; keep this one.
	s.Auth.SetSession(w, r, p)
	writeJSON(w, http.StatusOK, account{p.Username})
}
