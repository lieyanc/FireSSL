package api

import (
	"log/slog"
	"mime"
	"net/http"
	"strings"

	"github.com/lieyanc/FireSSL/internal/config"
	"github.com/lieyanc/FireSSL/internal/iam"
	"github.com/lieyanc/FireSSL/internal/pki"
)

// PEM and key material can be large; CSRs and imports stay well below this.
const pemBodyLimit = 256 << 10

// recordRoutes registers the routes shared by CAs and certificates.
// Changing a CA takes PermManageCA, changing a certificate PermIssue.
func (s *Server) recordRoutes(mux *http.ServeMux, base, kind string) {
	manage := managePerm(kind)
	mux.HandleFunc("GET "+base, func(w http.ResponseWriter, r *http.Request) {
		sc, ok := s.scope(w, r, iam.PermView)
		if !ok {
			return
		}
		items := s.PKI.List(sc, pki.Filter{Kind: kind, IssuerID: r.URL.Query().Get("issuerId")})
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("GET "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		sc, ok := s.scope(w, r, iam.PermView)
		if !ok {
			return
		}
		v, err := s.PKI.Get(sc, r.PathValue("id"), kind)
		if err != nil {
			failErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	})
	mux.HandleFunc("PATCH "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		sc, ok := s.scope(w, r, manage)
		if !ok {
			return
		}
		var b struct {
			Name string `json:"name"`
		}
		if !decode(w, r, &b, 4<<10) {
			return
		}
		v, err := s.PKI.Rename(sc, r.PathValue("id"), kind, b.Name)
		if err != nil {
			failErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	})
	mux.HandleFunc("DELETE "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		sc, ok := s.scope(w, r, manage)
		if !ok {
			return
		}
		id := r.PathValue("id")
		if err := s.PKI.Delete(sc, id, kind); err != nil {
			failErr(w, err)
			return
		}
		slog.Info("record deleted", "kind", kind, "id", id, "user", actor(r))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST "+base+"/{id}/revoke", func(w http.ResponseWriter, r *http.Request) {
		sc, ok := s.scope(w, r, manage)
		if !ok {
			return
		}
		var b struct {
			Reason string `json:"reason"`
		}
		if !decode(w, r, &b, 4<<10) {
			return
		}
		v, err := s.PKI.Revoke(sc, r.PathValue("id"), kind, b.Reason)
		if err != nil {
			failErr(w, err)
			return
		}
		slog.Info("certificate revoked", "kind", kind, "id", v.ID, "name", v.Name, "reason", v.RevocationReason, "user", actor(r))
		writeJSON(w, http.StatusOK, v)
	})
	mux.HandleFunc("GET "+base+"/{id}/export", func(w http.ResponseWriter, r *http.Request) {
		format := r.URL.Query().Get("format")
		perm := iam.PermView
		if pki.PrivateFormat(format) {
			perm = manage
		}
		sc, ok := s.scope(w, r, perm)
		if !ok {
			return
		}
		f, err := s.PKI.Export(sc, r.PathValue("id"), kind, format)
		if err != nil {
			failErr(w, err)
			return
		}
		if pki.PrivateFormat(format) {
			slog.Info("private key exported", "kind", kind, "id", r.PathValue("id"), "format", format, "user", actor(r))
		}
		sendFile(w, f)
	})
	mux.HandleFunc("POST "+base+"/{id}/pkcs12", func(w http.ResponseWriter, r *http.Request) {
		sc, ok := s.scope(w, r, manage)
		if !ok {
			return
		}
		var b struct {
			Password string `json:"password"`
			Legacy   bool   `json:"legacy"`
		}
		if !decode(w, r, &b, 4<<10) {
			return
		}
		f, err := s.PKI.PKCS12(sc, r.PathValue("id"), kind, b.Password, b.Legacy)
		if err != nil {
			failErr(w, err)
			return
		}
		slog.Info("private key exported", "kind", kind, "id", r.PathValue("id"), "format", "pkcs12", "user", actor(r))
		sendFile(w, f)
	})
}

func sendFile(w http.ResponseWriter, f pki.File) {
	h := w.Header()
	h.Set("Content-Type", f.ContentType)
	h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": f.Name}))
	h.Set("Cache-Control", "no-store")
	w.Write(f.Data)
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.scope(w, r, iam.PermView)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, s.PKI.Overview(sc))
}

func (s *Server) createCA(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.scope(w, r, iam.PermManageCA)
	if !ok {
		return
	}
	var b pki.CARequest
	if !decode(w, r, &b, 16<<10) {
		return
	}
	if sc == pki.Platform && b.TenantID != "" {
		if _, ok := s.Users.Tenant(b.TenantID); !ok {
			failErr(w, &config.FieldError{Field: "tenantId", Msg: "unknown tenant"})
			return
		}
	}
	v, err := s.PKI.CreateCA(sc, b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate authority created", "id", v.ID, "name", v.Name, "issuer", v.IssuerID, "tenant", v.TenantID,
		"keyAlgorithm", v.Details.KeyAlgorithm, "user", actor(r))
	writeJSON(w, http.StatusCreated, v)
}

// assignTenant hands a sub-CA and everything below it to a tenant.
func (s *Server) assignTenant(w http.ResponseWriter, r *http.Request) {
	var b struct {
		TenantID string `json:"tenantId"`
	}
	if !decode(w, r, &b, 4<<10) {
		return
	}
	if b.TenantID != "" {
		if _, ok := s.Users.Tenant(b.TenantID); !ok {
			failErr(w, &config.FieldError{Field: "tenantId", Msg: "unknown tenant"})
			return
		}
	}
	v, err := s.PKI.AssignTenant(r.PathValue("id"), b.TenantID)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate authority assigned", "id", v.ID, "name", v.Name, "tenant", v.TenantID, "user", actor(r))
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) importCA(w http.ResponseWriter, r *http.Request) {
	var b pki.ImportRequest
	if !decode(w, r, &b, pemBodyLimit) {
		return
	}
	v, err := s.PKI.Import(b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate authority imported", "id", v.ID, "name", v.Name, "hasKey", v.HasKey, "user", actor(r))
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) issue(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.scope(w, r, iam.PermIssue)
	if !ok {
		return
	}
	var b pki.CertRequest
	if !decode(w, r, &b, 64<<10) {
		return
	}
	v, err := s.PKI.Issue(sc, b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate issued", "id", v.ID, "name", v.Name, "issuer", v.IssuerID, "profile", v.Profile, "user", actor(r))
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) signCSR(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.scope(w, r, iam.PermIssue)
	if !ok {
		return
	}
	var b pki.CSRRequest
	if !decode(w, r, &b, pemBodyLimit) {
		return
	}
	v, err := s.PKI.SignCSR(sc, b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate signed from CSR", "id", v.ID, "name", v.Name, "issuer", v.IssuerID, "profile", v.Profile, "user", actor(r))
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) renew(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.scope(w, r, iam.PermIssue)
	if !ok {
		return
	}
	var b pki.RenewRequest
	if !decode(w, r, &b, 4<<10) {
		return
	}
	v, err := s.PKI.Renew(sc, r.PathValue("id"), b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate renewed", "id", v.ID, "renewedFrom", v.RenewedFrom, "revokedOld", b.RevokeOld, "user", actor(r))
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) inspect(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.scope(w, r, iam.PermView)
	if !ok {
		return
	}
	var b struct {
		PEM string `json:"pem"`
	}
	if !decode(w, r, &b, pemBodyLimit) {
		return
	}
	items, err := s.PKI.Inspect(sc, b.PEM)
	if err != nil {
		failErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// Public endpoints for relying parties.

func (s *Server) publicCRL(w http.ResponseWriter, r *http.Request) {
	id, ok := strings.CutSuffix(r.PathValue("file"), ".crl")
	if !ok {
		http.NotFound(w, r)
		return
	}
	der, err := s.PKI.CRL(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/pkix-crl")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(der)
}

func (s *Server) publicCACert(w http.ResponseWriter, r *http.Request) {
	id, ok := strings.CutSuffix(r.PathValue("file"), ".crt")
	if !ok {
		http.NotFound(w, r)
		return
	}
	der, err := s.PKI.CACertDER(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/pkix-cert")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(der)
}
