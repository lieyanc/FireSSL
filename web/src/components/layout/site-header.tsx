import { Link, useMatches, useParams } from "react-router"
import {
  CheckIcon,
  LanguagesIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react"

import { useTheme, type Theme } from "@/components/theme-provider"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LANG_LABELS, LANGS, useI18n, type Lang, type MessageKey } from "@/i18n"
import { useRecord } from "@/lib/queries"
import type { RecordKind } from "@/lib/types"

export type RouteHandle = {
  /** Sidebar section this route belongs to; shown as the first crumb. */
  section?: MessageKey
  sectionPath?: string
  /** Adds the record name as a second crumb (detail pages). */
  recordKind?: RecordKind
}

function RecordCrumb({ kind }: { kind: RecordKind }) {
  const { id = "" } = useParams()
  const record = useRecord(kind, id)
  return (
    <BreadcrumbPage className="truncate">
      {record.data?.name || id}
    </BreadcrumbPage>
  )
}

function PageBreadcrumb() {
  const { t } = useI18n()
  const matches = useMatches()
  const handle = [...matches]
    .reverse()
    .map((m) => m.handle as RouteHandle | undefined)
    .find((h) => h?.section)

  if (!handle?.section) return null
  const title = t(handle.section)

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {handle.recordKind ? (
          <>
            <BreadcrumbItem className="hidden sm:inline-flex">
              <BreadcrumbLink asChild>
                <Link to={handle.sectionPath ?? "/"}>{title}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:block" />
            <BreadcrumbItem className="min-w-0">
              <RecordCrumb kind={handle.recordKind} />
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function LanguageSwitcher() {
  const { t, lang, setLang } = useI18n()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("shell.language")}
            >
              <LanguagesIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("shell.language")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("shell.language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={lang}
          onValueChange={(value) => setLang(value as Lang)}
        >
          {LANGS.map((l) => (
            <DropdownMenuRadioItem key={l} value={l}>
              {LANG_LABELS[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const THEME_ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }

function ThemeToggle() {
  const { t } = useI18n()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const Icon = resolvedTheme === "dark" ? MoonIcon : SunIcon
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("shell.theme.label")}
            >
              <Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("shell.theme.label")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("shell.theme.label")}</DropdownMenuLabel>
        <DropdownMenuGroup>
          {(["light", "dark", "system"] as Theme[]).map((value) => {
            const ItemIcon = THEME_ICONS[value]
            return (
              <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
                <ItemIcon />
                {t(`shell.theme.${value}`)}
                {theme === value && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SiteHeader() {
  const { t } = useI18n()
  return (
    <header className="sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:rounded-t-xl lg:px-6">
      <SidebarTrigger className="-ml-1" aria-label={t("shell.toggleSidebar")} />
      <Separator
        orientation="vertical"
        className="mx-1 data-vertical:h-4 data-vertical:self-center"
      />
      <PageBreadcrumb />
      <div className="ml-auto flex items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>
  )
}
