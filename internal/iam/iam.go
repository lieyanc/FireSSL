// Package iam keeps the user directory: accounts, tenants and the role each
// member holds in a tenant. Passwords are hashed by the auth package; this
// package only stores them.
package iam

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/lieyanc/FireSSL/internal/config"
)

var ErrNotFound = errors.New("not found")

// Role is what a member may do inside one tenant.
type Role string

const (
	RoleOwner    Role = "owner"    // everything below, plus the tenant's sub-CAs and members
	RoleOperator Role = "operator" // issues, renews and revokes certificates, exports their keys
	RoleViewer   Role = "viewer"   // reads the inventory and downloads public material
)

var Roles = []Role{RoleOwner, RoleOperator, RoleViewer}

func (r Role) Valid() bool { return slices.Contains(Roles, r) }

// Perm is one capability inside a tenant.
type Perm int

const (
	PermView     Perm = iota // list and read records, download certificates and CRLs
	PermIssue                // leaf certificates: issue, renew, revoke, rename, delete, export keys
	PermManageCA             // the tenant's sub-CAs: create, revoke, rename, delete, export keys
	PermMembers              // add, change and remove members
)

func (r Role) Can(p Perm) bool {
	switch r {
	case RoleOwner:
		return true
	case RoleOperator:
		return p == PermView || p == PermIssue
	case RoleViewer:
		return p == PermView
	}
	return false
}

// User is an account. Admin marks a system administrator, who manages the
// platform (root CAs, tenants, users, settings) and acts as owner in every
// tenant.
type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
	Admin        bool   `json:"admin,omitempty"`
	Disabled     bool   `json:"disabled,omitempty"`
	// SessionGen is part of every session; bumping it signs the user out.
	SessionGen int       `json:"sessionGen"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Member struct {
	UserID string `json:"userId"`
	Role   Role   `json:"role"`
}

type Tenant struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Members     []Member  `json:"members"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Membership is one tenant a user belongs to.
type Membership struct {
	TenantID   string `json:"id"`
	TenantName string `json:"name"`
	Role       Role   `json:"role"`
}

type fileFormat struct {
	Version int      `json:"version"`
	Users   []User   `json:"users"`
	Tenants []Tenant `json:"tenants"`
}

// Store holds the directory in memory and persists it atomically. Every
// getter returns copies.
type Store struct {
	path string

	mu      sync.RWMutex
	users   []User
	tenants []Tenant
}

// Open loads (or creates) the directory in dir.
func Open(dir string) (*Store, error) {
	s := &Store{path: filepath.Join(dir, "iam.json")}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("parse %s: %w", s.path, err)
	}
	s.users, s.tenants = f.Users, f.Tenants
	for i := range s.tenants {
		if s.tenants[i].Members == nil {
			s.tenants[i].Members = []Member{}
		}
	}
	return s, nil
}

// commitLocked applies fn to copies of the directory and persists them; on
// any error the directory is left unchanged.
func (s *Store) commitLocked(fn func(users *[]User, tenants *[]Tenant) error) error {
	users := slices.Clone(s.users)
	tenants := cloneTenants(s.tenants)
	if err := fn(&users, &tenants); err != nil {
		return err
	}
	data, err := json.MarshalIndent(fileFormat{Version: 1, Users: users, Tenants: tenants}, "", "  ")
	if err != nil {
		return err
	}
	if err := config.WriteFileAtomic(s.path, append(data, '\n')); err != nil {
		return fmt.Errorf("save directory: %w", err)
	}
	s.users, s.tenants = users, tenants
	return nil
}

func cloneTenants(ts []Tenant) []Tenant {
	out := make([]Tenant, len(ts))
	for i, t := range ts {
		t.Members = slices.Clone(t.Members)
		out[i] = t
	}
	return out
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func now() time.Time { return time.Now().UTC().Truncate(time.Second) }

// Users.

func (s *Store) Users() []User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return slices.Clone(s.users)
}

func (s *Store) User(id string) (User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if i := s.userIndex(s.users, id); i >= 0 {
		return s.users[i], true
	}
	return User{}, false
}

// UserByName looks a user up by name, ignoring case.
func (s *Store) UserByName(name string) (User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.users {
		if strings.EqualFold(u.Username, name) {
			return u, true
		}
	}
	return User{}, false
}

// HasAdmin reports whether an enabled system administrator exists.
func (s *Store) HasAdmin() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return activeAdmins(s.users) > 0
}

func (s *Store) userIndex(users []User, id string) int {
	return slices.IndexFunc(users, func(u User) bool { return u.ID == id })
}

func activeAdmins(users []User) int {
	n := 0
	for _, u := range users {
		if u.Admin && !u.Disabled {
			n++
		}
	}
	return n
}

func nameTaken(users []User, name, except string) bool {
	return slices.ContainsFunc(users, func(u User) bool { return u.ID != except && strings.EqualFold(u.Username, name) })
}

// CreateUser adds u with a new ID. The username must be free.
func (s *Store) CreateUser(u User) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u.ID, u.CreatedAt = newID(), now()
	err := s.commitLocked(func(users *[]User, _ *[]Tenant) error {
		if nameTaken(*users, u.Username, "") {
			return &config.FieldError{Field: "username", Msg: "this username is already taken"}
		}
		*users = append(*users, u)
		return nil
	})
	return u, err
}

// UpdateUser applies fn to a user. At least one enabled administrator must
// remain afterwards.
func (s *Store) UpdateUser(id string, fn func(u *User) error) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out User
	err := s.commitLocked(func(users *[]User, _ *[]Tenant) error {
		i := s.userIndex(*users, id)
		if i < 0 {
			return fmt.Errorf("user %s %w", id, ErrNotFound)
		}
		u := &(*users)[i]
		if err := fn(u); err != nil {
			return err
		}
		if nameTaken(*users, u.Username, u.ID) {
			return &config.FieldError{Field: "username", Msg: "this username is already taken"}
		}
		if activeAdmins(*users) == 0 {
			return &config.ConflictError{Msg: "at least one enabled system administrator must remain"}
		}
		out = *u
		return nil
	})
	return out, err
}

// DeleteUser removes a user and their memberships.
func (s *Store) DeleteUser(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.commitLocked(func(users *[]User, tenants *[]Tenant) error {
		i := s.userIndex(*users, id)
		if i < 0 {
			return fmt.Errorf("user %s %w", id, ErrNotFound)
		}
		*users = slices.Delete(*users, i, i+1)
		if activeAdmins(*users) == 0 {
			return &config.ConflictError{Msg: "at least one enabled system administrator must remain"}
		}
		for j := range *tenants {
			t := &(*tenants)[j]
			t.Members = slices.DeleteFunc(t.Members, func(m Member) bool { return m.UserID == id })
		}
		return nil
	})
}

// Tenants.

func (s *Store) Tenants() []Tenant {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneTenants(s.tenants)
}

func (s *Store) Tenant(id string) (Tenant, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if i := tenantIndex(s.tenants, id); i >= 0 {
		return cloneTenants(s.tenants[i : i+1])[0], true
	}
	return Tenant{}, false
}

func tenantIndex(tenants []Tenant, id string) int {
	return slices.IndexFunc(tenants, func(t Tenant) bool { return t.ID == id })
}

func normalizeTenant(name, description *string) error {
	*name, *description = strings.TrimSpace(*name), strings.TrimSpace(*description)
	if n := utf8.RuneCountInString(*name); n < 1 || n > 64 {
		return &config.FieldError{Field: "name", Msg: "name must be 1-64 characters"}
	}
	if utf8.RuneCountInString(*description) > 256 {
		return &config.FieldError{Field: "description", Msg: "description must be at most 256 characters"}
	}
	return nil
}

func tenantNameTaken(tenants []Tenant, name, except string) bool {
	return slices.ContainsFunc(tenants, func(t Tenant) bool { return t.ID != except && strings.EqualFold(t.Name, name) })
}

func (s *Store) CreateTenant(name, description string) (Tenant, error) {
	if err := normalizeTenant(&name, &description); err != nil {
		return Tenant{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t := Tenant{ID: newID(), Name: name, Description: description, Members: []Member{}, CreatedAt: now()}
	err := s.commitLocked(func(_ *[]User, tenants *[]Tenant) error {
		if tenantNameTaken(*tenants, name, "") {
			return &config.FieldError{Field: "name", Msg: "a tenant with this name already exists"}
		}
		*tenants = append(*tenants, t)
		return nil
	})
	return t, err
}

func (s *Store) UpdateTenant(id, name, description string) (Tenant, error) {
	if err := normalizeTenant(&name, &description); err != nil {
		return Tenant{}, err
	}
	return s.updateTenant(id, func(tenants []Tenant, t *Tenant) error {
		if tenantNameTaken(tenants, name, id) {
			return &config.FieldError{Field: "name", Msg: "a tenant with this name already exists"}
		}
		t.Name, t.Description = name, description
		return nil
	})
}

func (s *Store) updateTenant(id string, fn func(tenants []Tenant, t *Tenant) error) (Tenant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out Tenant
	err := s.commitLocked(func(_ *[]User, tenants *[]Tenant) error {
		i := tenantIndex(*tenants, id)
		if i < 0 {
			return fmt.Errorf("tenant %s %w", id, ErrNotFound)
		}
		if err := fn(*tenants, &(*tenants)[i]); err != nil {
			return err
		}
		out = cloneTenants((*tenants)[i : i+1])[0]
		return nil
	})
	return out, err
}

func (s *Store) DeleteTenant(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.commitLocked(func(_ *[]User, tenants *[]Tenant) error {
		i := tenantIndex(*tenants, id)
		if i < 0 {
			return fmt.Errorf("tenant %s %w", id, ErrNotFound)
		}
		*tenants = slices.Delete(*tenants, i, i+1)
		return nil
	})
}

// Members.

// SetMember adds a user to a tenant or changes their role.
func (s *Store) SetMember(tenantID, userID string, role Role) (Tenant, error) {
	if !role.Valid() {
		return Tenant{}, &config.FieldError{Field: "role", Msg: "role must be owner, operator or viewer"}
	}
	if _, ok := s.User(userID); !ok {
		return Tenant{}, fmt.Errorf("user %s %w", userID, ErrNotFound)
	}
	return s.updateTenant(tenantID, func(_ []Tenant, t *Tenant) error {
		if i := slices.IndexFunc(t.Members, func(m Member) bool { return m.UserID == userID }); i >= 0 {
			t.Members[i].Role = role
		} else {
			t.Members = append(t.Members, Member{UserID: userID, Role: role})
		}
		return nil
	})
}

func (s *Store) RemoveMember(tenantID, userID string) (Tenant, error) {
	return s.updateTenant(tenantID, func(_ []Tenant, t *Tenant) error {
		i := slices.IndexFunc(t.Members, func(m Member) bool { return m.UserID == userID })
		if i < 0 {
			return fmt.Errorf("member %s %w", userID, ErrNotFound)
		}
		t.Members = slices.Delete(t.Members, i, i+1)
		return nil
	})
}

// Role returns the user's role in a tenant.
func (s *Store) Role(tenantID, userID string) (Role, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if i := tenantIndex(s.tenants, tenantID); i >= 0 {
		for _, m := range s.tenants[i].Members {
			if m.UserID == userID {
				return m.Role, true
			}
		}
	}
	return "", false
}

// Memberships lists the tenants a user belongs to, in creation order.
func (s *Store) Memberships(userID string) []Membership {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Membership{}
	for _, t := range s.tenants {
		for _, m := range t.Members {
			if m.UserID == userID {
				out = append(out, Membership{TenantID: t.ID, TenantName: t.Name, Role: m.Role})
			}
		}
	}
	return out
}
