import {
  BuildingIcon,
  FileBadgeIcon,
  LayoutDashboardIcon,
  ScanSearchIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import type { MessageKey } from "@/i18n"

export type NavItem = {
  to: string
  label: MessageKey
  icon: LucideIcon
}

export const NAV_MAIN: NavItem[] = [
  { to: "/", label: "shell.nav.dashboard", icon: LayoutDashboardIcon },
  { to: "/authorities", label: "shell.nav.authorities", icon: ShieldIcon },
  { to: "/certificates", label: "shell.nav.certificates", icon: FileBadgeIcon },
]

export const NAV_TOOLS: NavItem[] = [
  { to: "/inspect", label: "shell.nav.inspect", icon: ScanSearchIcon },
]

/** System administrators only. */
export const NAV_ADMIN: NavItem[] = [
  { to: "/tenants", label: "shell.nav.tenants", icon: BuildingIcon },
  { to: "/users", label: "shell.nav.users", icon: UsersIcon },
]

/** Members of the current tenant, for those who manage them. */
export function membersNav(tenantId: string): NavItem {
  return { to: `/tenants/${tenantId}`, label: "shell.nav.members", icon: UsersIcon }
}

/** Pinned to the bottom of the sidebar, above the account menu. */
export const NAV_SECONDARY: NavItem[] = [
  { to: "/settings", label: "shell.nav.settings", icon: SettingsIcon },
]

export function isNavActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/"
  return pathname === to || pathname.startsWith(to + "/")
}
