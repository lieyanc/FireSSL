package api

import (
	"log/slog"
	"mime"
	"net/http"
	"strings"

	"github.com/lieyanc/FireSSL/internal/pki"
)

// PEM and key material can be large; CSRs and imports stay well below this.
const pemBodyLimit = 256 << 10

// recordRoutes registers the routes shared by CAs and certificates.
func (s *Server) recordRoutes(mux *http.ServeMux, base, kind string) {
	mux.HandleFunc("GET "+base, func(w http.ResponseWriter, r *http.Request) {
		items := s.PKI.List(pki.Filter{Kind: kind, IssuerID: r.URL.Query().Get("issuerId")})
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("GET "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.PKI.Get(r.PathValue("id"), kind)
		if err != nil {
			failErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	})
	mux.HandleFunc("PATCH "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Name string `json:"name"`
		}
		if !decode(w, r, &b, 4<<10) {
			return
		}
		v, err := s.PKI.Rename(r.PathValue("id"), kind, b.Name)
		if err != nil {
			failErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	})
	mux.HandleFunc("DELETE "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.PKI.Delete(id, kind); err != nil {
			failErr(w, err)
			return
		}
		slog.Info("record deleted", "kind", kind, "id", id)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST "+base+"/{id}/revoke", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Reason string `json:"reason"`
		}
		if !decode(w, r, &b, 4<<10) {
			return
		}
		v, err := s.PKI.Revoke(r.PathValue("id"), kind, b.Reason)
		if err != nil {
			failErr(w, err)
			return
		}
		slog.Info("certificate revoked", "kind", kind, "id", v.ID, "name", v.Name, "reason", v.RevocationReason)
		writeJSON(w, http.StatusOK, v)
	})
	mux.HandleFunc("GET "+base+"/{id}/export", func(w http.ResponseWriter, r *http.Request) {
		format := r.URL.Query().Get("format")
		f, err := s.PKI.Export(r.PathValue("id"), kind, format)
		if err != nil {
			failErr(w, err)
			return
		}
		if format == pki.FormatKey || format == pki.FormatBundle {
			slog.Info("private key exported", "kind", kind, "id", r.PathValue("id"), "format", format)
		}
		sendFile(w, f)
	})
	mux.HandleFunc("POST "+base+"/{id}/pkcs12", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Password string `json:"password"`
			Legacy   bool   `json:"legacy"`
		}
		if !decode(w, r, &b, 4<<10) {
			return
		}
		f, err := s.PKI.PKCS12(r.PathValue("id"), kind, b.Password, b.Legacy)
		if err != nil {
			failErr(w, err)
			return
		}
		slog.Info("private key exported", "kind", kind, "id", r.PathValue("id"), "format", "pkcs12")
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

func (s *Server) overview(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.PKI.Overview())
}

func (s *Server) createCA(w http.ResponseWriter, r *http.Request) {
	var b pki.CARequest
	if !decode(w, r, &b, 16<<10) {
		return
	}
	v, err := s.PKI.CreateCA(b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate authority created", "id", v.ID, "name", v.Name, "issuer", v.IssuerID, "keyAlgorithm", v.Details.KeyAlgorithm)
	writeJSON(w, http.StatusCreated, v)
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
	slog.Info("certificate authority imported", "id", v.ID, "name", v.Name, "hasKey", v.HasKey)
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) issue(w http.ResponseWriter, r *http.Request) {
	var b pki.CertRequest
	if !decode(w, r, &b, 64<<10) {
		return
	}
	v, err := s.PKI.Issue(b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate issued", "id", v.ID, "name", v.Name, "issuer", v.IssuerID, "profile", v.Profile)
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) signCSR(w http.ResponseWriter, r *http.Request) {
	var b pki.CSRRequest
	if !decode(w, r, &b, pemBodyLimit) {
		return
	}
	v, err := s.PKI.SignCSR(b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate signed from CSR", "id", v.ID, "name", v.Name, "issuer", v.IssuerID, "profile", v.Profile)
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) renew(w http.ResponseWriter, r *http.Request) {
	var b pki.RenewRequest
	if !decode(w, r, &b, 4<<10) {
		return
	}
	v, err := s.PKI.Renew(r.PathValue("id"), b)
	if err != nil {
		failErr(w, err)
		return
	}
	slog.Info("certificate renewed", "id", v.ID, "renewedFrom", v.RenewedFrom, "revokedOld", b.RevokeOld)
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) inspect(w http.ResponseWriter, r *http.Request) {
	var b struct {
		PEM string `json:"pem"`
	}
	if !decode(w, r, &b, pemBodyLimit) {
		return
	}
	items, err := s.PKI.Inspect(b.PEM)
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
