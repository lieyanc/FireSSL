import { Link, useLocation } from "react-router"
import { ShieldCheckIcon } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { isNavActive, NAV_MAIN, NAV_TOOLS } from "@/components/layout/nav"
import { useI18n } from "@/i18n"
import { useOverview, useVersion } from "@/lib/queries"

function NavGroup({ label, items }: { label: string; items: typeof NAV_MAIN }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const overview = useOverview()
  const attention =
    (overview.data?.expiring ?? 0) + (overview.data?.expired ?? 0)

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const text = t(item.label)
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  asChild
                  isActive={isNavActive(pathname, item.to)}
                  tooltip={text}
                >
                  <Link
                    to={item.to}
                    onClick={() => isMobile && setOpenMobile(false)}
                  >
                    <item.icon />
                    <span>{text}</span>
                  </Link>
                </SidebarMenuButton>
                {item.to === "/certificates" && attention > 0 && (
                  <SidebarMenuBadge className="text-warning">
                    {attention}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar() {
  const { t } = useI18n()
  const { isMobile, setOpenMobile } = useSidebar()
  const version = useVersion()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" onClick={() => isMobile && setOpenMobile(false)}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <ShieldCheckIcon />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">
                    {t("common.appName")}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("common.tagline")}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label={t("shell.nav.pki")} items={NAV_MAIN} />
        <NavGroup label={t("shell.nav.tools")} items={NAV_TOOLS} />
      </SidebarContent>
      <SidebarFooter>
        {version.data && (
          <p className="truncate px-2 font-mono text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {version.data.version}
          </p>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
