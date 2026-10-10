package auth

import (
	"path/filepath"
	"testing"

	"github.com/lieyanc/FireSSL/internal/config"
	"github.com/lieyanc/FireSSL/internal/iam"
)

func TestMigrateLegacyAdmin(t *testing.T) {
	dir := t.TempDir()
	store, _, err := config.Open(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := HashPassword("password123")
	store.Update(func(c *config.Config) error {
		c.Auth.Username, c.Auth.PasswordHash, c.Auth.SessionSecret = "admin", hash, "secret"
		return nil
	})
	users, err := iam.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(store, users)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Initialized() || s.SetupAvailable() {
		t.Fatal("migrated administrator not recognized")
	}
	if a := store.Get().Auth; a.Username != "" || a.PasswordHash != "" {
		t.Fatal("legacy credentials left in the config")
	}
	p, err := s.Login("admin", "password123", "127.0.0.1")
	if err != nil || !p.Admin {
		t.Fatalf("login after migration: %v %+v", err, p)
	}
	// The directory survives a reopen.
	again, _ := iam.Open(dir)
	if _, ok := again.UserByName("ADMIN"); !ok {
		t.Fatal("directory not persisted")
	}
}
