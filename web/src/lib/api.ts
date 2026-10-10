import type {
  Account,
  ApiErrorBody,
  AuthState,
  CARequest,
  CertRecord,
  CertRequest,
  CSRRequest,
  ExportFormat,
  ImportRequest,
  Inspected,
  Overview,
  PkiDefaults,
  RecordKind,
  RenewRequest,
  RevocationReason,
  Role,
  Settings,
  SettingsInput,
  Tenant,
  UpdateCheckResult,
  UpdateStatus,
  User,
  UserChange,
  VersionInfo,
} from "@/lib/types"

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field?: string
  /** Seconds, from the Retry-After header on 429 responses. */
  readonly retryAfter?: number

  constructor(
    status: number,
    code: string,
    message: string,
    field?: string,
    retryAfter?: number
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.field = field
    this.retryAfter = retryAfter
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

type UnauthorizedListener = (path: string) => void
let unauthorizedListener: UnauthorizedListener | null = null

/** Registers the handler called whenever any request comes back 401. */
export function setUnauthorizedListener(listener: UnauthorizedListener | null) {
  unauthorizedListener = listener
}

let tenantId = ""

/** Sets the tenant every request works in; "" is the whole platform. */
export function setApiTenant(id: string) {
  tenantId = id
}

type Query = Record<string, string | number | undefined | null>

function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value))
    }
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {}
  try {
    body = (await res.json()) as Partial<ApiErrorBody>
  } catch {
    // Non-JSON error (e.g. a proxy page); fall back to the status text.
  }
  const retryHeader = res.headers.get("Retry-After")
  const retryAfter = retryHeader ? Number(retryHeader) : undefined
  return new ApiError(
    res.status,
    body.error ?? (res.status === 401 ? "unauthorized" : "internal"),
    body.message || res.statusText || `HTTP ${res.status}`,
    body.field,
    Number.isFinite(retryAfter) ? retryAfter : undefined
  )
}

async function send(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query; signal?: AbortSignal } = {}
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (tenantId) headers["X-FireSSL-Tenant"] = tenantId
  const init: RequestInit = {
    method,
    headers,
    credentials: "same-origin",
    signal: options.signal,
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }

  let res: Response
  try {
    res = await fetch(withQuery(path, options.query), init)
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError(0, "network", "Network error")
  }
  if (!res.ok) {
    const error = await toApiError(res)
    if (res.status === 401) unauthorizedListener?.(path)
    throw error
  }
  return res
}

export async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query; signal?: AbortSignal } = {}
): Promise<T> {
  const res = await send(method, path, options)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const get = <T>(path: string, query?: Query) =>
  request<T>("GET", path, { query })
const post = <T>(path: string, body?: unknown) =>
  request<T>("POST", path, { body: body ?? {} })

/** Saves a response body as a file, named by Content-Disposition. */
async function download(res: Response, fallback: string) {
  const blob = await res.blob()
  const disposition = res.headers.get("Content-Disposition") ?? ""
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  const name = match ? decodeURIComponent(match[1]) : fallback
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}

function records(kind: RecordKind) {
  const base = kind === "ca" ? "/api/authorities" : "/api/certificates"
  return {
    list: (issuerId?: string) =>
      get<{ items: CertRecord[] }>(base, { issuerId }).then((r) => r.items),
    get: (id: string) => get<CertRecord>(`${base}/${encodeURIComponent(id)}`),
    rename: (id: string, name: string) =>
      request<CertRecord>("PATCH", `${base}/${encodeURIComponent(id)}`, {
        body: { name },
      }),
    remove: (id: string) =>
      request<void>("DELETE", `${base}/${encodeURIComponent(id)}`),
    revoke: (id: string, reason: RevocationReason) =>
      post<CertRecord>(`${base}/${encodeURIComponent(id)}/revoke`, { reason }),
    export: async (id: string, format: ExportFormat) =>
      download(
        await send("GET", `${base}/${encodeURIComponent(id)}/export`, {
          query: { format },
        }),
        `${id}.${format}`
      ),
    pkcs12: async (id: string, password: string, legacy: boolean) =>
      download(
        await send("POST", `${base}/${encodeURIComponent(id)}/pkcs12`, {
          body: { password, legacy },
        }),
        `${id}.p12`
      ),
  }
}

export type RecordsApi = ReturnType<typeof records>

export const api = {
  version: () => get<VersionInfo>("/api/version"),
  auth: {
    state: () => get<AuthState>("/api/auth/state"),
    login: (body: { username: string; password: string }) =>
      post<Account>("/api/auth/login", body),
    setup: (body: { setupToken: string; username: string; password: string }) =>
      post<Account>("/api/auth/setup", body),
    logout: () => post<void>("/api/auth/logout"),
    changePassword: (body: {
      currentPassword: string
      newPassword: string
      username?: string
    }) => post<Account>("/api/auth/password", body),
  },
  overview: () => get<Overview>("/api/overview"),
  pkiDefaults: () => get<PkiDefaults>("/api/pki/defaults"),
  authorities: {
    ...records("ca"),
    create: (body: CARequest) => post<CertRecord>("/api/authorities", body),
    import: (body: ImportRequest) =>
      post<CertRecord>("/api/authorities/import", body),
    assignTenant: (id: string, tenantId: string) =>
      post<CertRecord>(`/api/authorities/${encodeURIComponent(id)}/tenant`, {
        tenantId,
      }),
  },
  certificates: {
    ...records("leaf"),
    issue: (body: CertRequest) => post<CertRecord>("/api/certificates", body),
    signCsr: (body: CSRRequest) =>
      post<CertRecord>("/api/certificates/csr", body),
    renew: (id: string, body: RenewRequest) =>
      post<CertRecord>(
        `/api/certificates/${encodeURIComponent(id)}/renew`,
        body
      ),
  },
  inspect: (pem: string) =>
    post<{ items: Inspected[] }>("/api/inspect", { pem }).then((r) => r.items),
  tenants: {
    list: () =>
      get<{ items: Tenant[] }>("/api/tenants").then((r) => r.items),
    get: (id: string) => get<Tenant>(`/api/tenants/${encodeURIComponent(id)}`),
    create: (body: { name: string; description?: string }) =>
      post<Tenant>("/api/tenants", body),
    update: (id: string, body: { name: string; description?: string }) =>
      request<Tenant>("PATCH", `/api/tenants/${encodeURIComponent(id)}`, {
        body,
      }),
    remove: (id: string) =>
      request<void>("DELETE", `/api/tenants/${encodeURIComponent(id)}`),
    setMember: (id: string, username: string, role: Role) =>
      request<Tenant>("PUT", `/api/tenants/${encodeURIComponent(id)}/members`, {
        body: { username, role },
      }),
    removeMember: (id: string, userId: string) =>
      request<Tenant>(
        "DELETE",
        `/api/tenants/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`
      ),
  },
  users: {
    list: () => get<{ items: User[] }>("/api/users").then((r) => r.items),
    create: (body: { username: string; password: string; admin: boolean }) =>
      post<User>("/api/users", body),
    update: (id: string, body: UserChange) =>
      request<User>("PATCH", `/api/users/${encodeURIComponent(id)}`, { body }),
    remove: (id: string) =>
      request<void>("DELETE", `/api/users/${encodeURIComponent(id)}`),
  },
  settings: {
    get: () => get<Settings>("/api/settings"),
    update: (body: SettingsInput) =>
      request<Settings>("PUT", "/api/settings", { body }),
    restart: () => post<void>("/api/system/restart"),
  },
  update: {
    status: () => get<UpdateStatus>("/api/update/status"),
    check: () => post<UpdateCheckResult>("/api/update/check"),
    apply: (force = false) => post<void>("/api/update/apply", { force }),
    dismiss: () => post<void>("/api/update/dismiss"),
  },
}

export function recordsApi(kind: RecordKind): RecordsApi {
  return kind === "ca" ? api.authorities : api.certificates
}
