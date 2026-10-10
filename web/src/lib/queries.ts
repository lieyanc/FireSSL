import { QueryClient, queryOptions, useQuery } from "@tanstack/react-query"

import { api, isApiError } from "@/lib/api"
import type { RecordKind } from "@/lib/types"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (isApiError(error) && error.status > 0 && error.status < 500) {
          return false
        }
        return failureCount < 2
      },
    },
    mutations: { retry: false },
  },
})

export const qk = {
  authState: ["auth", "state"] as const,
  version: ["version"] as const,
  overview: ["overview"] as const,
  records: ["records"] as const,
  list: (kind: RecordKind, issuerId?: string) =>
    ["records", kind, "list", issuerId ?? "all"] as const,
  record: (kind: RecordKind, id: string) =>
    ["records", kind, "detail", id] as const,
  settings: ["settings"] as const,
  updateStatus: ["update", "status"] as const,
}

export const authStateQuery = queryOptions({
  queryKey: qk.authState,
  queryFn: api.auth.state,
  staleTime: 60_000,
  retry: 1,
})

export function useAuthState() {
  return useQuery(authStateQuery)
}

export function useVersion() {
  return useQuery({
    queryKey: qk.version,
    queryFn: api.version,
    staleTime: 5 * 60_000,
  })
}

export function useOverview() {
  return useQuery({ queryKey: qk.overview, queryFn: api.overview })
}

export function useAuthorities() {
  return useQuery({
    queryKey: qk.list("ca"),
    queryFn: () => api.authorities.list(),
  })
}

export function useCertificates(issuerId?: string) {
  return useQuery({
    queryKey: qk.list("leaf", issuerId),
    queryFn: () => api.certificates.list(issuerId),
  })
}

export function useRecord(kind: RecordKind, id: string) {
  return useQuery({
    queryKey: qk.record(kind, id),
    queryFn: () =>
      kind === "ca" ? api.authorities.get(id) : api.certificates.get(id),
    enabled: !!id,
  })
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings.get })
}

/** Refreshes every view of the inventory after a change. */
export function invalidateInventory(client: QueryClient = queryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: qk.records }),
    client.invalidateQueries({ queryKey: qk.overview }),
  ])
}
