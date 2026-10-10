export type ApiErrorBody = {
  error: string
  message: string
  field?: string
}

export type AuthState = {
  initialized: boolean
  setupAvailable?: boolean
  authenticated: boolean
  username?: string
}

export type Account = { username: string }

export type VersionInfo = {
  version: string
  commit: string
  buildTime: string
}

export type KeyAlgorithm =
  "ecdsa-p256" | "ecdsa-p384" | "rsa-2048" | "rsa-3072" | "rsa-4096" | "ed25519"

export type LeafProfile = "server" | "client" | "server-client"
export type CAProfile = "root" | "intermediate"
export type RecordKind = "ca" | "leaf"
export type RecordSource = "generated" | "csr" | "imported"

export type CertStatus =
  "valid" | "expiring" | "expired" | "revoked" | "not-yet-valid"

export type RevocationReason =
  | "unspecified"
  | "keyCompromise"
  | "caCompromise"
  | "affiliationChanged"
  | "superseded"
  | "cessationOfOperation"
  | "privilegeWithdrawn"

export type Subject = {
  commonName: string
  organization?: string
  organizationalUnit?: string
  country?: string
  province?: string
  locality?: string
}

export type SANs = {
  dns: string[]
  ip: string[]
  email: string[]
  uri: string[]
}

export type Details = {
  subject: Subject
  subjectDn: string
  issuerDn: string
  serialNumber: string
  notBefore: string
  notAfter: string
  sans: SANs
  isCa: boolean
  pathLen?: number
  keyUsage: string[]
  extKeyUsage: string[]
  keyAlgorithm: string
  signatureAlgorithm: string
  fingerprintSha1: string
  fingerprintSha256: string
  subjectKeyId?: string
  authorityKeyId?: string
  crlDistributionPoints: string[]
  issuingCertificateUrl: string[]
  selfSigned: boolean
}

/** A stored CA or certificate. */
export type CertRecord = {
  id: string
  kind: RecordKind
  name: string
  issuerId?: string
  issuerName?: string
  profile: LeafProfile | CAProfile
  source: RecordSource
  status: CertStatus
  hasKey: boolean
  revokedAt?: string
  revocationReason?: RevocationReason
  renewedFrom?: string
  renewedBy?: string
  createdAt: string
  details: Details
  depth: number
  issuedCount: number
  childCount: number
  /** Detail responses only. */
  certPem?: string
  chain?: string[]
}

export type Overview = {
  authorities: number
  certificates: number
  valid: number
  expiring: number
  expired: number
  revoked: number
  attention: CertRecord[]
  recent: CertRecord[]
  warningDays: number
}

export type CARequest = {
  name?: string
  issuerId?: string
  subject: Subject
  keyAlgorithm: KeyAlgorithm
  validityDays: number
  pathLen?: number | null
}

export type CertRequest = {
  name?: string
  issuerId: string
  profile: LeafProfile
  subject: Subject
  sans: SANs
  keyAlgorithm: KeyAlgorithm
  validityDays: number
}

export type CSRRequest = {
  name?: string
  issuerId: string
  profile: LeafProfile
  csr: string
  subject?: Subject
  sans?: SANs
  validityDays: number
}

export type ImportRequest = {
  name?: string
  certificate: string
  privateKey?: string
}

export type RenewRequest = {
  validityDays?: number
  reuseKey: boolean
  revokeOld: boolean
}

export type ExportFormat =
  "cert" | "der" | "key" | "chain" | "fullchain" | "zip" | "crl" | "crl-pem"

export type CSRDetails = {
  subject: Subject
  subjectDn: string
  sans: SANs
  keyAlgorithm: string
  signatureAlgorithm: string
  signatureValid: boolean
}

export type Inspected = {
  type: "certificate" | "csr" | "privateKey" | "crl" | "unknown"
  pemType: string
  certificate?: Details
  csr?: CSRDetails
  key?: { keyAlgorithm: string; matchesCertificate: number }
  crl?: {
    issuerDn: string
    number: string
    thisUpdate: string
    nextUpdate?: string
    revokedCount: number
    revoked: string[]
  }
  knownId?: string
  knownKind?: RecordKind
  error?: string
}

export type Settings = {
  server: { host: string; port: number }
  pki: {
    publicUrl: string
    defaultKeyAlgorithm: KeyAlgorithm
    defaultValidityDays: number
    expiryWarningDays: number
  }
  logging: { level: "debug" | "info" | "warn" | "error" }
  update: {
    enabled: boolean
    channel: "stable" | "dev"
    checkInterval: number
    source: "github" | "proxy"
    proxyBaseUrl: string
    repo: string
  }
  dataDir: string
  configPath: string
  restartRequired: boolean
  canRestart: boolean
}

export type SettingsInput = Partial<
  Pick<Settings, "server" | "pki" | "logging" | "update">
>

export type UpdateState =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "waiting"
  | "applying"
  | "failed"

export type UpdateStatus = {
  state: UpdateState
  currentVersion: string
  latestVersion?: string
  isPrerelease: boolean
  progress?: number
  downloadProgress?: number
  error?: string
  lastCheck?: string
  releaseNotes?: string
}

export type UpdateCheckResult = {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  isPrerelease: boolean
  releaseNotes?: string
  channel: string
}
