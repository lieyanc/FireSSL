import { Suspense } from "react"
import { Outlet } from "react-router"

import { PageSkeleton } from "@/components/common/query-state"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { SiteHeader } from "@/components/layout/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

function readSidebarCookie() {
  const match = document.cookie.match(/(?:^|; )sidebar_state=(true|false)/)
  return match ? match[1] === "true" : true
}

/** Authenticated app chrome: sidebar and header. */
export function AppLayout() {
  return (
    <SidebarProvider defaultOpen={readSidebarCookie()}>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </SidebarInset>
    </SidebarProvider>
  )
}
