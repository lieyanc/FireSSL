package pki

import (
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"math/big"
	"slices"
	"time"
)

// Revocation reasons accepted by Revoke, with their RFC 5280 codes.
var RevocationReasons = map[string]int{
	"unspecified":          0,
	"keyCompromise":        1,
	"caCompromise":         2,
	"affiliationChanged":   3,
	"superseded":           4,
	"cessationOfOperation": 5,
	"privilegeWithdrawn":   9,
}

const (
	crlValidity = 7 * 24 * time.Hour
	// crlRefresh re-signs a cached CRL once this much of its validity is left.
	crlRefresh = 6 * 24 * time.Hour
)

type crlCache struct {
	der        []byte
	nextUpdate time.Time
}

// Revoke marks a certificate or sub-CA as revoked; it appears on its
// issuer's CRL from then on.
func (s *Store) Revoke(sc Scope, id, kind, reason string) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, err := s.find(sc, id, kind, true)
	if err != nil {
		return View{}, err
	}
	if err := s.revokeLocked(e.ID, reason); err != nil {
		return View{}, err
	}
	return s.viewLocked(s.ctxLocked(sc), e, true), nil
}

func (s *Store) revokeLocked(id, reason string) error {
	e := s.getLocked(id)
	if reason == "" {
		reason = "unspecified"
	}
	if _, ok := RevocationReasons[reason]; !ok {
		return &FieldError{Field: "reason", Msg: "unknown revocation reason"}
	}
	if e.RevokedAt != nil {
		return &ConflictError{Msg: e.Name + " is already revoked"}
	}
	if e.Kind == KindCA && e.IssuerID == "" {
		return &ConflictError{Msg: "a root CA cannot be revoked; delete it or stop trusting it instead"}
	}
	t := now()
	err := s.commitLocked(func() { e.RevokedAt, e.RevocationReason = &t, reason })
	delete(s.crls, e.IssuerID)
	return err
}

// CRL returns the DER-encoded revocation list of a CA, re-signing it when
// revocations changed or the cached copy is getting old.
func (s *Store) CRL(caID string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ca, err := s.get(caID, KindCA)
	if err != nil {
		return nil, err
	}
	if c := s.crls[caID]; c != nil && time.Until(c.nextUpdate) > crlRefresh {
		return c.der, nil
	}
	if ca.cert.KeyUsage != 0 && ca.cert.KeyUsage&x509.KeyUsageCRLSign == 0 {
		return nil, &ConflictError{Msg: ca.Name + " is not allowed to sign CRLs (no cRLSign usage)"}
	}
	key, err := s.key(ca)
	if err != nil {
		return nil, err
	}
	var revoked []x509.RevocationListEntry
	for _, e := range s.entries {
		if e.IssuerID == caID && e.RevokedAt != nil && e.ID != caID {
			revoked = append(revoked, x509.RevocationListEntry{
				SerialNumber:   e.cert.SerialNumber,
				RevocationTime: *e.RevokedAt,
				ReasonCode:     RevocationReasons[e.RevocationReason],
			})
		}
	}
	slices.SortFunc(revoked, func(a, b x509.RevocationListEntry) int { return a.RevocationTime.Compare(b.RevocationTime) })
	this := time.Now().Add(-backdate).UTC().Truncate(time.Second)
	number := ca.CRLNumber + 1
	der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
		RevokedCertificateEntries: revoked,
		Number:                    big.NewInt(number),
		ThisUpdate:                this,
		NextUpdate:                this.Add(crlValidity),
	}, ca.cert, key)
	if err != nil {
		return nil, fmt.Errorf("sign CRL: %w", err)
	}
	if err := s.commitLocked(func() { ca.CRLNumber = number }); err != nil {
		return nil, err
	}
	s.crls[caID] = &crlCache{der: der, nextUpdate: this.Add(crlValidity)}
	return der, nil
}

// CACertDER returns a CA certificate for the public issuer URL.
func (s *Store) CACertDER(id string) ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, err := s.get(id, KindCA)
	if err != nil {
		return nil, err
	}
	return e.cert.Raw, nil
}

func crlPEM(der []byte) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "X509 CRL", Bytes: der})
}
