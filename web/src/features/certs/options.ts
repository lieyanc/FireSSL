import type {
  CertRecord,
  CertStatus,
  KeyAlgorithm,
  LeafProfile,
  RevocationReason,
  SANs,
} from "@/lib/types"

export const KEY_ALGORITHMS: KeyAlgorithm[] = [
  "ecdsa-p256",
  "ecdsa-p384",
  "rsa-2048",
  "rsa-3072",
  "rsa-4096",
  "ed25519",
]

export const LEAF_PROFILES: LeafProfile[] = ["server", "client", "server-client"]

export const REVOCATION_REASONS: RevocationReason[] = [
  "unspecified",
  "keyCompromise",
  "caCompromise",
  "affiliationChanged",
  "superseded",
  "cessationOfOperation",
  "privilegeWithdrawn",
]

export const CERT_STATUSES: CertStatus[] = [
  "valid",
  "expiring",
  "expired",
  "revoked",
  "not-yet-valid",
]

/** Human label for a key algorithm id such as "ecdsa-p256". */
export function keyAlgorithmLabel(alg: string) {
  const [family, size] = alg.split("-")
  switch (family) {
    case "ecdsa":
      return size ? `ECDSA ${size.toUpperCase().replace("P", "P-")}` : "ECDSA"
    case "rsa":
      return `RSA ${size}`
    case "ed25519":
      return "Ed25519"
  }
  return alg
}

export const VALIDITY_PRESETS = [
  { days: 90, label: "90d" },
  { days: 397, label: "397d" },
  { days: 825, label: "825d" },
  { days: 1825, label: "5y" },
  { days: 3650, label: "10y" },
  { days: 7300, label: "20y" },
] as const

/** Apple platforms reject TLS server certificates valid for longer. */
export const APPLE_MAX_TLS_DAYS = 825

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

function isIP(value: string) {
  return IPV4.test(value) || (value.includes(":") && /^[0-9a-f:.]+$/i.test(value))
}

export type SanKind = keyof SANs

/** Classifies one SAN entry the way the server will store it. */
export function sanKind(value: string): SanKind {
  if (value.includes("://")) return "uri"
  if (value.includes("@")) return "email"
  if (isIP(value)) return "ip"
  return "dns"
}

/** Splits free text (one name per line or comma-separated) into SANs. */
export function parseSans(text: string): SANs {
  const out: SANs = { dns: [], ip: [], email: [], uri: [] }
  for (const raw of text.split(/[\n,;\s]+/)) {
    const value = raw.trim()
    if (!value) continue
    const list = out[sanKind(value)]
    if (!list.includes(value)) list.push(value)
  }
  return out
}

export function formatSans(sans: SANs) {
  return [...sans.dns, ...sans.ip, ...sans.email, ...sans.uri].join("\n")
}

export function sanCount(sans: SANs) {
  return sans.dns.length + sans.ip.length + sans.email.length + sans.uri.length
}

/** A CA can sign when it has a key and is neither revoked nor expired. */
export function canIssue(ca: CertRecord) {
  return ca.hasKey && ca.status !== "revoked" && ca.status !== "expired"
}

/** Fraction of the validity period already elapsed, clamped to 0..1. */
export function lifetimeElapsed(notBefore: string, notAfter: string, now = Date.now()) {
  const start = new Date(notBefore).getTime()
  const end = new Date(notAfter).getTime()
  if (!(end > start)) return 1
  return Math.min(1, Math.max(0, (now - start) / (end - start)))
}
