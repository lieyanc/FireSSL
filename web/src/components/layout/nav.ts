import {
  FileBadgeIcon,
  LayoutDashboardIcon,
  ScanSearchIcon,
  SettingsIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react"

import type { MessageKey } from "@/i18n"

type NavItem = {
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
  { to: "/settings", label: "shell.nav.settings", icon: SettingsIcon },
]

export function isNavActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/"
  return pathname === to || pathname.startsWith(to + "/")
}
