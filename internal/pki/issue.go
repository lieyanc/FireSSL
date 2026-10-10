package pki

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Leaf certificate profiles.
const (
	ProfileServer       = "server"
	ProfileClient       = "client"
	ProfileServerClient = "server-client"

	ProfileRoot         = "root"
	ProfileIntermediate = "intermediate"
)

var LeafProfiles = []string{ProfileServer, ProfileClient, ProfileServerClient}

const (
	maxValidityDays = 36500
	// backdate tolerates clock skew between this host and relying parties.
	backdate = 5 * time.Minute
)

// CARequest creates a root CA (no IssuerID) or a sub-CA.
type CARequest struct {
	Name         string  `json:"name"`
	IssuerID     string  `json:"issuerId"`
	Subject      Subject `json:"subject"`
	KeyAlgorithm string  `json:"keyAlgorithm"`
	ValidityDays int     `json:"validityDays"`
	// PathLen limits how many sub-CA levels may follow; nil means unlimited
	// (or one less than the issuer's limit).
	PathLen *int `json:"pathLen"`
	// TenantID assigns a sub-CA of a platform CA to a tenant. Sub-CAs of a
	// tenant's CA always belong to that tenant.
	TenantID string `json:"tenantId"`
}

// CertRequest issues a leaf certificate with a newly generated key.
type CertRequest struct {
	Name         string  `json:"name"`
	IssuerID     string  `json:"issuerId"`
	Profile      string  `json:"profile"`
	Subject      Subject `json:"subject"`
	SANs         SANs    `json:"sans"`
	KeyAlgorithm string  `json:"keyAlgorithm"`
	ValidityDays int     `json:"validityDays"`
}

// CSRRequest signs a certificate signing request. Subject and SANs default
// to the ones in the CSR.
type CSRRequest struct {
	Name         string   `json:"name"`
	IssuerID     string   `json:"issuerId"`
	Profile      string   `json:"profile"`
	CSR          string   `json:"csr"`
	Subject      *Subject `json:"subject"`
	SANs         *SANs    `json:"sans"`
	ValidityDays int      `json:"validityDays"`
}

// ImportRequest adds an existing CA. Without a key it only anchors chains.
type ImportRequest struct {
	Name        string `json:"name"`
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"privateKey"`
}

// RenewRequest re-issues a leaf certificate with the same subject and SANs.
type RenewRequest struct {
	ValidityDays int  `json:"validityDays"`
	ReuseKey     bool `json:"reuseKey"`
	RevokeOld    bool `json:"revokeOld"`
}

// CreateCA generates a key and a self-signed root or a sub-CA certificate.
// Root CAs belong to the platform.
func (s *Store) CreateCA(sc Scope, req CARequest) (View, error) {
	if req.IssuerID == "" && sc.Tenant != "" {
		return View{}, &ForbiddenError{Msg: "only the platform administrator can create root CAs"}
	}
	if req.IssuerID == "" && req.TenantID != "" {
		return View{}, &FieldError{Field: "tenantId", Msg: "root CAs belong to the platform; assign one of their sub-CAs to the tenant instead"}
	}
	if err := normalizeSubject(&req.Subject, true); err != nil {
		return View{}, err
	}
	opts := s.options()
	if req.KeyAlgorithm == "" {
		req.KeyAlgorithm = ECDSAP384
	}
	if !ValidKeyAlgorithm(req.KeyAlgorithm) {
		return View{}, &FieldError{Field: "keyAlgorithm", Msg: "unsupported key algorithm"}
	}
	if req.ValidityDays == 0 {
		req.ValidityDays = 3650
	}
	if err := checkDays(req.ValidityDays); err != nil {
		return View{}, err
	}
	if req.PathLen != nil && (*req.PathLen < 0 || *req.PathLen > 16) {
		return View{}, &FieldError{Field: "pathLen", Msg: "path length must be 0-16"}
	}
	name, err := displayName(req.Name, req.Subject.CommonName)
	if err != nil {
		return View{}, err
	}
	key, err := GenerateKey(req.KeyAlgorithm)
	if err != nil {
		return View{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	tmpl, err := newTemplate(key.Public(), toName(req.Subject), req.ValidityDays)
	if err != nil {
		return View{}, err
	}
	tmpl.IsCA, tmpl.BasicConstraintsValid = true, true
	tmpl.KeyUsage = x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature
	tmpl.MaxPathLen = -1
	if req.PathLen != nil {
		tmpl.MaxPathLen, tmpl.MaxPathLenZero = *req.PathLen, *req.PathLen == 0
	}

	profile, tenant := ProfileRoot, ""
	parent, signer := tmpl, crypto.Signer(key)
	if req.IssuerID != "" {
		issuer, issuerKey, err := s.issuerLocked(sc, req.IssuerID)
		if err != nil {
			return View{}, err
		}
		tenant = req.TenantID
		if issuer.TenantID != "" {
			if tenant != "" && tenant != issuer.TenantID {
				return View{}, &FieldError{Field: "tenantId", Msg: "a sub-CA belongs to the tenant of its issuer"}
			}
			tenant = issuer.TenantID
		}
		if limit := issuer.cert.MaxPathLen; issuer.cert.MaxPathLenZero || limit == 0 {
			return View{}, &ConflictError{Msg: issuer.Name + " has a path length of 0 and cannot issue sub-CAs"}
		} else if limit > 0 {
			if req.PathLen == nil {
				tmpl.MaxPathLen, tmpl.MaxPathLenZero = limit-1, limit-1 == 0
			} else if *req.PathLen >= limit {
				return View{}, &FieldError{Field: "pathLen", Msg: fmt.Sprintf("path length must be below the issuer's (%d)", limit)}
			}
		}
		clampValidity(tmpl, issuer.cert)
		addIssuerURLs(tmpl, opts.PublicBase, issuer.ID)
		profile, parent, signer = ProfileIntermediate, issuer.cert, issuerKey
	}
	e, err := s.storeLocked(tmpl, parent, signer, key, &Record{
		Kind: KindCA, Name: name, IssuerID: req.IssuerID, TenantID: tenant, Profile: profile, Source: SourceGenerated,
	})
	if err != nil {
		return View{}, err
	}
	return s.viewLocked(s.ctxLocked(sc), e, true), nil
}

// Issue generates a key and a leaf certificate signed by a CA.
func (s *Store) Issue(sc Scope, req CertRequest) (View, error) {
	opts := s.options()
	if req.KeyAlgorithm == "" {
		req.KeyAlgorithm = opts.DefaultAlg
	}
	if !ValidKeyAlgorithm(req.KeyAlgorithm) {
		return View{}, &FieldError{Field: "keyAlgorithm", Msg: "unsupported key algorithm"}
	}
	if req.ValidityDays == 0 {
		req.ValidityDays = opts.DefaultDays
	}
	name, err := prepareLeaf(&req.Profile, &req.Subject, &req.SANs, req.Name, req.ValidityDays)
	if err != nil {
		return View{}, err
	}
	key, err := GenerateKey(req.KeyAlgorithm)
	if err != nil {
		return View{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.issueLocked(sc, req.IssuerID, req.Profile, toName(req.Subject), req.SANs, req.ValidityDays, key.Public(), key, &Record{
		Kind: KindLeaf, Name: name, Source: SourceGenerated,
	})
}

// SignCSR issues a leaf certificate for the public key in a CSR.
func (s *Store) SignCSR(sc Scope, req CSRRequest) (View, error) {
	csr, err := ParseCSR(req.CSR)
	if err != nil {
		return View{}, &FieldError{Field: "csr", Msg: err.Error()}
	}
	subject := subjectOf(csr.Subject)
	if req.Subject != nil {
		subject = *req.Subject
	}
	sans := sansOf(csr.DNSNames, csr.IPAddresses, csr.EmailAddresses, csr.URIs)
	if req.SANs != nil {
		sans = *req.SANs
	}
	if req.ValidityDays == 0 {
		req.ValidityDays = s.options().DefaultDays
	}
	name, err := prepareLeaf(&req.Profile, &subject, &sans, req.Name, req.ValidityDays)
	if err != nil {
		return View{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.issueLocked(sc, req.IssuerID, req.Profile, toName(subject), sans, req.ValidityDays, csr.PublicKey, nil, &Record{
		Kind: KindLeaf, Name: name, Source: SourceCSR,
	})
}

// Renew re-issues a leaf certificate from the same CA with the same
// subject, SANs and profile.
func (s *Store) Renew(sc Scope, id string, req RenewRequest) (View, error) {
	s.mu.RLock()
	old, err := s.find(sc, id, KindLeaf, true)
	var oldKey crypto.Signer
	if err == nil && req.ReuseKey && old.SealedKey != "" {
		oldKey, err = s.key(old)
	}
	if err != nil {
		s.mu.RUnlock()
		return View{}, err
	}
	rec, cert := old.Record, old.cert
	s.mu.RUnlock()

	if req.ValidityDays == 0 {
		req.ValidityDays = max(1, int(cert.NotAfter.Sub(cert.NotBefore).Round(24*time.Hour)/(24*time.Hour)))
	}
	if err := checkDays(req.ValidityDays); err != nil {
		return View{}, err
	}
	var pub crypto.PublicKey
	var key crypto.Signer
	switch {
	case rec.SealedKey == "":
		// Signed from a CSR: only the requester holds the key.
		if !req.ReuseKey {
			return View{}, &ConflictError{Msg: "this certificate was signed from a CSR; renew it with the same key or sign a new CSR"}
		}
		pub = cert.PublicKey
	case req.ReuseKey:
		key, pub = oldKey, oldKey.Public()
	default:
		alg := KeyAlgorithmOf(cert.PublicKey)
		if !ValidKeyAlgorithm(alg) {
			alg = s.options().DefaultAlg
		}
		if key, err = GenerateKey(alg); err != nil {
			return View{}, err
		}
		pub = key.Public()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getLocked(id) == nil {
		return View{}, fmt.Errorf("certificate %s %w", id, ErrNotFound)
	}
	subject := cert.Subject
	subject.Names, subject.ExtraNames = nil, nil
	sans := sansOf(cert.DNSNames, cert.IPAddresses, cert.EmailAddresses, cert.URIs)
	v, err := s.issueLocked(sc, rec.IssuerID, rec.Profile, subject, sans, req.ValidityDays, pub, key, &Record{
		Kind: KindLeaf, Name: rec.Name, Source: rec.Source, RenewedFrom: rec.ID,
	})
	if err != nil {
		return View{}, err
	}
	if req.RevokeOld {
		if err := s.revokeLocked(rec.ID, "superseded"); err != nil {
			return View{}, err
		}
	}
	return v, nil
}

// Import stores an existing CA certificate, with its key if given.
func (s *Store) Import(req ImportRequest) (View, error) {
	cert, err := parseCertPEM([]byte(req.Certificate))
	if err != nil {
		return View{}, &FieldError{Field: "certificate", Msg: err.Error()}
	}
	if !cert.BasicConstraintsValid || !cert.IsCA {
		return View{}, &FieldError{Field: "certificate", Msg: "the certificate is not a CA certificate"}
	}
	var key crypto.Signer
	if strings.TrimSpace(req.PrivateKey) != "" {
		if key, err = ParseKeyPEM([]byte(req.PrivateKey)); err != nil {
			return View{}, &FieldError{Field: "privateKey", Msg: err.Error()}
		}
		if !samePublicKey(key.Public(), cert.PublicKey) {
			return View{}, &FieldError{Field: "privateKey", Msg: "the private key does not belong to the certificate"}
		}
	}
	name, err := displayName(req.Name, cert.Subject.CommonName)
	if err != nil {
		return View{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.entries {
		if string(e.cert.Raw) == string(cert.Raw) {
			return View{}, &ConflictError{Msg: "this certificate is already stored as " + e.Name}
		}
	}
	rec := &Record{ID: newID(), Kind: KindCA, Name: name, Profile: ProfileRoot, Source: SourceImported,
		CertPEM: certPEM(cert.Raw), CreatedAt: now()}
	if !isSelfSigned(cert) {
		rec.Profile = ProfileIntermediate
		for _, e := range s.entries {
			if e.Kind == KindCA && cert.CheckSignatureFrom(e.cert) == nil {
				rec.IssuerID, rec.TenantID = e.ID, e.TenantID
				break
			}
		}
	}
	if key != nil {
		der, err := MarshalKeyPEM(key)
		if err != nil {
			return View{}, err
		}
		rec.SealedKey = s.sealer.seal(der, rec.ID)
	}
	e := &entry{Record: *rec, cert: cert}
	err = s.commitLocked(func() {
		s.entries = append(s.entries, e)
		// Sub-CAs imported earlier now chain up to this one.
		for _, o := range s.entries {
			if o.Kind == KindCA && o.IssuerID == "" && o != e && !isSelfSigned(o.cert) && o.cert.CheckSignatureFrom(cert) == nil {
				o.IssuerID = e.ID
			}
		}
	})
	if err != nil {
		return View{}, err
	}
	return s.viewLocked(s.ctxLocked(Platform), e, true), nil
}

// issueLocked signs a leaf certificate; it belongs to the issuer's tenant.
func (s *Store) issueLocked(sc Scope, issuerID, profile string, subject pkix.Name, sans SANs, days int, pub crypto.PublicKey, key crypto.Signer, rec *Record) (View, error) {
	issuer, issuerKey, err := s.issuerLocked(sc, issuerID)
	if err != nil {
		return View{}, err
	}
	tmpl, err := newTemplate(pub, subject, days)
	if err != nil {
		return View{}, err
	}
	tmpl.BasicConstraintsValid = true
	tmpl.KeyUsage = x509.KeyUsageDigitalSignature
	if _, ok := pub.(*rsa.PublicKey); ok {
		tmpl.KeyUsage |= x509.KeyUsageKeyEncipherment
	}
	switch profile {
	case ProfileServer:
		tmpl.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
	case ProfileClient:
		tmpl.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
	default:
		tmpl.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth}
	}
	tmpl.DNSNames, tmpl.EmailAddresses = sans.DNS, sans.Email
	for _, ip := range sans.IP {
		tmpl.IPAddresses = append(tmpl.IPAddresses, net.ParseIP(ip))
	}
	for _, u := range sans.URI {
		parsed, _ := url.Parse(u)
		tmpl.URIs = append(tmpl.URIs, parsed)
	}
	clampValidity(tmpl, issuer.cert)
	addIssuerURLs(tmpl, s.options().PublicBase, issuer.ID)
	rec.IssuerID, rec.TenantID, rec.Profile = issuer.ID, issuer.TenantID, profile
	e, err := s.storeLocked(tmpl, issuer.cert, issuerKey, key, rec)
	if err != nil {
		return View{}, err
	}
	return s.viewLocked(s.ctxLocked(sc), e, true), nil
}

// storeLocked signs tmpl and saves the resulting record.
func (s *Store) storeLocked(tmpl, parent *x509.Certificate, signer, key crypto.Signer, rec *Record) (*entry, error) {
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, tmpl.PublicKey, signer)
	if err != nil {
		return nil, fmt.Errorf("sign certificate: %w", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	rec.ID, rec.CertPEM, rec.CreatedAt = newID(), certPEM(der), now()
	if key != nil {
		keyPEM, err := MarshalKeyPEM(key)
		if err != nil {
			return nil, err
		}
		rec.SealedKey = s.sealer.seal(keyPEM, rec.ID)
	}
	e := &entry{Record: *rec, cert: cert}
	if err := s.commitLocked(func() { s.entries = append(s.entries, e) }); err != nil {
		return nil, err
	}
	return e, nil
}

// issuerLocked returns a CA of sc able to sign, with its key.
func (s *Store) issuerLocked(sc Scope, id string) (*entry, crypto.Signer, error) {
	if id == "" {
		return nil, nil, &FieldError{Field: "issuerId", Msg: "choose the issuing CA"}
	}
	e, err := s.find(sc, id, KindCA, true)
	if err != nil {
		return nil, nil, err
	}
	switch {
	case e.RevokedAt != nil:
		return nil, nil, &ConflictError{Msg: e.Name + " is revoked and cannot issue certificates"}
	case time.Now().After(e.cert.NotAfter):
		return nil, nil, &ConflictError{Msg: e.Name + " has expired and cannot issue certificates"}
	case e.cert.KeyUsage != 0 && e.cert.KeyUsage&x509.KeyUsageCertSign == 0:
		return nil, nil, &ConflictError{Msg: e.Name + " is not allowed to sign certificates (no keyCertSign usage)"}
	}
	key, err := s.key(e)
	if err != nil {
		return nil, nil, err
	}
	return e, key, nil
}

func newTemplate(pub crypto.PublicKey, subject pkix.Name, days int) (*x509.Certificate, error) {
	serial, err := randomSerial()
	if err != nil {
		return nil, err
	}
	ski, err := subjectKeyID(pub)
	if err != nil {
		return nil, err
	}
	nb := time.Now().Add(-backdate).UTC().Truncate(time.Second)
	return &x509.Certificate{
		SerialNumber: serial,
		Subject:      subject,
		NotBefore:    nb,
		NotAfter:     nb.AddDate(0, 0, days),
		SubjectKeyId: ski,
		PublicKey:    pub,
	}, nil
}

// clampValidity keeps a certificate within its issuer's validity.
func clampValidity(tmpl, issuer *x509.Certificate) {
	if tmpl.NotAfter.After(issuer.NotAfter) {
		tmpl.NotAfter = issuer.NotAfter
	}
	if tmpl.NotBefore.Before(issuer.NotBefore) {
		tmpl.NotBefore = issuer.NotBefore
	}
}

func addIssuerURLs(tmpl *x509.Certificate, base, issuerID string) {
	if base == "" {
		return
	}
	tmpl.CRLDistributionPoints = []string{base + "/crl/" + issuerID + ".crl"}
	tmpl.IssuingCertificateURL = []string{base + "/ca/" + issuerID + ".crt"}
}

// randomSerial returns a positive 127-bit serial number.
func randomSerial() (*big.Int, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	b[0] &= 0x7f
	b[0] |= 0x01 // never zero, never a leading zero byte
	return new(big.Int).SetBytes(b), nil
}

func isSelfSigned(c *x509.Certificate) bool {
	return string(c.RawIssuer) == string(c.RawSubject) && c.CheckSignatureFrom(c) == nil
}

func now() time.Time { return time.Now().UTC().Truncate(time.Second) }

// ParseCSR decodes and verifies a PEM certificate signing request.
func ParseCSR(data string) (*x509.CertificateRequest, error) {
	rest := []byte(data)
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			return nil, errors.New("no certificate request found in PEM data")
		}
		if block.Type != "CERTIFICATE REQUEST" && block.Type != "NEW CERTIFICATE REQUEST" {
			continue
		}
		csr, err := x509.ParseCertificateRequest(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse certificate request: %w", err)
		}
		if err := csr.CheckSignature(); err != nil {
			return nil, fmt.Errorf("certificate request signature is invalid: %w", err)
		}
		return csr, nil
	}
}

// Validation and normalization.

func checkDays(days int) error {
	if days < 1 || days > maxValidityDays {
		return &FieldError{Field: "validityDays", Msg: fmt.Sprintf("validity must be 1-%d days", maxValidityDays)}
	}
	return nil
}

func displayName(name, fallback string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = fallback
	}
	if name == "" || utf8.RuneCountInString(name) > 128 {
		return "", &FieldError{Field: "name", Msg: "name must be 1-128 characters"}
	}
	return name, nil
}

func prepareLeaf(profile *string, subject *Subject, sans *SANs, name string, days int) (string, error) {
	if *profile == "" {
		*profile = ProfileServer
	}
	if !slices.Contains(LeafProfiles, *profile) {
		return "", &FieldError{Field: "profile", Msg: "profile must be server, client or server-client"}
	}
	if err := checkDays(days); err != nil {
		return "", err
	}
	if err := normalizeSubject(subject, false); err != nil {
		return "", err
	}
	if err := normalizeSANs(sans); err != nil {
		return "", err
	}
	cn := subject.CommonName
	if *profile != ProfileClient && cn != "" {
		// TLS clients only match SANs, so a host name in the CN is included.
		if ip := net.ParseIP(cn); ip != nil {
			if !slices.Contains(sans.IP, ip.String()) {
				sans.IP = append([]string{ip.String()}, sans.IP...)
			}
		} else if d, err := normalizeDNS(cn); err == nil && !slices.Contains(sans.DNS, d) {
			sans.DNS = append([]string{d}, sans.DNS...)
		}
	}
	if *profile != ProfileClient && len(sans.DNS) == 0 && len(sans.IP) == 0 {
		return "", &FieldError{Field: "sans.dns", Msg: "server certificates need at least one DNS name or IP address"}
	}
	if cn == "" && len(sans.DNS)+len(sans.IP)+len(sans.Email)+len(sans.URI) == 0 {
		return "", &FieldError{Field: "subject.commonName", Msg: "enter a common name or at least one subject alternative name"}
	}
	fallback := cn
	for _, list := range [][]string{sans.DNS, sans.IP, sans.Email, sans.URI} {
		if fallback == "" && len(list) > 0 {
			fallback = list[0]
		}
	}
	return displayName(name, fallback)
}

func normalizeSubject(s *Subject, requireCN bool) error {
	fields := []struct {
		v     *string
		field string
		max   int
	}{
		{&s.CommonName, "subject.commonName", 64},
		{&s.Organization, "subject.organization", 64},
		{&s.OrganizationalUnit, "subject.organizationalUnit", 64},
		{&s.Country, "subject.country", 2},
		{&s.Province, "subject.province", 128},
		{&s.Locality, "subject.locality", 128},
	}
	for _, f := range fields {
		*f.v = strings.TrimSpace(*f.v)
		if utf8.RuneCountInString(*f.v) > f.max {
			return &FieldError{Field: f.field, Msg: fmt.Sprintf("at most %d characters", f.max)}
		}
	}
	s.Country = strings.ToUpper(s.Country)
	if s.Country != "" && (len(s.Country) != 2 || s.Country[0] < 'A' || s.Country[0] > 'Z' || s.Country[1] < 'A' || s.Country[1] > 'Z') {
		return &FieldError{Field: "subject.country", Msg: "country must be a two-letter code such as US"}
	}
	if requireCN && s.CommonName == "" {
		return &FieldError{Field: "subject.commonName", Msg: "common name is required"}
	}
	return nil
}

func normalizeSANs(s *SANs) error {
	const maxSANs = 100
	if len(s.DNS)+len(s.IP)+len(s.Email)+len(s.URI) > maxSANs {
		return &FieldError{Field: "sans.dns", Msg: fmt.Sprintf("at most %d subject alternative names", maxSANs)}
	}
	var dns, ips, emails, uris []string
	for _, d := range s.DNS {
		if d = strings.TrimSpace(d); d == "" {
			continue
		}
		n, err := normalizeDNS(d)
		if err != nil {
			return &FieldError{Field: "sans.dns", Msg: err.Error()}
		}
		dns = appendUnique(dns, n)
	}
	for _, v := range s.IP {
		if v = strings.TrimSpace(v); v == "" {
			continue
		}
		ip := net.ParseIP(v)
		if ip == nil {
			return &FieldError{Field: "sans.ip", Msg: fmt.Sprintf("%q is not an IP address", v)}
		}
		ips = appendUnique(ips, ip.String())
	}
	for _, v := range s.Email {
		if v = strings.TrimSpace(v); v == "" {
			continue
		}
		local, domain, ok := strings.Cut(v, "@")
		if !ok || local == "" || domain == "" || strings.ContainsAny(v, " \t<>") {
			return &FieldError{Field: "sans.email", Msg: fmt.Sprintf("%q is not an email address", v)}
		}
		emails = appendUnique(emails, v)
	}
	for _, v := range s.URI {
		if v = strings.TrimSpace(v); v == "" {
			continue
		}
		u, err := url.Parse(v)
		if err != nil || u.Scheme == "" {
			return &FieldError{Field: "sans.uri", Msg: fmt.Sprintf("%q is not an absolute URI", v)}
		}
		uris = appendUnique(uris, v)
	}
	*s = SANs{DNS: nonNil(dns), IP: nonNil(ips), Email: nonNil(emails), URI: nonNil(uris)}
	return nil
}

// normalizeDNS lowercases a host name and checks its syntax, allowing a
// leading wildcard label.
func normalizeDNS(d string) (string, error) {
	d = strings.TrimSuffix(strings.ToLower(d), ".")
	if len(d) == 0 || len(d) > 253 {
		return "", fmt.Errorf("%q is not a valid DNS name", d)
	}
	for i, label := range strings.Split(d, ".") {
		if label == "*" && i == 0 && strings.Contains(d, ".") {
			continue
		}
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", fmt.Errorf("%q is not a valid DNS name", d)
		}
		for _, r := range label {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
				return "", fmt.Errorf("%q is not a valid DNS name", d)
			}
		}
	}
	return d, nil
}

func appendUnique(list []string, v string) []string {
	if slices.Contains(list, v) {
		return list
	}
	return append(list, v)
}

func toName(s Subject) pkix.Name {
	var n pkix.Name
	n.CommonName = s.CommonName
	add := func(dst *[]string, v string) {
		if v != "" {
			*dst = []string{v}
		}
	}
	add(&n.Organization, s.Organization)
	add(&n.OrganizationalUnit, s.OrganizationalUnit)
	add(&n.Country, s.Country)
	add(&n.Province, s.Province)
	add(&n.Locality, s.Locality)
	return n
}

func subjectOf(n pkix.Name) Subject {
	first := func(v []string) string {
		if len(v) == 0 {
			return ""
		}
		return v[0]
	}
	return Subject{
		CommonName: n.CommonName, Organization: first(n.Organization),
		OrganizationalUnit: first(n.OrganizationalUnit), Country: first(n.Country),
		Province: first(n.Province), Locality: first(n.Locality),
	}
}

func sansOf(dns []string, ips []net.IP, emails []string, uris []*url.URL) SANs {
	s := SANs{DNS: nonNil(slices.Clone(dns)), IP: []string{}, Email: nonNil(slices.Clone(emails)), URI: []string{}}
	for _, ip := range ips {
		s.IP = append(s.IP, ip.String())
	}
	for _, u := range uris {
		s.URI = append(s.URI, u.String())
	}
	return s
}
