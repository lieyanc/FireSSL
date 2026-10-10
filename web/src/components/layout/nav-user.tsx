import { Link, useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { EllipsisVerticalIcon, KeyRoundIcon, LogOutIcon } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { toastError } from "@/lib/errors"
import { useAuthState, useVersion } from "@/lib/queries"
import { signedOut } from "@/lib/session"
import { useWorkspace } from "@/lib/workspace"

function UserIdentity({ username }: { username: string }) {
  const { t } = useI18n()
  const ws = useWorkspace()
  return (
    <>
      <Avatar className="rounded-lg after:rounded-lg">
        <AvatarFallback className="rounded-lg font-medium uppercase">
          {username.slice(0, 2)}
        </AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{username}</span>
        <span className="truncate text-xs text-muted-foreground">
          {ws.admin
            ? t("access.roles.admin")
            : ws.tenant
              ? t(`access.roles.${ws.tenant.role}`)
              : t("access.workspace.none")}
        </span>
      </div>
    </>
  )
}

/** Account menu in the sidebar footer. */
export function NavUser() {
  const { t } = useI18n()
  const { isMobile, setOpenMobile } = useSidebar()
  const auth = useAuthState()
  const version = useVersion()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const username = auth.data?.username ?? ""

  const logout = async () => {
    try {
      await api.auth.logout()
    } catch (error) {
      toastError(error, t)
      return
    }
    await queryClient.cancelQueries()
    signedOut()
    toast.success(t("shell.user.loggedOut"))
    navigate("/login", { replace: true })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={t("shell.user.menu")}
              className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
            >
              <UserIdentity username={username} />
              <EllipsisVerticalIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1.5 py-1.5 text-left text-sm">
                <UserIdentity username={username} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link
                  to="/settings/account"
                  onClick={() => isMobile && setOpenMobile(false)}
                >
                  <KeyRoundIcon />
                  {t("shell.user.changePassword")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void logout()}
              >
                <LogOutIcon />
                {t("shell.user.logout")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {version.data && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="font-mono text-xs font-normal text-muted-foreground">
                  {t("common.appName")} {version.data.version}
                </DropdownMenuLabel>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
