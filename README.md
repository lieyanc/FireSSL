# FireSSL

A self-hosted private certificate authority with a built-in web UI. One static Go binary: create root and intermediate CAs, issue TLS server and client certificates, sign CSRs, revoke and publish CRLs, and export in every common format.

## Features

- **CA hierarchies**: self-signed root CAs and any depth of intermediate CAs, with path-length constraints. Sub-CA and certificate validity is capped at the issuer's expiry.
- **Issuance**: TLS server, client or combined certificates with DNS, IP, email and URI SANs (wildcards included). The common name is added to the SANs automatically, since that is what TLS clients check.
- **Keys**: ECDSA P-256 / P-384, RSA 2048 / 3072 / 4096 and Ed25519. Any key type can be issued from any CA type.
- **CSR signing**: sign requests generated elsewhere so private keys never leave their owner. Subject and SANs can be overridden before signing.
- **Import**: bring an existing CA, with its key to keep issuing, or without it as a trust anchor. Sub-CAs imported before their parent are linked once the parent arrives.
- **Lifecycle**: renew with a fresh or the same key (optionally revoking the old certificate), revoke with RFC 5280 reasons, expiry warnings on the dashboard.
- **Revocation lists**: each CA signs its CRL on demand. With a public URL configured, new certificates carry CRL distribution point and CA issuer URLs, served without authentication at `/crl/<id>.crl` and `/ca/<id>.crt`.
- **Exports**: PEM certificate, full chain, CA chain, DER, PKCS#8 key, password-protected PKCS#12 (modern AES or legacy 3DES) and a ZIP bundle with everything.
- **Multi-tenancy**: users, tenants and per-tenant roles. Root CAs stay with the platform; the administrator gives each tenant a sub-CA, and the tenant issues its own certificates with it, isolated from other tenants.
- **Inspector**: decode pasted certificates, CSRs, keys and CRLs, and check that a key matches a certificate.
- **Web UI** (React + shadcn/ui, embedded in the binary): English and Chinese; light/dark theme; per-OS instructions to trust a root CA.
- **Security**: private keys are encrypted at rest with AES-256-GCM under a separate master key; bcrypt passwords, signed HttpOnly session cookies, login throttling and CSRF checks.
- **Self-update** from GitHub Releases (opt-in), verified against `SHA256SUMS`.

## Quick start

Download a binary from [Releases](https://github.com/lieyanc/FireSSL/releases), or build from source (Go 1.26+, Node 24+):

```bash
make build                 # builds web/ then bin/firessl
./bin/firessl              # uses ./config.json, creating/completing it from the built-in template
./bin/firessl -c /etc/firessl/config.json
```

Open `http://127.0.0.1:8090`. On first start no admin account exists; the log prints a one-time **setup token**:

```
level=WARN msg="admin account not set up yet: open the web UI and enter this setup token" url=http://127.0.0.1:8090 setupToken=Xy12...
```

Enter it in the UI with a username and password. Then create a root CA, install it as trusted on your devices (the CA's *Trust & distribution* tab has the commands), and issue certificates.

Locked out? Stop the service, run `firessl -c <config> -reset-auth`, start it again and enter the newly logged setup token with a username and password. That account (new or existing) becomes an enabled system administrator with the new password. CAs, certificates and other users are kept.

The UI listens on `127.0.0.1` by default. To reach it remotely, put it behind a TLS reverse proxy (recommended) or set `server.host` to `0.0.0.0`.

Flags: `-c <path>` config file, `-v` print version, `-reset-auth` enable one-time administrator recovery on the next start.

## Tenants and roles

The first account is a **system administrator**. Administrators manage root CAs, imports, tenants, users and system settings, and act as owner in every tenant. More accounts are created under *Users*.

A **tenant** groups people and the CAs they work with. Every CA and certificate belongs either to the platform or to one tenant:

- Root CAs always belong to the platform.
- An administrator creates a sub-CA under a root and assigns it to a tenant (or reassigns an existing sub-CA). Everything that sub-CA issues belongs to the same tenant.
- A tenant sees its own records and, read-only, the platform CAs above them, so it can download chains and CRLs but never their private keys.

Each member has one role per tenant:

| Role     | Can |
| -------- | --- |
| Viewer   | Browse the tenant's CAs and certificates, download certificates, chains and CRLs |
| Operator | Also issue, sign CSRs, renew, revoke, rename and delete certificates, and export their private keys |
| Owner    | Also create, revoke and delete the tenant's sub-CAs and manage its members |

Users pick the tenant they work in with the workspace switcher at the top of the sidebar. API clients choose it with the `X-FireSSL-Tenant: <tenant id>` header; administrators who leave it out work across the whole platform.

Upgrading from a single-administrator release moves the existing account into the user directory (`data/iam.json`) as a system administrator. Existing CAs and certificates stay with the platform until you assign them to tenants.

### systemd

```ini
[Unit]
Description=FireSSL
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/opt/firessl/firessl -c /opt/firessl/config.json
WorkingDirectory=/opt/firessl
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Self-update and the UI's restart button replace the process in place (same PID), so systemd does not see a restart.

## Configuration

Settings are saved atomically to `config.json` (mode `0600`) and are editable in the UI. The full default is compiled into the binary ([`internal/config/template.json`](internal/config/template.json)); a missing file is created from it and missing fields are filled in on start.

| Key | Default | Meaning |
|---|---|---|
| `server.host`, `server.port` | `127.0.0.1`, `8090` | Listen address (applied after a restart) |
| `pki.publicUrl` | empty | External base URL embedded in new certificates for CRL and CA issuer lookups |
| `pki.defaultKeyAlgorithm` | `ecdsa-p256` | Preselected key type for new certificates |
| `pki.defaultValidityDays` | `397` | Preselected certificate lifetime |
| `pki.expiryWarningDays` | `30` | When a certificate counts as expiring soon |
| `logging.level` | `info` | `debug`, `info`, `warn` or `error` |
| `update.*` | disabled | Self-update channel, interval and download source |
| `dataDir` | `./data` | Database and master key, relative to the config file |

### Data and backups

`dataDir` holds two files:

- `pki.json` — every CA and certificate, with private keys sealed by the master key.
- `master.key` — the AES-256 key that seals them.

Back up both. Neither is useful alone: without `master.key` no private key can be recovered, and FireSSL refuses to start rather than create a new key next to sealed records.

## API

The UI is a client of the JSON API under `/api` (session cookie authentication). Main endpoints:

| Method | Path | |
|---|---|---|
| `GET` | `/api/overview` | Counts and certificates needing attention |
| `GET`/`POST` | `/api/authorities` | List / create CAs |
| `POST` | `/api/authorities/import` | Import a CA certificate (and key) |
| `GET`/`POST` | `/api/certificates` | List / issue certificates |
| `POST` | `/api/certificates/csr` | Sign a CSR |
| `POST` | `/api/certificates/{id}/renew` | Renew |
| `GET`/`PATCH`/`DELETE` | `/api/{authorities,certificates}/{id}` | Read / rename / delete |
| `POST` | `/api/{authorities,certificates}/{id}/revoke` | Revoke |
| `GET` | `/api/{authorities,certificates}/{id}/export?format=` | `cert`, `der`, `key`, `chain`, `fullchain`, `zip` (and `crl`, `crl-pem` for CAs) |
| `POST` | `/api/{authorities,certificates}/{id}/pkcs12` | PKCS#12 with `{"password", "legacy"}` |
| `POST` | `/api/inspect` | Decode PEM |
| `GET` | `/crl/{caId}.crl`, `/ca/{caId}.crt` | Public, unauthenticated |

## Development

```bash
make dev        # backend on :8090 with the UI currently in web/dist
make dev-web    # Vite dev server with hot reload, proxying /api to :8090
make test       # go vet + go test -race
make lint       # eslint + tsc
```

## License

GPL-3.0. See [LICENSE](LICENSE).
