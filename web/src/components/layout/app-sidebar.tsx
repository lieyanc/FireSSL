import type { ComponentProps } from "react"
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
import {
  isNavActive,
  membersNav,
  NAV_ADMIN,
  NAV_MAIN,
  NAV_SECONDARY,
  NAV_TOOLS,
  type NavItem,
} from "@/components/layout/nav"
import { NavUser } from "@/components/layout/nav-user"
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher"
import { useI18n } from "@/i18n"
import { useOverview } from "@/lib/queries"
import { useWorkspace } from "@/lib/workspace"

function NavGroup({
  label,
  items,
  className,
}: {
  label?: string
  items: NavItem[]
  className?: string
}) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const ws = useWorkspace()
  const overview = useOverview(ws.admin || !!ws.tenant)
  const attention =
    (overview.data?.expiring ?? 0) + (overview.data?.expired ?? 0)

  return (
    <SidebarGroup className={className}>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                asChild
                isActive={isNavActive(pathname, item.to)}
              >
                <Link
                  to={item.to}
                  onClick={() => isMobile && setOpenMobile(false)}
                >
                  <item.icon />
                  <span>{t(item.label)}</span>
                </Link>
              </SidebarMenuButton>
              {item.to === "/certificates" && attention > 0 && (
                <SidebarMenuBadge className="text-warning">
                  {attention}
                </SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const { t } = useI18n()
  const { isMobile, setOpenMobile } = useSidebar()
  const ws = useWorkspace()
  const tools =
    ws.tenant && ws.can("members")
      ? [...NAV_TOOLS, membersNav(ws.tenant.id)]
      : NAV_TOOLS

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link to="/" onClick={() => isMobile && setOpenMobile(false)}>
                <ShieldCheckIcon className="size-5! text-primary" />
                <span className="text-base font-semibold">
                  {t("common.appName")}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {(ws.admin || ws.tenants.length > 0) && <WorkspaceSwitcher />}
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label={t("shell.nav.pki")} items={NAV_MAIN} />
        <NavGroup label={t("shell.nav.tools")} items={tools} />
        {ws.admin && (
          <NavGroup label={t("shell.nav.admin")} items={NAV_ADMIN} />
        )}
        <NavGroup items={NAV_SECONDARY} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
