package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/lieyanc/FireSSL/internal/config"
	"github.com/lieyanc/FireSSL/internal/pki"
	"github.com/lieyanc/FireSSL/internal/version"
)

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"timestamp": time.Now().UTC(),
		"uptime":    int64(time.Since(s.Started).Seconds()),
	})
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, version.Info())
}

// Settings are the user-editable parts of the config.
type Settings struct {
	Server  config.ServerConfig `json:"server"`
	PKI     config.PKIConfig    `json:"pki"`
	Logging config.LogConfig    `json:"logging"`
	Update  config.UpdateConfig `json:"update"`
	// Read-only context for the UI.
	DataDir    string `json:"dataDir"`
	ConfigPath string `json:"configPath"`
	// RestartRequired reports settings saved but only applied after a restart.
	RestartRequired bool `json:"restartRequired"`
	CanRestart      bool `json:"canRestart"`
}

func (s *Server) settings() Settings {
	c := s.Store.Get()
	return Settings{
		Server: c.Server, PKI: c.PKI, Logging: c.Logging, Update: c.Update,
		DataDir: s.Store.DataDir(), ConfigPath: s.Store.Path(),
		RestartRequired: c.Server != s.boot.Server, CanRestart: s.Restart != nil,
	}
}

// pkiDefaults exposes the issuance settings every user's forms start from.
func (s *Server) pkiDefaults(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Store.Get().PKI)
}

func (s *Server) getSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.settings())
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Server  *config.ServerConfig `json:"server"`
		PKI     *config.PKIConfig    `json:"pki"`
		Logging *config.LogConfig    `json:"logging"`
		Update  *config.UpdateConfig `json:"update"`
	}
	if !decode(w, r, &b, 16<<10) {
		return
	}
	c, err := s.Store.Update(func(c *config.Config) error {
		if b.Server != nil {
			c.Server = *b.Server
		}
		if b.PKI != nil {
			if b.PKI.DefaultKeyAlgorithm != "" && !pki.ValidKeyAlgorithm(b.PKI.DefaultKeyAlgorithm) {
				return &config.FieldError{Field: "pki.defaultKeyAlgorithm", Msg: "unsupported key algorithm"}
			}
			c.PKI = *b.PKI
		}
		if b.Logging != nil {
			c.Logging = *b.Logging
		}
		if b.Update != nil {
			c.Update = *b.Update
		}
		return nil
	})
	if err != nil {
		failErr(w, err)
		return
	}
	if s.SetLogLevel != nil {
		s.SetLogLevel(c.Logging.Level)
	}
	slog.Info("settings updated", "user", actor(r))
	writeJSON(w, http.StatusOK, s.settings())
}

func (s *Server) restart(w http.ResponseWriter, _ *http.Request) {
	if s.Restart == nil {
		fail(w, http.StatusNotImplemented, "unsupported", "restart is not supported on this platform")
		return
	}
	slog.Info("restart requested from the web UI")
	w.WriteHeader(http.StatusAccepted)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		s.Restart()
	}()
}

// Update.

func (s *Server) updateStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Updater.Status())
}

func (s *Server) updateCheck(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	res, err := s.Updater.CheckOnly(ctx)
	if err != nil {
		fail(w, http.StatusBadGateway, "internal", "update check failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) updateApply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Force bool `json:"force"`
	}
	// An empty body preserves the wait-for-idle behavior.
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	if err := dec.Decode(&body); err != nil && err != io.EOF {
		fail(w, http.StatusBadRequest, "bad_request", "invalid JSON: "+err.Error())
		return
	}
	state := s.Updater.Status().State
	if body.Force || state == "ready" || state == "waiting" {
		if err := s.Updater.ApplyPending(r.Context(), body.Force); err != nil {
			fail(w, http.StatusConflict, "conflict", err.Error())
			return
		}
	} else {
		s.Updater.StartUpdate(r.Context())
	}
	writeJSON(w, http.StatusAccepted, struct{}{})
}

func (s *Server) updateDismiss(w http.ResponseWriter, _ *http.Request) {
	s.Updater.DismissPending()
	w.WriteHeader(http.StatusNoContent)
}
