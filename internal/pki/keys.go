package pki

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/pem"
	"errors"
	"fmt"
	"slices"
)

// Key algorithms offered for new keys.
const (
	RSA2048   = "rsa-2048"
	RSA3072   = "rsa-3072"
	RSA4096   = "rsa-4096"
	ECDSAP256 = "ecdsa-p256"
	ECDSAP384 = "ecdsa-p384"
	Ed25519   = "ed25519"
)

var KeyAlgorithms = []string{ECDSAP256, ECDSAP384, RSA2048, RSA3072, RSA4096, Ed25519}

func ValidKeyAlgorithm(alg string) bool { return slices.Contains(KeyAlgorithms, alg) }

// GenerateKey creates a private key for one of KeyAlgorithms.
func GenerateKey(alg string) (crypto.Signer, error) {
	switch alg {
	case RSA2048:
		return rsa.GenerateKey(rand.Reader, 2048)
	case RSA3072:
		return rsa.GenerateKey(rand.Reader, 3072)
	case RSA4096:
		return rsa.GenerateKey(rand.Reader, 4096)
	case ECDSAP256:
		return ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	case ECDSAP384:
		return ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	case Ed25519:
		_, k, err := ed25519.GenerateKey(rand.Reader)
		return k, err
	}
	return nil, &FieldError{Field: "keyAlgorithm", Msg: "unsupported key algorithm " + alg}
}

// KeyAlgorithmOf names the algorithm of a public key in KeyAlgorithms terms,
// falling back to a descriptive name for sizes we do not generate.
func KeyAlgorithmOf(pub crypto.PublicKey) string {
	switch k := pub.(type) {
	case *rsa.PublicKey:
		return fmt.Sprintf("rsa-%d", k.N.BitLen())
	case *ecdsa.PublicKey:
		switch k.Curve {
		case elliptic.P256():
			return ECDSAP256
		case elliptic.P384():
			return ECDSAP384
		case elliptic.P521():
			return "ecdsa-p521"
		}
		return "ecdsa"
	case ed25519.PublicKey:
		return Ed25519
	}
	return "unknown"
}

// MarshalKeyPEM encodes a private key as PKCS#8 PEM.
func MarshalKeyPEM(key crypto.Signer) ([]byte, error) {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}

// ParseKeyPEM reads the first private key in PEM data (PKCS#8, PKCS#1 or
// SEC 1). Encrypted keys are rejected.
func ParseKeyPEM(data []byte) (crypto.Signer, error) {
	for {
		var block *pem.Block
		block, data = pem.Decode(data)
		if block == nil {
			return nil, errors.New("no private key found in PEM data")
		}
		if block.Headers["Proc-Type"] != "" || block.Type == "ENCRYPTED PRIVATE KEY" {
			return nil, errors.New("encrypted private keys are not supported; decrypt it first (openssl pkey -in key.pem -out plain.pem)")
		}
		var (
			key any
			err error
		)
		switch block.Type {
		case "PRIVATE KEY":
			key, err = x509.ParsePKCS8PrivateKey(block.Bytes)
		case "RSA PRIVATE KEY":
			key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		case "EC PRIVATE KEY":
			key, err = x509.ParseECPrivateKey(block.Bytes)
		default:
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		signer, ok := key.(crypto.Signer)
		if !ok {
			return nil, errors.New("unsupported private key type")
		}
		return signer, nil
	}
}

// samePublicKey reports whether a and b are the same public key.
func samePublicKey(a, b crypto.PublicKey) bool {
	type equaler interface{ Equal(crypto.PublicKey) bool }
	e, ok := a.(equaler)
	return ok && e.Equal(b)
}

// subjectKeyID derives the key identifier from the SHA-1 of the public key
// bits (RFC 5280 4.2.1.2, method 1).
func subjectKeyID(pub crypto.PublicKey) ([]byte, error) {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return nil, err
	}
	var spki struct {
		Algorithm pkix.AlgorithmIdentifier
		PublicKey asn1.BitString
	}
	if _, err := asn1.Unmarshal(der, &spki); err != nil {
		return nil, err
	}
	sum := sha1.Sum(spki.PublicKey.Bytes)
	return sum[:], nil
}
