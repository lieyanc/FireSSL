package pki

import (
	"archive/zip"
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"software.sslmate.com/src/go-pkcs12"
)

func testOptions() Options {
	return Options{PublicBase: "https://pki.example.com", ExpiryWarn: 30 * 24 * time.Hour, DefaultAlg: ECDSAP256, DefaultDays: 397}
}

func openTest(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir, testOptions)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func mustCert(t *testing.T, v View) *x509.Certificate {
	t.Helper()
	c, err := parseCertPEM([]byte(v.CertPEM))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func hierarchy(t *testing.T, s *Store) (root, sub View) {
	t.Helper()
	root, err := s.CreateCA(Platform, CARequest{Subject: Subject{CommonName: "Test Root", Organization: "FireSSL", Country: "us"}, KeyAlgorithm: ECDSAP384})
	if err != nil {
		t.Fatal(err)
	}
	zero := 0
	sub, err = s.CreateCA(Platform, CARequest{IssuerID: root.ID, Subject: Subject{CommonName: "Test Sub"}, KeyAlgorithm: RSA2048, ValidityDays: 1825, PathLen: &zero})
	if err != nil {
		t.Fatal(err)
	}
	return root, sub
}

func TestIssueChainVerifies(t *testing.T) {
	s := openTest(t, t.TempDir())
	root, sub := hierarchy(t, s)
	if root.Profile != ProfileRoot || sub.Profile != ProfileIntermediate || sub.Depth != 1 {
		t.Fatalf("unexpected profiles: %+v %+v", root.Profile, sub)
	}
	if root.Details.Subject.Country != "US" {
		t.Fatalf("country not normalized: %q", root.Details.Subject.Country)
	}
	leaf, err := s.Issue(Platform, CertRequest{IssuerID: sub.ID, Subject: Subject{CommonName: "app.example.com"}, SANs: SANs{IP: []string{"10.0.0.1"}}})
	if err != nil {
		t.Fatal(err)
	}
	// The CN host name joins the SANs.
	if got := leaf.Details.SANs; len(got.DNS) != 1 || got.DNS[0] != "app.example.com" || got.IP[0] != "10.0.0.1" {
		t.Fatalf("unexpected SANs: %+v", leaf.Details.SANs)
	}
	leaf2, err := s.Issue(Platform, CertRequest{IssuerID: sub.ID, Subject: Subject{CommonName: "WWW.Example.com"}, KeyAlgorithm: Ed25519})
	if err != nil {
		t.Fatal(err)
	}
	if got := leaf2.Details.SANs.DNS; len(got) != 1 || got[0] != "www.example.com" {
		t.Fatalf("CN not copied to SANs: %v", got)
	}

	roots, inter := x509.NewCertPool(), x509.NewCertPool()
	roots.AddCert(mustCert(t, root))
	inter.AddCert(mustCert(t, sub))
	_, err = mustCert(t, leaf2).Verify(x509.VerifyOptions{DNSName: "www.example.com", Roots: roots, Intermediates: inter})
	if err != nil {
		t.Fatalf("chain does not verify: %v", err)
	}
	c := mustCert(t, leaf)
	if c.NotAfter.After(mustCert(t, sub).NotAfter) {
		t.Fatal("leaf outlives its issuer")
	}
	if len(c.CRLDistributionPoints) != 1 || !strings.HasSuffix(c.CRLDistributionPoints[0], "/crl/"+sub.ID+".crl") {
		t.Fatalf("missing CRL DP: %v", c.CRLDistributionPoints)
	}
	if c.KeyUsage&x509.KeyUsageKeyEncipherment != 0 {
		t.Fatal("ECDSA leaf must not carry keyEncipherment")
	}

	// Path length 0 forbids further sub-CAs.
	if _, err := s.CreateCA(Platform, CARequest{IssuerID: sub.ID, Subject: Subject{CommonName: "Too deep"}}); err == nil {
		t.Fatal("expected path length violation")
	}
}

func TestValidation(t *testing.T) {
	s := openTest(t, t.TempDir())
	root, _ := hierarchy(t, s)
	cases := []CertRequest{
		{IssuerID: root.ID, Subject: Subject{CommonName: "not a host!"}},
		{IssuerID: root.ID, Subject: Subject{CommonName: "x"}, SANs: SANs{IP: []string{"300.1.1.1"}}},
		{IssuerID: root.ID, Subject: Subject{CommonName: "a.example"}, ValidityDays: -1},
		{IssuerID: root.ID, Subject: Subject{CommonName: "a.example", Country: "USA"}},
		{IssuerID: "missing", Subject: Subject{CommonName: "a.example"}},
		{IssuerID: root.ID, Profile: "bogus", Subject: Subject{CommonName: "a.example"}},
	}
	for i, c := range cases {
		if _, err := s.Issue(Platform, c); err == nil {
			t.Errorf("case %d: expected an error", i)
		}
	}
	// Client certificates need neither DNS nor IP names.
	if _, err := s.Issue(Platform, CertRequest{IssuerID: root.ID, Profile: ProfileClient, Subject: Subject{CommonName: "alice"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Issue(Platform, CertRequest{IssuerID: root.ID, SANs: SANs{DNS: []string{"*.example.com"}}}); err != nil {
		t.Fatalf("wildcard rejected: %v", err)
	}
}

func TestSignCSR(t *testing.T) {
	s := openTest(t, t.TempDir())
	root, _ := hierarchy(t, s)
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject:  pkix.Name{CommonName: "csr.example.com", Organization: []string{"Req"}},
		DNSNames: []string{"csr.example.com", "alt.example.com"},
	}, key)
	if err != nil {
		t.Fatal(err)
	}
	csrPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der}))
	v, err := s.SignCSR(Platform, CSRRequest{IssuerID: root.ID, CSR: csrPEM, ValidityDays: 30})
	if err != nil {
		t.Fatal(err)
	}
	if v.HasKey || v.Source != SourceCSR || len(v.Details.SANs.DNS) != 2 || v.Details.Subject.Organization != "Req" {
		t.Fatalf("unexpected view: %+v", v)
	}
	if !samePublicKey(mustCert(t, v).PublicKey, key.Public()) {
		t.Fatal("certificate does not carry the CSR key")
	}
	if _, err := s.Export(Platform, v.ID, KindLeaf, FormatKey); err == nil {
		t.Fatal("expected no key for CSR certificate")
	}
	if _, err := s.Renew(Platform, v.ID, RenewRequest{}); err == nil {
		t.Fatal("renewing a CSR certificate with a new key must fail")
	}
	r, err := s.Renew(Platform, v.ID, RenewRequest{ReuseKey: true})
	if err != nil {
		t.Fatal(err)
	}
	if r.RenewedFrom != v.ID || !samePublicKey(mustCert(t, r).PublicKey, key.Public()) {
		t.Fatalf("unexpected renewal: %+v", r)
	}
	bad := strings.Replace(csrPEM, "CERTIFICATE REQUEST", "CERTIFICATE", -1)
	if _, err := s.SignCSR(Platform, CSRRequest{IssuerID: root.ID, CSR: bad}); err == nil {
		t.Fatal("expected CSR parse error")
	}
}

func TestRevokeAndCRL(t *testing.T) {
	s := openTest(t, t.TempDir())
	root, sub := hierarchy(t, s)
	leaf, err := s.Issue(Platform, CertRequest{IssuerID: sub.ID, Subject: Subject{CommonName: "r.example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.CRL(sub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Revoke(Platform, leaf.ID, KindLeaf, "keyCompromise"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Revoke(Platform, leaf.ID, KindLeaf, ""); err == nil {
		t.Fatal("double revoke must fail")
	}
	if _, err := s.Revoke(Platform, root.ID, KindCA, ""); err == nil {
		t.Fatal("revoking a root must fail")
	}
	der, err := s.CRL(sub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first, der) {
		t.Fatal("CRL was not re-signed after a revocation")
	}
	crl, err := x509.ParseRevocationList(der)
	if err != nil {
		t.Fatal(err)
	}
	if err := crl.CheckSignatureFrom(mustCert(t, sub)); err != nil {
		t.Fatal(err)
	}
	if len(crl.RevokedCertificateEntries) != 1 || crl.RevokedCertificateEntries[0].SerialNumber.Cmp(mustCert(t, leaf).SerialNumber) != 0 {
		t.Fatalf("unexpected CRL entries: %+v", crl.RevokedCertificateEntries)
	}
	if crl.Number.Int64() != 2 {
		t.Fatalf("CRL number = %d, want 2", crl.Number.Int64())
	}
	if _, err := s.Revoke(Platform, sub.ID, KindCA, "cessationOfOperation"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Issue(Platform, CertRequest{IssuerID: sub.ID, Subject: Subject{CommonName: "x.example.com"}}); err == nil {
		t.Fatal("revoked CA must not issue")
	}
}

func TestExports(t *testing.T) {
	s := openTest(t, t.TempDir())
	root, sub := hierarchy(t, s)
	leaf, err := s.Issue(Platform, CertRequest{IssuerID: sub.ID, Name: "*.example.com", SANs: SANs{DNS: []string{"*.example.com"}}})
	if err != nil {
		t.Fatal(err)
	}
	full, err := s.Export(Platform, leaf.ID, KindLeaf, FormatFullchain)
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(string(full.Data), "BEGIN CERTIFICATE"); n != 2 || full.Name != "wildcard.example.com.fullchain.pem" {
		t.Fatalf("fullchain has %d certs, name %q", n, full.Name)
	}
	chain, _ := s.Export(Platform, leaf.ID, KindLeaf, FormatChain)
	if n := strings.Count(string(chain.Data), "BEGIN CERTIFICATE"); n != 2 {
		t.Fatalf("chain has %d certs", n)
	}
	keyFile, err := s.Export(Platform, leaf.ID, KindLeaf, FormatKey)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ParseKeyPEM(keyFile.Data)
	if err != nil || !samePublicKey(key.Public(), mustCert(t, leaf).PublicKey) {
		t.Fatalf("exported key does not match: %v", err)
	}
	bundle, err := s.Export(Platform, leaf.ID, KindLeaf, FormatBundle)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(bundle.Data), int64(len(bundle.Data)))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, filepath.Base(f.Name))
	}
	if got := strings.Join(names, ","); got != "cert.pem,fullchain.pem,chain.pem,ca.pem,privkey.pem" {
		t.Fatalf("bundle files: %s", got)
	}
	for _, legacy := range []bool{false, true} {
		p12, err := s.PKCS12(Platform, leaf.ID, KindLeaf, "secret-pass", legacy)
		if err != nil {
			t.Fatal(err)
		}
		_, cert, cas, err := pkcs12.DecodeChain(p12.Data, "secret-pass")
		if err != nil {
			t.Fatal(err)
		}
		if cert.SerialNumber.Cmp(mustCert(t, leaf).SerialNumber) != 0 || len(cas) != 2 {
			t.Fatalf("unexpected p12 contents (%d CAs)", len(cas))
		}
	}
	if _, err := s.Export(Platform, root.ID, KindCA, FormatChain); err == nil {
		t.Fatal("a root has no chain")
	}
	if _, err := s.Export(Platform, root.ID, KindCA, FormatCRLPEM); err != nil {
		t.Fatal(err)
	}
}

func TestImportAdoptsOrphans(t *testing.T) {
	src := openTest(t, t.TempDir())
	root, sub := hierarchy(t, src)
	subKey, _ := src.Export(Platform, sub.ID, KindCA, FormatKey)
	rootKey, _ := src.Export(Platform, root.ID, KindCA, FormatKey)

	s := openTest(t, t.TempDir())
	// Import the sub-CA first: its issuer is unknown yet.
	gotSub, err := s.Import(ImportRequest{Certificate: sub.CertPEM, PrivateKey: string(subKey.Data)})
	if err != nil {
		t.Fatal(err)
	}
	if gotSub.IssuerID != "" || gotSub.Profile != ProfileIntermediate {
		t.Fatalf("unexpected import: %+v", gotSub)
	}
	if _, err := s.Import(ImportRequest{Certificate: root.CertPEM, PrivateKey: string(subKey.Data)}); err == nil {
		t.Fatal("mismatched key must be rejected")
	}
	gotRoot, err := s.Import(ImportRequest{Certificate: root.CertPEM, PrivateKey: string(rootKey.Data)})
	if err != nil {
		t.Fatal(err)
	}
	v, _ := s.Get(Platform, gotSub.ID, KindCA)
	if v.IssuerID != gotRoot.ID {
		t.Fatalf("sub-CA was not linked to the imported root: %+v", v.IssuerID)
	}
	if _, err := s.Import(ImportRequest{Certificate: root.CertPEM}); err == nil {
		t.Fatal("duplicate import must fail")
	}
	if _, err := s.Issue(Platform, CertRequest{IssuerID: gotSub.ID, Subject: Subject{CommonName: "imported.example.com"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(Platform, gotRoot.ID, KindCA); err == nil {
		t.Fatal("deleting a CA with sub-CAs must fail")
	}
}

func TestPersistence(t *testing.T) {
	dir := t.TempDir()
	s := openTest(t, dir)
	root, sub := hierarchy(t, s)
	leaf, _ := s.Issue(Platform, CertRequest{IssuerID: sub.ID, Subject: Subject{CommonName: "p.example.com"}})
	if _, err := s.Rename(Platform, leaf.ID, KindLeaf, "Persisted"); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "pki.json"))
	if strings.Contains(string(data), "PRIVATE KEY") {
		t.Fatal("private keys are stored in plain text")
	}

	s2 := openTest(t, dir)
	if got := s2.List(Platform, Filter{Kind: KindCA}); len(got) != 2 || got[0].ID != root.ID {
		t.Fatalf("unexpected CA list after reopen: %+v", got)
	}
	v, err := s2.Get(Platform, leaf.ID, KindLeaf)
	if err != nil || v.Name != "Persisted" || !v.HasKey {
		t.Fatalf("reopened leaf: %+v, %v", v, err)
	}
	if _, err := s2.Export(Platform, leaf.ID, KindLeaf, FormatKey); err != nil {
		t.Fatal(err)
	}

	os.Remove(filepath.Join(dir, "master.key"))
	if _, err := Open(dir, testOptions); err == nil {
		t.Fatal("opening sealed records without the master key must fail")
	}
}

func TestDeleteAndNotFound(t *testing.T) {
	s := openTest(t, t.TempDir())
	root, sub := hierarchy(t, s)
	if err := s.Delete(Platform, root.ID, KindCA); err == nil {
		t.Fatal("expected conflict")
	}
	if _, err := s.Get(Platform, sub.ID, KindLeaf); !errors.Is(err, ErrNotFound) {
		t.Fatalf("kind mismatch must be not found, got %v", err)
	}
	if err := s.Delete(Platform, sub.ID, KindCA); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(Platform, root.ID, KindCA); err != nil {
		t.Fatal(err)
	}
	if len(s.List(Platform, Filter{})) != 0 {
		t.Fatal("store not empty")
	}
}

func TestInspect(t *testing.T) {
	s := openTest(t, t.TempDir())
	root, _ := hierarchy(t, s)
	key, _ := s.Export(Platform, root.ID, KindCA, FormatKey)
	items, err := s.Inspect(Platform, string(key.Data)+root.CertPEM)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Key == nil || items[0].Key.MatchesCertificate != 1 || items[1].KnownID != root.ID {
		t.Fatalf("unexpected inspection: %+v", items)
	}
	if _, err := s.Inspect(Platform, "hello"); err == nil {
		t.Fatal("expected error for non-PEM input")
	}
}

func TestTenantScope(t *testing.T) {
	s := openTest(t, t.TempDir())
	root, err := s.CreateCA(Platform, CARequest{Subject: Subject{CommonName: "Platform Root"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCA(Platform, CARequest{Subject: Subject{CommonName: "Tenant Root"}, TenantID: "a"}); err == nil {
		t.Fatal("root CA assigned to a tenant")
	}
	a := Scope{Tenant: "a"}
	b := Scope{Tenant: "b"}
	if _, err := s.CreateCA(a, CARequest{Subject: Subject{CommonName: "Own Root"}}); err == nil {
		t.Fatal("tenant created a root CA")
	}
	subA, err := s.CreateCA(Platform, CARequest{IssuerID: root.ID, Subject: Subject{CommonName: "A Issuing"}, TenantID: "a"})
	if err != nil {
		t.Fatal(err)
	}
	subB, err := s.CreateCA(Platform, CARequest{IssuerID: root.ID, Subject: Subject{CommonName: "B Issuing"}})
	if err != nil {
		t.Fatal(err)
	}
	if subA.TenantID != "a" || subB.TenantID != "" {
		t.Fatalf("tenants: %q %q", subA.TenantID, subB.TenantID)
	}

	// Tenants issue from their own sub-CA only; children inherit the tenant.
	if _, err := s.Issue(a, CertRequest{IssuerID: root.ID, Subject: Subject{CommonName: "x.example.com"}}); err == nil {
		t.Fatal("tenant issued from the platform root")
	}
	leaf, err := s.Issue(a, CertRequest{IssuerID: subA.ID, Subject: Subject{CommonName: "a.example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	nested, err := s.CreateCA(a, CARequest{IssuerID: subA.ID, Subject: Subject{CommonName: "A Nested"}})
	if err != nil {
		t.Fatal(err)
	}
	if leaf.TenantID != "a" || nested.TenantID != "a" {
		t.Fatalf("inherited tenants: %q %q", leaf.TenantID, nested.TenantID)
	}

	// Tenant a sees its records and, read-only, the root above them.
	cas := s.List(a, Filter{Kind: KindCA})
	if len(cas) != 3 || cas[0].ID != root.ID || !cas[0].ReadOnly || cas[0].ChildCount != 1 || cas[1].ReadOnly {
		t.Fatalf("tenant CA list: %+v", cas)
	}
	if _, err := s.Get(a, subB.ID, KindCA); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other CA visible: %v", err)
	}
	if _, err := s.Get(b, leaf.ID, KindLeaf); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other tenant's certificate visible: %v", err)
	}
	var fe *ForbiddenError
	if _, err := s.Rename(a, root.ID, KindCA, "mine"); !errors.As(err, &fe) {
		t.Fatalf("renamed the platform root: %v", err)
	}
	if _, err := s.Export(a, root.ID, KindCA, FormatKey); !errors.As(err, &fe) {
		t.Fatalf("exported the root key: %v", err)
	}
	if _, err := s.Export(a, root.ID, KindCA, FormatCert); err != nil {
		t.Fatalf("root certificate download: %v", err)
	}
	if o := s.Overview(a); o.Authorities != 2 || o.Certificates != 1 {
		t.Fatalf("tenant overview: %+v", o)
	}

	// Reassigning moves the whole subtree.
	if _, err := s.AssignTenant(root.ID, "b"); err == nil {
		t.Fatal("root CA reassigned")
	}
	if _, err := s.AssignTenant(nested.ID, "b"); err == nil {
		t.Fatal("moved a CA out of its issuer's tenant")
	}
	if _, err := s.AssignTenant(subA.ID, "b"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Get(b, leaf.ID, KindLeaf); got.TenantID != "b" {
		t.Fatalf("leaf not moved: %+v", got)
	}
	if n := s.TenantRecords("a"); n != 0 {
		t.Fatalf("tenant a still owns %d records", n)
	}
}
