package pki

import (
	"crypto"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"strings"
)

// Inspected is one PEM block decoded for the inspector.
type Inspected struct {
	Type        string      `json:"type"` // certificate, csr, privateKey, crl or unknown
	PEMType     string      `json:"pemType"`
	Certificate *Details    `json:"certificate,omitempty"`
	CSR         *CSRDetails `json:"csr,omitempty"`
	Key         *KeyDetails `json:"key,omitempty"`
	CRL         *CRLDetails `json:"crl,omitempty"`
	KnownID     string      `json:"knownId,omitempty"`   // stored record with the same certificate
	KnownKind   string      `json:"knownKind,omitempty"` // its kind
	Error       string      `json:"error,omitempty"`
}

type CSRDetails struct {
	Subject            Subject `json:"subject"`
	SubjectDN          string  `json:"subjectDn"`
	SANs               SANs    `json:"sans"`
	KeyAlgorithm       string  `json:"keyAlgorithm"`
	SignatureAlgorithm string  `json:"signatureAlgorithm"`
	SignatureValid     bool    `json:"signatureValid"`
}

type KeyDetails struct {
	KeyAlgorithm string `json:"keyAlgorithm"`
	// MatchesCertificate is the index of a certificate in the same input
	// that belongs to this key, or -1.
	MatchesCertificate int `json:"matchesCertificate"`
}

type CRLDetails struct {
	IssuerDN     string   `json:"issuerDn"`
	Number       string   `json:"number"`
	ThisUpdate   string   `json:"thisUpdate"`
	NextUpdate   string   `json:"nextUpdate"`
	RevokedCount int      `json:"revokedCount"`
	Revoked      []string `json:"revoked"` // serial numbers, at most 100
}

// Inspect decodes every PEM block in text.
func (s *Store) Inspect(text string) ([]Inspected, error) {
	rest := []byte(text)
	var out []Inspected
	var certs []*x509.Certificate
	var certIdx []int
	keys := map[int]crypto.Signer{}
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		item := Inspected{Type: "unknown", PEMType: block.Type}
		switch block.Type {
		case "CERTIFICATE", "TRUSTED CERTIFICATE":
			item.Type = "certificate"
			c, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				item.Error = err.Error()
				break
			}
			d := describe(c)
			item.Certificate = &d
			certs, certIdx = append(certs, c), append(certIdx, len(out))
			s.mu.RLock()
			for _, e := range s.entries {
				if string(e.cert.Raw) == string(c.Raw) {
					item.KnownID, item.KnownKind = e.ID, e.Kind
				}
			}
			s.mu.RUnlock()
		case "CERTIFICATE REQUEST", "NEW CERTIFICATE REQUEST":
			item.Type = "csr"
			csr, err := x509.ParseCertificateRequest(block.Bytes)
			if err != nil {
				item.Error = err.Error()
				break
			}
			item.CSR = &CSRDetails{
				Subject: subjectOf(csr.Subject), SubjectDN: csr.Subject.String(),
				SANs:               sansOf(csr.DNSNames, csr.IPAddresses, csr.EmailAddresses, csr.URIs),
				KeyAlgorithm:       KeyAlgorithmOf(csr.PublicKey),
				SignatureAlgorithm: csr.SignatureAlgorithm.String(),
				SignatureValid:     csr.CheckSignature() == nil,
			}
		case "PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY":
			item.Type = "privateKey"
			key, err := ParseKeyPEM(pem.EncodeToMemory(block))
			if err != nil {
				item.Error = err.Error()
				break
			}
			item.Key = &KeyDetails{KeyAlgorithm: KeyAlgorithmOf(key.Public()), MatchesCertificate: -1}
			keys[len(out)] = key
		case "X509 CRL":
			item.Type = "crl"
			crl, err := x509.ParseRevocationList(block.Bytes)
			if err != nil {
				item.Error = err.Error()
				break
			}
			d := &CRLDetails{
				IssuerDN: crl.Issuer.String(), RevokedCount: len(crl.RevokedCertificateEntries),
				ThisUpdate: crl.ThisUpdate.UTC().Format("2006-01-02T15:04:05Z"), Revoked: []string{},
			}
			if !crl.NextUpdate.IsZero() {
				d.NextUpdate = crl.NextUpdate.UTC().Format("2006-01-02T15:04:05Z")
			}
			if crl.Number != nil {
				d.Number = crl.Number.String()
			}
			for i, r := range crl.RevokedCertificateEntries {
				if i == 100 {
					break
				}
				d.Revoked = append(d.Revoked, colonHex(r.SerialNumber.Bytes()))
			}
			item.CRL = d
		}
		out = append(out, item)
	}
	if len(out) == 0 {
		if strings.TrimSpace(text) == "" {
			return nil, &FieldError{Field: "pem", Msg: "paste PEM data to inspect"}
		}
		return nil, &FieldError{Field: "pem", Msg: "no PEM blocks found (expected -----BEGIN ...-----)"}
	}
	if len(out) > 50 {
		return nil, &FieldError{Field: "pem", Msg: fmt.Sprintf("too many PEM blocks (%d); inspect at most 50 at once", len(out))}
	}
	// Pair keys with certificates from the same input.
	for i, key := range keys {
		for j, c := range certs {
			if samePublicKey(key.Public(), c.PublicKey) {
				out[i].Key.MatchesCertificate = certIdx[j]
				break
			}
		}
	}
	return out, nil
}
