// Package config defines the on-disk configuration and a Store that
// serializes mutations and persists them atomically.
package config

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// template is the complete default configuration. It is written out when
// no config file exists and fills in fields missing from an existing one.
//
//go:embed template.json
var template []byte

type Config struct {
	Server  ServerConfig `json:"server"`
	Auth    AuthConfig   `json:"auth"`
	PKI     PKIConfig    `json:"pki"`
	Logging LogConfig    `json:"logging"`
	Update  UpdateConfig `json:"update"`
	DataDir string       `json:"dataDir"`
}

type ServerConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

type AuthConfig struct {
	Username      string `json:"username,omitempty"`
	PasswordHash  string `json:"passwordHash,omitempty"`
	SessionSecret string `json:"sessionSecret,omitempty"`
	SessionTTL    int    `json:"sessionTtl"` // seconds
	// Recovery lets the setup token reset the administrator (set by
	// -reset-auth, cleared once used).
	Recovery bool `json:"recovery,omitempty"`
}

type PKIConfig struct {
	// PublicURL is the externally reachable base URL of this instance. When
	// set, issued certificates point their CRL distribution point and CA
	// issuer URL at it.
	PublicURL           string `json:"publicUrl"`
	DefaultKeyAlgorithm string `json:"defaultKeyAlgorithm"`
	DefaultValidityDays int    `json:"defaultValidityDays"`
	ExpiryWarningDays   int    `json:"expiryWarningDays"`
}

type LogConfig struct {
	Level string `json:"level"`
}

type UpdateConfig struct {
	Enabled       bool   `json:"enabled"`
	Channel       string `json:"channel"`
	CheckInterval int    `json:"checkInterval"` // seconds
	Source        string `json:"source"`
	ProxyBaseURL  string `json:"proxyBaseUrl"`
	Repo          string `json:"repo"`
}

// FieldError is a validation failure tied to one input field.
type FieldError struct {
	Field string
	Msg   string
}

func (e *FieldError) Error() string { return e.Field + ": " + e.Msg }

// Default returns the embedded template.
func Default() *Config {
	var c Config
	if err := json.Unmarshal(template, &c); err != nil {
		panic("config template: " + err.Error())
	}
	return &c
}

// applyDefaults resets fields that must not be empty to their defaults.
func (c *Config) applyDefaults() {
	d := Default()
	if c.Server.Host == "" {
		c.Server.Host = d.Server.Host
	}
	if c.Server.Port == 0 {
		c.Server.Port = d.Server.Port
	}
	if c.Auth.SessionTTL <= 0 {
		c.Auth.SessionTTL = d.Auth.SessionTTL
	}
	if c.PKI.DefaultKeyAlgorithm == "" {
		c.PKI.DefaultKeyAlgorithm = d.PKI.DefaultKeyAlgorithm
	}
	if c.PKI.DefaultValidityDays <= 0 {
		c.PKI.DefaultValidityDays = d.PKI.DefaultValidityDays
	}
	if c.PKI.ExpiryWarningDays <= 0 {
		c.PKI.ExpiryWarningDays = d.PKI.ExpiryWarningDays
	}
	if c.Logging.Level == "" {
		c.Logging.Level = d.Logging.Level
	}
	if c.Update.Channel == "" {
		c.Update.Channel = d.Update.Channel
	}
	if c.Update.CheckInterval <= 0 {
		c.Update.CheckInterval = d.Update.CheckInterval
	}
	if c.Update.Source == "" {
		c.Update.Source = d.Update.Source
	}
	if c.Update.Repo == "" {
		c.Update.Repo = d.Update.Repo
	}
	if c.DataDir == "" {
		c.DataDir = d.DataDir
	}
}

// Validate checks the user-editable settings.
func (c *Config) Validate() error {
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return &FieldError{"server.port", "port must be 1-65535"}
	}
	if u := c.PKI.PublicURL; u != "" {
		p, err := url.Parse(u)
		if err != nil || (p.Scheme != "http" && p.Scheme != "https") || p.Host == "" {
			return &FieldError{"pki.publicUrl", "public URL must be an absolute http(s) URL"}
		}
		if p.RawQuery != "" || p.Fragment != "" {
			return &FieldError{"pki.publicUrl", "public URL must not contain a query or fragment"}
		}
	}
	if c.PKI.DefaultValidityDays > 36500 {
		return &FieldError{"pki.defaultValidityDays", "validity must be 1-36500 days"}
	}
	if c.PKI.ExpiryWarningDays > 365 {
		return &FieldError{"pki.expiryWarningDays", "warning window must be 1-365 days"}
	}
	switch c.Logging.Level {
	case "debug", "info", "warn", "error":
	default:
		return &FieldError{"logging.level", "level must be debug, info, warn or error"}
	}
	if c.Update.Channel != "stable" && c.Update.Channel != "dev" {
		return &FieldError{"update.channel", "channel must be stable or dev"}
	}
	if c.Update.Source != "github" && c.Update.Source != "proxy" {
		return &FieldError{"update.source", "source must be github or proxy"}
	}
	if c.Update.CheckInterval < 60 {
		return &FieldError{"update.checkInterval", "interval must be at least 60 seconds"}
	}
	if parts := strings.Split(c.Update.Repo, "/"); len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return &FieldError{"update.repo", "repo must be owner/name"}
	}
	if c.Update.Source == "proxy" && !strings.HasPrefix(c.Update.ProxyBaseURL, "http://") && !strings.HasPrefix(c.Update.ProxyBaseURL, "https://") {
		return &FieldError{"update.proxyBaseUrl", "proxy URL must start with http:// or https://"}
	}
	return nil
}

// PublicBase returns the public URL without a trailing slash, or "".
func (c *Config) PublicBase() string {
	return strings.TrimRight(c.PKI.PublicURL, "/")
}

// parse decodes data over the defaults, so fields absent from the file keep
// their default values. incomplete reports whether any were absent.
func parse(data []byte) (c *Config, incomplete bool, err error) {
	c = Default()
	if err := json.Unmarshal(data, c); err != nil {
		return nil, false, err
	}
	c.applyDefaults()
	var want, have map[string]any
	if err := json.Unmarshal(template, &want); err != nil {
		panic("config template: " + err.Error())
	}
	if err := json.Unmarshal(data, &have); err != nil {
		return nil, false, err
	}
	return c, missingKeys(want, have), nil
}

// missingKeys reports whether have lacks (or nulls) any key of want,
// descending into nested objects.
func missingKeys(want, have map[string]any) bool {
	for k, w := range want {
		h, ok := have[k]
		if !ok || h == nil {
			return true
		}
		wm, wok := w.(map[string]any)
		hm, hok := h.(map[string]any)
		if wok && hok && missingKeys(wm, hm) {
			return true
		}
	}
	return false
}

// Store owns the current configuration and its file. All mutations go
// through Update, which validates, persists atomically, then publishes.
type Store struct {
	path string
	mu   sync.Mutex // serializes writers
	rw   sync.RWMutex
	cur  *Config
}

// OpenState reports what Open did to the config file.
type OpenState int

const (
	Loaded    OpenState = iota // read unchanged
	Created                    // did not exist; written from the template
	Completed                  // missing fields filled in from the template and saved
)

// Open loads path. A missing file is created from the template, and a file
// lacking fields is completed from it and rewritten.
func Open(path string) (*Store, OpenState, error) {
	s := &Store{path: path}
	state := Loaded
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		s.cur, state = Default(), Created
	} else if err != nil {
		return nil, Loaded, err
	} else {
		var incomplete bool
		s.cur, incomplete, err = parse(data)
		if err != nil {
			return nil, Loaded, err
		}
		if incomplete {
			state = Completed
		}
	}
	s.cur.applyDefaults()
	if err := s.cur.Validate(); err != nil {
		return nil, Loaded, err
	}
	if state != Loaded {
		if err := writeJSONFile(path, s.cur); err != nil {
			return nil, Loaded, err
		}
	}
	return s, state, nil
}

func (s *Store) Path() string { return s.path }

// Get returns a copy of the current config.
func (s *Store) Get() *Config {
	s.rw.RLock()
	defer s.rw.RUnlock()
	out := *s.cur
	return &out
}

// DataDir resolves the data directory relative to the config file.
func (s *Store) DataDir() string {
	dir := s.Get().DataDir
	if filepath.IsAbs(dir) {
		return dir
	}
	return filepath.Join(filepath.Dir(s.path), dir)
}

// Update applies fn to a copy of the config and persists the result. If fn
// or the write fails, the current config is left unchanged.
func (s *Store) Update(fn func(c *Config) error) (*Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.Get()
	if err := fn(next); err != nil {
		return nil, err
	}
	next.applyDefaults()
	if err := next.Validate(); err != nil {
		return nil, err
	}
	if err := writeJSONFile(s.path, next); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}
	s.rw.Lock()
	s.cur = next
	s.rw.Unlock()
	return s.Get(), nil
}

// writeJSONFile writes v to path atomically with mode 0600.
func writeJSONFile(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(path, append(data, '\n'))
}

// WriteFileAtomic replaces path with data through a synced temp file, so a
// crash never leaves a truncated file behind.
func WriteFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
