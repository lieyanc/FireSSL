// Package pki keeps a private certificate authority: CA hierarchies, issued
// certificates and their keys, revocation lists and exports.
package pki

import (
	"crypto"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/lieyanc/FireSSL/internal/config"
)

var (
	ErrNotFound = errors.New("not found")
)

// FieldError is a validation failure tied to one input field.
type FieldError = config.FieldError

// ConflictError means the request clashes with the current state.
type ConflictError = config.ConflictError

// ForbiddenError means the record is visible to the caller's tenant but
// managed by the platform administrator.
type ForbiddenError = config.ForbiddenError

const (
	KindCA   = "ca"
	KindLeaf = "leaf"

	SourceGenerated = "generated"
	SourceCSR       = "csr"
	SourceImported  = "imported"
)

// Record is one stored certificate. Everything that can be read from the
// certificate itself (subject, validity, SANs...) is parsed from CertPEM
// rather than duplicated here.
type Record struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	IssuerID string `json:"issuerId,omitempty"` // empty for self-signed or unknown issuers
	// TenantID is the tenant that owns the record; empty for the platform.
	// Root CAs always belong to the platform, everything a CA issues to the
	// CA's tenant.
	TenantID string `json:"tenantId,omitempty"`
	// Profile is root or intermediate for CAs, and server, client or
	// server-client for leaf certificates.
	Profile          string     `json:"profile"`
	Source           string     `json:"source"`
	CertPEM          string     `json:"certPem"`
	SealedKey        string     `json:"sealedKey,omitempty"`
	RevokedAt        *time.Time `json:"revokedAt,omitempty"`
	RevocationReason string     `json:"revocationReason,omitempty"`
	RenewedFrom      string     `json:"renewedFrom,omitempty"`
	CRLNumber        int64      `json:"crlNumber,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
}

type entry struct {
	Record
	cert *x509.Certificate
}

type fileFormat struct {
	Version int      `json:"version"`
	Records []Record `json:"records"`
}

// Options are the settings issuance depends on, read from the live config.
type Options struct {
	// PublicBase is the external base URL used for CRL and CA issuer URLs.
	PublicBase  string
	ExpiryWarn  time.Duration
	DefaultAlg  string
	DefaultDays int
}

// Store holds every record in memory and persists the set atomically.
type Store struct {
	path    string
	sealer  *sealer
	options func() Options

	mu      sync.RWMutex
	entries []*entry
	crls    map[string]*crlCache
}

// Open loads (or creates) the database in dir.
func Open(dir string, options func() Options) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "pki.json"), options: options, crls: map[string]*crlCache{}}
	data, err := os.ReadFile(s.path)
	fresh := errors.Is(err, os.ErrNotExist)
	if err != nil && !fresh {
		return nil, err
	}
	var f fileFormat
	if !fresh {
		if err := json.Unmarshal(data, &f); err != nil {
			return nil, fmt.Errorf("parse %s: %w", s.path, err)
		}
	}
	// The master key may only be created alongside an empty database; a
	// missing key next to sealed records means it was lost or misplaced.
	sealed := slices.ContainsFunc(f.Records, func(r Record) bool { return r.SealedKey != "" })
	if s.sealer, err = loadMasterKey(filepath.Join(dir, "master.key"), !sealed); err != nil {
		return nil, err
	}
	for _, r := range f.Records {
		cert, err := parseCertPEM([]byte(r.CertPEM))
		if err != nil {
			return nil, fmt.Errorf("record %s: %w", r.ID, err)
		}
		s.entries = append(s.entries, &entry{Record: r, cert: cert})
	}
	if fresh {
		if err := s.saveLocked(); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *Store) saveLocked() error {
	f := fileFormat{Version: 1, Records: make([]Record, len(s.entries))}
	for i, e := range s.entries {
		f.Records[i] = e.Record
	}
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return config.WriteFileAtomic(s.path, append(data, '\n'))
}

// commitLocked runs fn against the in-memory set and persists the result,
// rolling back if the write fails.
func (s *Store) commitLocked(fn func()) error {
	snapshot := make([]*entry, len(s.entries))
	for i, e := range s.entries {
		c := *e
		snapshot[i] = &c
	}
	fn()
	if err := s.saveLocked(); err != nil {
		s.entries = snapshot
		return fmt.Errorf("save database: %w", err)
	}
	return nil
}

func (s *Store) getLocked(id string) *entry {
	for _, e := range s.entries {
		if e.ID == id {
			return e
		}
	}
	return nil
}

func (s *Store) get(id, kind string) (*entry, error) {
	e := s.getLocked(id)
	if e == nil || (kind != "" && e.Kind != kind) {
		return nil, notFound(id, kind)
	}
	return e, nil
}

func notFound(id, kind string) error {
	if kind == KindCA {
		return fmt.Errorf("certificate authority %s %w", id, ErrNotFound)
	}
	return fmt.Errorf("certificate %s %w", id, ErrNotFound)
}

// Scope is the part of the inventory a caller works in: the records of one
// tenant, plus (read-only) the CAs above them; or, with Tenant empty, the
// whole platform.
type Scope struct{ Tenant string }

// Platform sees and manages every record.
var Platform = Scope{}

func (sc Scope) owns(e *entry) bool { return sc.Tenant == "" || e.TenantID == sc.Tenant }

// visibleLocked returns the ids sc may read, or nil when it sees everything.
func (s *Store) visibleLocked(sc Scope) map[string]bool {
	if sc.Tenant == "" {
		return nil
	}
	vis := map[string]bool{}
	for _, e := range s.entries {
		if e.TenantID == sc.Tenant {
			vis[e.ID] = true
			for _, p := range s.chainLocked(e) {
				vis[p.ID] = true
			}
		}
	}
	return vis
}

func canSee(vis map[string]bool, id string) bool { return vis == nil || vis[id] }

// find returns a record sc may read; write also requires sc to own it.
// Records outside the scope are reported as missing.
func (s *Store) find(sc Scope, id, kind string, write bool) (*entry, error) {
	e, err := s.get(id, kind)
	if err != nil {
		return nil, err
	}
	if sc.owns(e) {
		return e, nil
	}
	if !canSee(s.visibleLocked(sc), e.ID) {
		return nil, notFound(id, kind)
	}
	if write {
		return nil, &ForbiddenError{Msg: e.Name + " is managed by the platform administrator"}
	}
	return e, nil
}

// TenantRecords counts the records a tenant owns.
func (s *Store) TenantRecords(tenant string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := 0
	for _, e := range s.entries {
		if e.TenantID == tenant {
			n++
		}
	}
	return n
}

func (s *Store) key(e *entry) (crypto.Signer, error) {
	if e.SealedKey == "" {
		return nil, &ConflictError{Msg: "no private key is stored for " + e.Name}
	}
	plain, err := s.sealer.open(e.SealedKey, e.ID)
	if err != nil {
		return nil, err
	}
	return ParseKeyPEM(plain)
}

// chainLocked returns the issuers of e, nearest first, as far as they are
// known.
func (s *Store) chainLocked(e *entry) []*entry {
	var out []*entry
	seen := map[string]bool{e.ID: true}
	for id := e.IssuerID; id != ""; {
		p := s.getLocked(id)
		if p == nil || seen[p.ID] {
			break
		}
		seen[p.ID] = true
		out = append(out, p)
		id = p.IssuerID
	}
	return out
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func parseCertPEM(data []byte) (*x509.Certificate, error) {
	for {
		var block *pem.Block
		block, data = pem.Decode(data)
		if block == nil {
			return nil, errors.New("no certificate found in PEM data")
		}
		if block.Type == "CERTIFICATE" {
			return x509.ParseCertificate(block.Bytes)
		}
	}
}

func certPEM(der []byte) string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

// Views returned by the API.

type Subject struct {
	CommonName         string `json:"commonName"`
	Organization       string `json:"organization,omitempty"`
	OrganizationalUnit string `json:"organizationalUnit,omitempty"`
	Country            string `json:"country,omitempty"`
	Province           string `json:"province,omitempty"`
	Locality           string `json:"locality,omitempty"`
}

type SANs struct {
	DNS   []string `json:"dns"`
	IP    []string `json:"ip"`
	Email []string `json:"email"`
	URI   []string `json:"uri"`
}

// Details describes an X.509 certificate.
type Details struct {
	Subject               Subject   `json:"subject"`
	SubjectDN             string    `json:"subjectDn"`
	IssuerDN              string    `json:"issuerDn"`
	SerialNumber          string    `json:"serialNumber"`
	NotBefore             time.Time `json:"notBefore"`
	NotAfter              time.Time `json:"notAfter"`
	SANs                  SANs      `json:"sans"`
	IsCA                  bool      `json:"isCa"`
	PathLen               *int      `json:"pathLen,omitempty"`
	KeyUsage              []string  `json:"keyUsage"`
	ExtKeyUsage           []string  `json:"extKeyUsage"`
	KeyAlgorithm          string    `json:"keyAlgorithm"`
	SignatureAlgorithm    string    `json:"signatureAlgorithm"`
	FingerprintSHA1       string    `json:"fingerprintSha1"`
	FingerprintSHA256     string    `json:"fingerprintSha256"`
	SubjectKeyID          string    `json:"subjectKeyId,omitempty"`
	AuthorityKeyID        string    `json:"authorityKeyId,omitempty"`
	CRLDistributionPoints []string  `json:"crlDistributionPoints"`
	IssuingCertificateURL []string  `json:"issuingCertificateUrl"`
	SelfSigned            bool      `json:"selfSigned"`
}

// View is a stored record as the API presents it.
type View struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	IssuerID   string `json:"issuerId,omitempty"`
	IssuerName string `json:"issuerName,omitempty"`
	TenantID   string `json:"tenantId,omitempty"`
	// ReadOnly marks a CA shown to a tenant only because its sub-CAs chain
	// up to it.
	ReadOnly         bool       `json:"readOnly,omitempty"`
	Profile          string     `json:"profile"`
	Source           string     `json:"source"`
	Status           string     `json:"status"`
	HasKey           bool       `json:"hasKey"`
	RevokedAt        *time.Time `json:"revokedAt,omitempty"`
	RevocationReason string     `json:"revocationReason,omitempty"`
	RenewedFrom      string     `json:"renewedFrom,omitempty"`
	RenewedBy        string     `json:"renewedBy,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	Details          Details    `json:"details"`
	// CA only.
	Depth       int `json:"depth"`
	IssuedCount int `json:"issuedCount"`
	ChildCount  int `json:"childCount"`
	// Detail responses only.
	CertPEM string   `json:"certPem,omitempty"`
	Chain   []string `json:"chain,omitempty"` // issuer ids, nearest first
}

// Certificate statuses.
const (
	StatusValid       = "valid"
	StatusExpiring    = "expiring"
	StatusExpired     = "expired"
	StatusRevoked     = "revoked"
	StatusNotYetValid = "not-yet-valid"
)

func status(e *entry, now time.Time, warn time.Duration) string {
	switch {
	case e.RevokedAt != nil:
		return StatusRevoked
	case now.After(e.cert.NotAfter):
		return StatusExpired
	case now.Before(e.cert.NotBefore):
		return StatusNotYetValid
	case e.cert.NotAfter.Sub(now) <= warn:
		return StatusExpiring
	}
	return StatusValid
}

// viewCtx carries what rendering views for one request needs.
type viewCtx struct {
	sc   Scope
	vis  map[string]bool
	now  time.Time
	warn time.Duration
}

func (s *Store) ctxLocked(sc Scope) viewCtx {
	return viewCtx{sc: sc, vis: s.visibleLocked(sc), now: time.Now(), warn: s.options().ExpiryWarn}
}

// viewLocked renders e as seen from c.sc: counts and links only cover
// records the scope can see.
func (s *Store) viewLocked(c viewCtx, e *entry, full bool) View {
	now, warn := c.now, c.warn
	v := View{
		ID: e.ID, Kind: e.Kind, Name: e.Name, IssuerID: e.IssuerID, TenantID: e.TenantID,
		ReadOnly: !c.sc.owns(e), Profile: e.Profile,
		Source: e.Source, Status: status(e, now, warn), HasKey: e.SealedKey != "",
		RevokedAt: e.RevokedAt, RevocationReason: e.RevocationReason, RenewedFrom: e.RenewedFrom,
		CreatedAt: e.CreatedAt, Details: describe(e.cert),
	}
	if p := s.getLocked(e.IssuerID); p != nil {
		v.IssuerName = p.Name
	}
	chain := s.chainLocked(e)
	if e.Kind == KindCA {
		v.Depth = len(chain)
	}
	for _, o := range s.entries {
		if !canSee(c.vis, o.ID) {
			continue
		}
		if o.RenewedFrom == e.ID {
			v.RenewedBy = o.ID
		}
		if e.Kind == KindCA && o.IssuerID == e.ID && o.ID != e.ID {
			if o.Kind == KindCA {
				v.ChildCount++
			} else {
				v.IssuedCount++
			}
		}
	}
	if full {
		v.CertPEM = e.CertPEM
		v.Chain = []string{}
		for _, p := range chain {
			v.Chain = append(v.Chain, p.ID)
		}
	}
	return v
}

// Filter narrows List results.
type Filter struct {
	Kind     string
	IssuerID string
}

// List returns matching records; CAs come in hierarchy order (each CA
// followed by its sub-CAs), certificates newest first.
func (s *Store) List(sc Scope, f Filter) []View {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c := s.ctxLocked(sc)
	out := []View{}
	if f.Kind == KindCA {
		for _, e := range s.caTreeLocked() {
			if canSee(c.vis, e.ID) && (f.IssuerID == "" || e.IssuerID == f.IssuerID) {
				out = append(out, s.viewLocked(c, e, false))
			}
		}
		return out
	}
	for i := len(s.entries) - 1; i >= 0; i-- {
		e := s.entries[i]
		if canSee(c.vis, e.ID) && (f.Kind == "" || e.Kind == f.Kind) && (f.IssuerID == "" || e.IssuerID == f.IssuerID) {
			out = append(out, s.viewLocked(c, e, false))
		}
	}
	return out
}

// caTreeLocked orders CAs depth-first from the roots (or orphans).
func (s *Store) caTreeLocked() []*entry {
	children := map[string][]*entry{}
	var tops []*entry
	for _, e := range s.entries {
		if e.Kind != KindCA {
			continue
		}
		if e.IssuerID == "" || s.getLocked(e.IssuerID) == nil {
			tops = append(tops, e)
		} else {
			children[e.IssuerID] = append(children[e.IssuerID], e)
		}
	}
	var out []*entry
	var walk func(es []*entry)
	walk = func(es []*entry) {
		for _, e := range es {
			out = append(out, e)
			walk(children[e.ID])
		}
	}
	walk(tops)
	return out
}

// Get returns one record with its PEM and chain.
func (s *Store) Get(sc Scope, id, kind string) (View, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, err := s.find(sc, id, kind, false)
	if err != nil {
		return View{}, err
	}
	return s.viewLocked(s.ctxLocked(sc), e, true), nil
}

// Rename changes the display name.
func (s *Store) Rename(sc Scope, id, kind, name string) (View, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 128 {
		return View{}, &FieldError{Field: "name", Msg: "name must be 1-128 characters"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e, err := s.find(sc, id, kind, true)
	if err != nil {
		return View{}, err
	}
	if err := s.commitLocked(func() { e.Name = name }); err != nil {
		return View{}, err
	}
	return s.viewLocked(s.ctxLocked(sc), e, true), nil
}

// Delete removes a record. A CA must not have issued anything still stored.
func (s *Store) Delete(sc Scope, id, kind string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, err := s.find(sc, id, kind, true)
	if err != nil {
		return err
	}
	if e.Kind == KindCA {
		for _, o := range s.entries {
			if o.IssuerID == id && o.ID != id {
				return &ConflictError{Msg: "delete the certificates and sub-CAs issued by " + e.Name + " first"}
			}
		}
	}
	err = s.commitLocked(func() {
		s.entries = slices.DeleteFunc(s.entries, func(o *entry) bool { return o.ID == id })
	})
	delete(s.crls, id)
	return err
}

// Overview summarizes the inventory for the dashboard.
type Overview struct {
	Authorities  int    `json:"authorities"`
	Certificates int    `json:"certificates"`
	Valid        int    `json:"valid"`
	Expiring     int    `json:"expiring"`
	Expired      int    `json:"expired"`
	Revoked      int    `json:"revoked"`
	Attention    []View `json:"attention"` // expiring or recently expired, soonest first
	Recent       []View `json:"recent"`
	WarningDays  int    `json:"warningDays"`
}

// Overview counts only the records sc owns.
func (s *Store) Overview(sc Scope) Overview {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c := s.ctxLocked(sc)
	now, warn := c.now, c.warn
	o := Overview{Attention: []View{}, Recent: []View{}, WarningDays: int(warn / (24 * time.Hour))}
	for i := len(s.entries) - 1; i >= 0; i-- {
		e := s.entries[i]
		if !sc.owns(e) {
			continue
		}
		st := status(e, now, warn)
		if e.Kind == KindCA {
			o.Authorities++
		} else {
			o.Certificates++
			switch st {
			case StatusValid, StatusNotYetValid:
				o.Valid++
			case StatusExpiring:
				o.Expiring++
			case StatusExpired:
				o.Expired++
			case StatusRevoked:
				o.Revoked++
			}
			if len(o.Recent) < 6 {
				o.Recent = append(o.Recent, s.viewLocked(c, e, false))
			}
		}
		// Superseded certificates no longer need attention.
		renewed := slices.ContainsFunc(s.entries, func(r *entry) bool { return r.RenewedFrom == e.ID })
		if !renewed && (st == StatusExpiring || (st == StatusExpired && now.Sub(e.cert.NotAfter) < 30*24*time.Hour)) {
			o.Attention = append(o.Attention, s.viewLocked(c, e, false))
		}
	}
	slices.SortFunc(o.Attention, func(a, b View) int { return a.Details.NotAfter.Compare(b.Details.NotAfter) })
	if len(o.Attention) > 10 {
		o.Attention = o.Attention[:10]
	}
	return o
}

func describe(c *x509.Certificate) Details {
	d := Details{
		Subject: Subject{
			CommonName:         c.Subject.CommonName,
			Organization:       strings.Join(c.Subject.Organization, ", "),
			OrganizationalUnit: strings.Join(c.Subject.OrganizationalUnit, ", "),
			Country:            strings.Join(c.Subject.Country, ", "),
			Province:           strings.Join(c.Subject.Province, ", "),
			Locality:           strings.Join(c.Subject.Locality, ", "),
		},
		SubjectDN:             c.Subject.String(),
		IssuerDN:              c.Issuer.String(),
		SerialNumber:          colonHex(c.SerialNumber.Bytes()),
		NotBefore:             c.NotBefore.UTC(),
		NotAfter:              c.NotAfter.UTC(),
		SANs:                  sansOf(c.DNSNames, c.IPAddresses, c.EmailAddresses, c.URIs),
		IsCA:                  c.BasicConstraintsValid && c.IsCA,
		KeyUsage:              keyUsageNames(c.KeyUsage),
		ExtKeyUsage:           extKeyUsageNames(c.ExtKeyUsage),
		KeyAlgorithm:          KeyAlgorithmOf(c.PublicKey),
		SignatureAlgorithm:    c.SignatureAlgorithm.String(),
		SubjectKeyID:          colonHex(c.SubjectKeyId),
		AuthorityKeyID:        colonHex(c.AuthorityKeyId),
		CRLDistributionPoints: nonNil(c.CRLDistributionPoints),
		IssuingCertificateURL: nonNil(c.IssuingCertificateURL),
	}
	sha1sum := sha1.Sum(c.Raw)
	sha256sum := sha256.Sum256(c.Raw)
	d.FingerprintSHA1 = colonHex(sha1sum[:])
	d.FingerprintSHA256 = colonHex(sha256sum[:])
	if d.IsCA && (c.MaxPathLen > 0 || c.MaxPathLenZero) {
		n := c.MaxPathLen
		d.PathLen = &n
	}
	d.SelfSigned = c.CheckSignatureFrom(c) == nil && string(c.RawIssuer) == string(c.RawSubject)
	return d
}

func colonHex(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = fmt.Sprintf("%02X", v)
	}
	return strings.Join(parts, ":")
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func keyUsageNames(u x509.KeyUsage) []string {
	names := []struct {
		bit  x509.KeyUsage
		name string
	}{
		{x509.KeyUsageDigitalSignature, "digitalSignature"},
		{x509.KeyUsageContentCommitment, "contentCommitment"},
		{x509.KeyUsageKeyEncipherment, "keyEncipherment"},
		{x509.KeyUsageDataEncipherment, "dataEncipherment"},
		{x509.KeyUsageKeyAgreement, "keyAgreement"},
		{x509.KeyUsageCertSign, "keyCertSign"},
		{x509.KeyUsageCRLSign, "cRLSign"},
		{x509.KeyUsageEncipherOnly, "encipherOnly"},
		{x509.KeyUsageDecipherOnly, "decipherOnly"},
	}
	out := []string{}
	for _, n := range names {
		if u&n.bit != 0 {
			out = append(out, n.name)
		}
	}
	return out
}

func extKeyUsageNames(us []x509.ExtKeyUsage) []string {
	names := map[x509.ExtKeyUsage]string{
		x509.ExtKeyUsageAny:             "any",
		x509.ExtKeyUsageServerAuth:      "serverAuth",
		x509.ExtKeyUsageClientAuth:      "clientAuth",
		x509.ExtKeyUsageCodeSigning:     "codeSigning",
		x509.ExtKeyUsageEmailProtection: "emailProtection",
		x509.ExtKeyUsageTimeStamping:    "timeStamping",
		x509.ExtKeyUsageOCSPSigning:     "OCSPSigning",
	}
	out := []string{}
	for _, u := range us {
		if n, ok := names[u]; ok {
			out = append(out, n)
		} else {
			out = append(out, fmt.Sprintf("unknown(%d)", u))
		}
	}
	return out
}

// AssignTenant hands a sub-CA and everything below it to a tenant, or back
// to the platform when tenant is empty.
func (s *Store) AssignTenant(id, tenant string) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, err := s.get(id, KindCA)
	if err != nil {
		return View{}, err
	}
	if e.Profile == ProfileRoot || isSelfSigned(e.cert) {
		return View{}, &ConflictError{Msg: "root CAs stay with the platform; assign one of their sub-CAs instead"}
	}
	if p := s.getLocked(e.IssuerID); p != nil && p.TenantID != "" && p.TenantID != tenant {
		return View{}, &ConflictError{Msg: e.Name + " is issued by " + p.Name + ", which belongs to a tenant; reassign " + p.Name + " instead"}
	}
	var subtree []*entry
	for _, o := range s.entries {
		if o == e || slices.ContainsFunc(s.chainLocked(o), func(p *entry) bool { return p == e }) {
			subtree = append(subtree, o)
		}
	}
	err = s.commitLocked(func() {
		for _, o := range subtree {
			o.TenantID = tenant
		}
	})
	if err != nil {
		return View{}, err
	}
	return s.viewLocked(s.ctxLocked(Platform), e, true), nil
}
