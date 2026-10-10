package pki

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/lieyanc/FireSSL/internal/config"
)

// Private keys are stored sealed with AES-256-GCM under a master key kept in
// its own file, so a copy of the database alone does not expose them.

const sealPrefix = "v1:"

type sealer struct{ aead cipher.AEAD }

// loadMasterKey reads the master key at path, creating it when create is
// set and the file does not exist yet.
func loadMasterKey(path string, create bool) (*sealer, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) && create {
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, err
		}
		if err := config.WriteFileAtomic(path, []byte(base64.StdEncoding.EncodeToString(key)+"\n")); err != nil {
			return nil, fmt.Errorf("write master key: %w", err)
		}
		return newSealer(key)
	}
	if err != nil {
		return nil, fmt.Errorf("read master key: %w", err)
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(data)))
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("master key %s is malformed", path)
	}
	return newSealer(key)
}

func newSealer(key []byte) (*sealer, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &sealer{aead}, nil
}

func (s *sealer) seal(plain []byte, id string) string {
	nonce := make([]byte, s.aead.NonceSize())
	rand.Read(nonce)
	out := s.aead.Seal(nonce, nonce, plain, []byte(id))
	return sealPrefix + base64.StdEncoding.EncodeToString(out)
}

func (s *sealer) open(sealed, id string) ([]byte, error) {
	raw, ok := strings.CutPrefix(sealed, sealPrefix)
	if !ok {
		return nil, errors.New("unknown key encoding")
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(data) < s.aead.NonceSize() {
		return nil, errors.New("malformed sealed key")
	}
	n := s.aead.NonceSize()
	plain, err := s.aead.Open(nil, data[:n], data[n:], []byte(id))
	if err != nil {
		return nil, errors.New("cannot decrypt private key: wrong master key")
	}
	return plain, nil
}
