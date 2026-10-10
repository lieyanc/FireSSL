package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/lieyanc/FireSSL/internal/api"
	"github.com/lieyanc/FireSSL/internal/auth"
	"github.com/lieyanc/FireSSL/internal/config"
	"github.com/lieyanc/FireSSL/internal/iam"
	"github.com/lieyanc/FireSSL/internal/pki"
	"github.com/lieyanc/FireSSL/internal/updater"
	"github.com/lieyanc/FireSSL/internal/version"
	"github.com/lieyanc/FireSSL/web"
)

var logLevel = new(slog.LevelVar)

func setLogLevel(level string) {
	var l slog.Level
	if err := l.UnmarshalText([]byte(level)); err == nil {
		logLevel.Set(l)
	}
}

func main() {
	cfgPath := flag.String("c", "config.json", "path to config file (created or completed from the default template)")
	showVersion := flag.Bool("v", false, "print version and exit")
	resetAuth := flag.Bool("reset-auth", false, "enable account recovery, then exit; the next start prints a setup token that creates or resets a system administrator")
	flag.Parse()
	if *showVersion {
		fmt.Printf("FireSSL %s (commit %s, built %s)\n", version.Version, version.Commit, version.BuildTime)
		return
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})))

	start := time.Now()
	store, state, err := config.Open(*cfgPath)
	if err != nil {
		slog.Error("configuration error", "configPath", *cfgPath, "err", err,
			"suggestion", "fix the file, or remove it to start with defaults")
		os.Exit(1)
	}
	if *resetAuth {
		if _, err := store.Update(func(c *config.Config) error { c.Auth.Recovery = true; return nil }); err != nil {
			fmt.Fprintln(os.Stderr, "reset failed:", err)
			os.Exit(1)
		}
		fmt.Println("Account recovery enabled. Restart FireSSL, open the web UI and enter the setup token it logs to create or reset a system administrator.")
		return
	}
	cfg := store.Get()
	setLogLevel(cfg.Logging.Level)
	switch state {
	case config.Created:
		slog.Info("no config file found, created one from the default template", "configPath", *cfgPath)
	case config.Completed:
		slog.Info("config file was missing fields, filled them in with defaults", "configPath", *cfgPath)
	}

	pkiStore, err := pki.Open(store.DataDir(), func() pki.Options {
		c := store.Get()
		return pki.Options{
			PublicBase:  c.PublicBase(),
			ExpiryWarn:  time.Duration(c.PKI.ExpiryWarningDays) * 24 * time.Hour,
			DefaultAlg:  c.PKI.DefaultKeyAlgorithm,
			DefaultDays: c.PKI.DefaultValidityDays,
		}
	})
	if err != nil {
		slog.Error("failed to open the certificate database", "dataDir", store.DataDir(), "err", err)
		os.Exit(1)
	}
	users, err := iam.Open(store.DataDir())
	if err != nil {
		slog.Error("failed to open the user directory", "dataDir", store.DataDir(), "err", err)
		os.Exit(1)
	}
	authSvc, err := auth.New(store, users)
	if err != nil {
		slog.Error("failed to set up authentication", "err", err)
		os.Exit(1)
	}
	slog.Info("configuration loaded", "version", version.Version, "configPath", *cfgPath, "dataDir", store.DataDir())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var srv *api.Server
	var once sync.Once
	// shutdown releases the listener; shared by exit, restart and self-update.
	shutdown := func() {
		once.Do(func() {
			cancel()
			if srv != nil {
				srv.Close()
			}
			slog.Info("shutdown complete")
		})
	}
	beforeExec := func() error { shutdown(); return nil }

	upd := updater.New(func() updater.Config {
		u := store.Get().Update
		return updater.Config{Enabled: u.Enabled, Channel: u.Channel, CheckInterval: u.CheckInterval,
			Source: u.Source, ProxyBaseURL: u.ProxyBaseURL, Repo: u.Repo}
	}, store.DataDir, slog.Default(), updater.RestartHooks{
		BeforeExec: func(string) error { return beforeExec() },
		// Resources are already released; let the supervisor restart us.
		OnExecFailure: func(err error) { slog.Error("restart after update failed", "err", err); os.Exit(1) },
	})
	upd.StartBackground(ctx)

	srv, err = api.Start(api.Deps{
		Store: store, PKI: pkiStore, Users: users, Auth: authSvc, Updater: upd, Started: start, Web: web.FS(),
		SetLogLevel: setLogLevel,
		Restart: func() error {
			err := updater.Restart(beforeExec)
			// Only reached if exec failed after resources were released.
			slog.Error("restart failed", "err", err)
			os.Exit(1)
			return err
		},
	})
	if err != nil {
		slog.Error("failed to start the web UI / API server", "err", err)
		os.Exit(1)
	}
	if tok := authSvc.SetupToken(); tok != "" {
		url := "http://" + net.JoinHostPort(cfg.Server.Host, strconv.Itoa(cfg.Server.Port))
		if cfg.Auth.Recovery {
			slog.Warn("account recovery enabled: open the web UI and enter this setup token to create or reset a system administrator", "url", url, "setupToken", tok)
		} else {
			slog.Warn("admin account not set up yet: open the web UI and enter this setup token", "url", url, "setupToken", tok)
		}
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	s := <-sig
	slog.Info("shutting down", "signal", s.String())
	shutdown()
}
