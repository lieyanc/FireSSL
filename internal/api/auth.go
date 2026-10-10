package api

import (
	"log/slog"
	"net/http"

	"github.com/lieyanc/FireSSL/internal/auth"
)

func (s *Server) authState(w http.ResponseWriter, r *http.Request) {
	p := auth.FromContext(r.Context())
	out := map[string]any{"initialized": s.Auth.Initialized(), "setupAvailable": s.Auth.SetupAvailable(), "authenticated": p != nil}
	if p != nil {
		out["username"] = p.Username
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
	if err := s.Auth.Setup(b.SetupToken, b.Username, b.Password); err != nil {
		slog.Warn("admin setup failed", "client", auth.ClientIP(r), "err", err)
		failErr(w, err)
		return
	}
	slog.Info("admin account set up", "username", b.Username, "recovery", recovery, "client", auth.ClientIP(r))
	s.Auth.SetSession(w, r)
	writeJSON(w, http.StatusOK, account{b.Username})
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
	s.Auth.SetSession(w, r)
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
	p, err := s.Auth.ChangeCredentials(b.CurrentPassword, b.NewPassword, b.Username)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("credentials changed", "username", p.Username, "client", auth.ClientIP(r))
	// Other sessions are signed out by the new secret; keep this one.
	s.Auth.SetSession(w, r)
	writeJSON(w, http.StatusOK, account{p.Username})
}
