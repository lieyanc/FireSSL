package pki

import (
	"archive/zip"
	"bytes"
	"crypto/x509"
	"strings"
	"unicode/utf8"

	"software.sslmate.com/src/go-pkcs12"
)

// Export formats.
const (
	FormatCert      = "cert"      // PEM certificate
	FormatDER       = "der"       // DER certificate
	FormatKey       = "key"       // PKCS#8 PEM private key
	FormatChain     = "chain"     // issuing CAs up to the root, nearest first
	FormatFullchain = "fullchain" // the certificate plus intermediates, without the root
	FormatBundle    = "zip"       // all of the above in one archive
	FormatCRL       = "crl"       // DER CRL of a CA
	FormatCRLPEM    = "crl-pem"   // PEM CRL of a CA
)

// File is an export ready to download.
type File struct {
	Name        string
	ContentType string
	Data        []byte
}

const (
	typePEM = "application/x-pem-file"
	typeDER = "application/pkix-cert"
	typeCRL = "application/pkix-crl"
	typeZip = "application/zip"
	typeP12 = "application/x-pkcs12"
)

// PrivateFormat reports whether an export format contains the private key.
func PrivateFormat(format string) bool { return format == FormatKey || format == FormatBundle }

// Export renders a stored certificate in one of the formats above. Formats
// with the private key need a record sc owns; public ones any it can see.
func (s *Store) Export(sc Scope, id, kind, format string) (File, error) {
	s.mu.RLock()
	_, err := s.find(sc, id, kind, PrivateFormat(format))
	s.mu.RUnlock()
	if err != nil {
		return File{}, err
	}
	if format == FormatCRL || format == FormatCRLPEM {
		der, err := s.CRL(id)
		if err != nil {
			return File{}, err
		}
		s.mu.RLock()
		name := fileStem(s.getLocked(id))
		s.mu.RUnlock()
		if format == FormatCRLPEM {
			return File{name + ".crl.pem", typePEM, crlPEM(der)}, nil
		}
		return File{name + ".crl", typeCRL, der}, nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	e, err := s.get(id, kind)
	if err != nil {
		return File{}, err
	}
	stem := fileStem(e)
	chain := s.chainLocked(e)
	switch format {
	case FormatCert, "":
		return File{stem + ".crt", typePEM, []byte(e.CertPEM)}, nil
	case FormatDER:
		return File{stem + ".cer", typeDER, e.cert.Raw}, nil
	case FormatKey:
		key, err := s.keyPEM(e)
		if err != nil {
			return File{}, err
		}
		return File{stem + ".key", typePEM, key}, nil
	case FormatChain:
		if len(chain) == 0 {
			return File{}, &ConflictError{Msg: "no issuing CA is stored for " + e.Name}
		}
		return File{stem + ".chain.pem", typePEM, joinPEM(chain)}, nil
	case FormatFullchain:
		return File{stem + ".fullchain.pem", typePEM, joinPEM(append([]*entry{e}, intermediates(chain)...))}, nil
	case FormatBundle:
		var buf bytes.Buffer
		z := zip.NewWriter(&buf)
		add := func(name string, data []byte) {
			w, _ := z.Create(stem + "/" + name)
			w.Write(data)
		}
		add("cert.pem", []byte(e.CertPEM))
		add("fullchain.pem", joinPEM(append([]*entry{e}, intermediates(chain)...)))
		if len(chain) > 0 {
			add("chain.pem", joinPEM(chain))
			if root := chain[len(chain)-1]; isSelfSigned(root.cert) {
				add("ca.pem", []byte(root.CertPEM))
			}
		}
		if e.SealedKey != "" {
			key, err := s.keyPEM(e)
			if err != nil {
				return File{}, err
			}
			add("privkey.pem", key)
		}
		if err := z.Close(); err != nil {
			return File{}, err
		}
		return File{stem + ".zip", typeZip, buf.Bytes()}, nil
	}
	return File{}, &FieldError{Field: "format", Msg: "unknown export format " + format}
}

// PKCS12 bundles the certificate, its key and the issuing chain. legacy
// selects 3DES/SHA-1 encryption for older Windows and macOS releases.
func (s *Store) PKCS12(sc Scope, id, kind, password string, legacy bool) (File, error) {
	if utf8.RuneCountInString(password) < 4 {
		return File{}, &FieldError{Field: "password", Msg: "password must be at least 4 characters"}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, err := s.find(sc, id, kind, true)
	if err != nil {
		return File{}, err
	}
	key, err := s.key(e)
	if err != nil {
		return File{}, err
	}
	var cas []*x509.Certificate
	for _, p := range s.chainLocked(e) {
		cas = append(cas, p.cert)
	}
	enc := pkcs12.Modern2023
	if legacy {
		enc = pkcs12.LegacyDES
	}
	data, err := enc.Encode(key, e.cert, cas, password)
	if err != nil {
		return File{}, err
	}
	return File{fileStem(e) + ".p12", typeP12, data}, nil
}

func (s *Store) keyPEM(e *entry) ([]byte, error) {
	if e.SealedKey == "" {
		return nil, &ConflictError{Msg: "no private key is stored for " + e.Name}
	}
	return s.sealer.open(e.SealedKey, e.ID)
}

// intermediates drops a trailing self-signed root from a chain.
func intermediates(chain []*entry) []*entry {
	if n := len(chain); n > 0 && isSelfSigned(chain[n-1].cert) {
		return chain[:n-1]
	}
	return chain
}

func joinPEM(es []*entry) []byte {
	var b strings.Builder
	for _, e := range es {
		b.WriteString(e.CertPEM)
	}
	return []byte(b.String())
}

// fileStem turns a record name into a safe file name.
func fileStem(e *entry) string {
	var b strings.Builder
	for _, r := range strings.ReplaceAll(e.Name, "*", "wildcard") {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	stem := strings.Trim(b.String(), "._")
	if stem == "" || strings.Trim(stem, "_") == "" {
		return e.ID
	}
	if len(stem) > 80 {
		stem = stem[:80]
	}
	return stem
}
