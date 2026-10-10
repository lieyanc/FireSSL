import { Suspense, useEffect, type CSSProperties } from "react"
import { Outlet, useLocation } from "react-router"
import { BuildingIcon } from "lucide-react"

import { FullPageSpinner, PageSkeleton } from "@/components/common/query-state"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { SiteHeader } from "@/components/layout/site-header"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useI18n } from "@/i18n"
import { selectTenant, useSelectedTenant, useWorkspace } from "@/lib/workspace"

function readSidebarCookie() {
  const match = document.cookie.match(/(?:^|; )sidebar_state=(true|false)/)
  return match ? match[1] === "true" : true
}

/**
 * Settles the workspace before anything loads: a stored tenant the user no
 * longer belongs to is replaced by the fallback useWorkspace resolved.
 */
function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const ws = useWorkspace()
  const stored = useSelectedTenant()
  const want = ws.tenant?.id ?? ""
  useEffect(() => {
    if (want !== stored) selectTenant(want)
  }, [want, stored])
  if (want !== stored) return <FullPageSpinner />
  return children
}

/** Authenticated app chrome: sidebar and header. */
export function AppLayout() {
  return (
    <WorkspaceGate>
      <Chrome />
    </WorkspaceGate>
  )
}

/** Shown to users outside every tenant; only their account stays usable. */
function NoTenant() {
  const { t } = useI18n()
  return (
    <Empty className="min-h-[60svh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingIcon />
        </EmptyMedia>
        <EmptyTitle>{t("access.workspace.noneTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("access.workspace.noneDescription")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function Chrome() {
  const ws = useWorkspace()
  const { pathname } = useLocation()
  const blocked =
    !ws.admin && !ws.tenant && !pathname.startsWith("/settings")
  return (
    <SidebarProvider
      defaultOpen={readSidebarCookie()}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <Suspense fallback={<PageSkeleton />}>
          {blocked ? <NoTenant /> : <Outlet />}
        </Suspense>
      </SidebarInset>
    </SidebarProvider>
  )
}
