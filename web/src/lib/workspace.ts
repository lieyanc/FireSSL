import { useSyncExternalStore } from "react"

import { setApiTenant } from "@/lib/api"
import { qk, queryClient, useAuthState } from "@/lib/queries"
import type { CertRecord, Membership, Role } from "@/lib/types"

/**
 * The workspace is the tenant the UI works in, sent with every API call.
 * System administrators may also work on the whole platform ("").
 */

const STORAGE_KEY = "firessl-tenant"

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

let selected = readStored()
setApiTenant(selected)
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Switches the workspace and drops everything cached for the old one. */
export function selectTenant(id: string) {
  if (id === selected) return
  selected = id
  setApiTenant(id)
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Ignore: the choice still applies for this session.
  }
  listeners.forEach((l) => l())
  void queryClient.resetQueries({
    predicate: (query) =>
      query.queryKey[0] !== qk.authState[0] &&
      query.queryKey[0] !== qk.version[0],
  })
}

export function useSelectedTenant() {
  return useSyncExternalStore(subscribe, () => selected)
}

export type Perm = "view" | "issue" | "manageCa" | "members"

export const ROLES: Role[] = ["owner", "operator", "viewer"]

const ROLE_PERMS: Record<Role, Perm[]> = {
  owner: ["view", "issue", "manageCa", "members"],
  operator: ["view", "issue"],
  viewer: ["view"],
}

export function roleCan(role: Role, perm: Perm) {
  return ROLE_PERMS[role].includes(perm)
}

export type Workspace = {
  admin: boolean
  tenants: Membership[]
  /** The current tenant; undefined on the platform workspace. */
  tenant?: Membership
  platform: boolean
  can: (perm: Perm) => boolean
  /** Whether the caller may change a record (not just read it). */
  canManage: (record: CertRecord) => boolean
  tenantName: (id?: string) => string | undefined
}

/**
 * Resolves the stored choice against the caller's memberships: an unknown
 * tenant falls back to the platform (administrators) or the first tenant.
 */
export function useWorkspace(): Workspace {
  const auth = useAuthState().data
  const stored = useSelectedTenant()
  const admin = !!auth?.user?.admin
  const tenants = auth?.tenants ?? []
  const tenant =
    tenants.find((t) => t.id === stored) ?? (admin ? undefined : tenants[0])
  const can = (perm: Perm) =>
    tenant ? roleCan(tenant.role, perm) : admin
  return {
    admin,
    tenants,
    tenant,
    platform: !tenant && admin,
    can,
    canManage: (r) =>
      !r.readOnly && can(r.kind === "ca" ? "manageCa" : "issue"),
    tenantName: (id) => tenants.find((t) => t.id === id)?.name,
  }
}
