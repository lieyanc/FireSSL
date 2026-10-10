import { BuildingIcon, CheckIcon, ChevronsUpDownIcon, GlobeIcon } from "lucide-react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

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
import { selectTenant, useWorkspace } from "@/lib/workspace"

/** Picks the tenant (or, for administrators, the platform) to work in. */
export function WorkspaceSwitcher() {
  const { t } = useI18n()
  const { isMobile, setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const ws = useWorkspace()
  const Icon = ws.tenant ? BuildingIcon : GlobeIcon
  const name = ws.tenant?.name ?? t("access.workspace.platform")
  const hint = ws.tenant
    ? t(`access.roles.${ws.tenant.role}`)
    : t("access.workspace.platformHint")
  const switchable = ws.tenants.length + (ws.admin ? 1 : 0) > 1

  const choose = (id: string, label: string) => {
    if (id === (ws.tenant?.id ?? "")) return
    selectTenant(id)
    // Detail pages of the old workspace are usually not visible in the new one.
    navigate("/")
    if (isMobile) setOpenMobile(false)
    toast.success(t("access.workspace.switched", { name: label }))
  }

  const button = (
    <SidebarMenuButton
      size="lg"
      aria-label={t("access.workspace.switch")}
      className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
    >
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg border bg-background">
        <Icon className="size-4" />
      </div>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      </div>
      {switchable && <ChevronsUpDownIcon className="ml-auto" />}
    </SidebarMenuButton>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {!switchable ? (
          button
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
              side={isMobile ? "bottom" : "right"}
              align="start"
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t("access.workspace.label")}
              </DropdownMenuLabel>
              {ws.admin && (
                <>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onSelect={() =>
                        choose("", t("access.workspace.platform"))
                      }
                    >
                      <GlobeIcon />
                      {t("access.workspace.platform")}
                      {ws.platform && <CheckIcon className="ml-auto" />}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  {ws.tenants.length > 0 && <DropdownMenuSeparator />}
                </>
              )}
              <DropdownMenuGroup>
                {ws.tenants.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={() => choose(m.id, m.name)}
                  >
                    <BuildingIcon />
                    <span className="truncate">{m.name}</span>
                    {ws.tenant?.id === m.id ? (
                      <CheckIcon className="ml-auto" />
                    ) : (
                      !ws.admin && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t(`access.roles.${m.role}`)}
                        </span>
                      )
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
