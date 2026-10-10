import { Link } from "react-router"
import {
  ArrowRightIcon,
  BanIcon,
  BuildingIcon,
  LockIcon,
  ChevronRightIcon,
  ClockAlertIcon,
  FileSearchIcon,
  HistoryIcon,
  KeyRoundIcon,
} from "lucide-react"

import { QueryError } from "@/components/common/query-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { StatusBadge } from "@/features/certs/status-badge"
import { useI18n } from "@/i18n"
import { isApiError } from "@/lib/api"
import { daysUntil } from "@/lib/format"
import { useAuthorities } from "@/lib/queries"
import type { CertRecord } from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"

/**
 * Who a record belongs to: on the platform workspace the owning tenant, in a
 * tenant the platform CAs it can only read.
 */
export function OwnerBadge({ record }: { record: CertRecord }) {
  const { t } = useI18n()
  const ws = useWorkspace()
  if (record.readOnly) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className="gap-1">
            <LockIcon />
            {t("access.platformManaged")}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {t("access.platformManagedHint")}
        </TooltipContent>
      </Tooltip>
    )
  }
  if (ws.platform && record.tenantId) {
    return (
      <Badge variant="secondary" className="gap-1">
        <BuildingIcon />
        {ws.tenantName(record.tenantId) ?? record.tenantId}
      </Badge>
    )
  }
  return null
}

/** Root → … → this record, linking each known CA. */
export function ChainPath({ record }: { record: CertRecord }) {
  const authorities = useAuthorities()
  const names = new Map((authorities.data ?? []).map((ca) => [ca.id, ca.name]))
  const chain = [...(record.chain ?? [])].reverse()
  return (
    <nav
      className="flex flex-wrap items-center gap-1 text-sm"
      aria-label="chain"
    >
      {chain.map((id) => (
        <span key={id} className="flex items-center gap-1">
          <Link
            to={`/authorities/${id}`}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {names.get(id) ?? id}
          </Link>
          <ChevronRightIcon className="size-3.5 text-muted-foreground" />
        </span>
      ))}
      <span className="font-medium">{record.name}</span>
    </nav>
  )
}

export function RecordTitle({ record }: { record: CertRecord }) {
  const { t } = useI18n()
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="truncate">{record.name}</span>
      <StatusBadge status={record.status} />
      <Badge variant="outline">{t(`common.profile.${record.profile}`)}</Badge>
      {record.source !== "generated" && (
        <Badge variant="secondary">{t(`common.source.${record.source}`)}</Badge>
      )}
      <OwnerBadge record={record} />
    </span>
  )
}

/** Status notices shown above the details. */
export function RecordAlerts({ record }: { record: CertRecord }) {
  const { t, fmt } = useI18n()
  const base = record.kind === "ca" ? "/authorities" : "/certificates"
  const days = daysUntil(record.details.notAfter)
  return (
    <>
      {record.status === "revoked" && (
        <Alert variant="destructive">
          <BanIcon />
          <AlertTitle>
            {t("certs.alerts.revoked", {
              when: fmt.dateTime(record.revokedAt),
            })}
          </AlertTitle>
          <AlertDescription>
            {t("certs.alerts.revokedReason", {
              reason: t(
                `common.reasons.${record.revocationReason ?? "unspecified"}`
              ),
            })}
          </AlertDescription>
        </Alert>
      )}
      {record.status === "expired" && (
        <Alert variant="destructive">
          <ClockAlertIcon />
          <AlertTitle>{t("certs.alerts.expired", { days: -days })}</AlertTitle>
        </Alert>
      )}
      {record.status === "expiring" && !record.renewedBy && (
        <Alert>
          <ClockAlertIcon />
          <AlertTitle>{t("certs.alerts.expiring", { days })}</AlertTitle>
          {record.kind === "leaf" && (
            <AlertDescription>
              {t("certs.alerts.expiringHint")}
            </AlertDescription>
          )}
        </Alert>
      )}
      {!record.hasKey && (
        <Alert>
          <KeyRoundIcon />
          <AlertTitle>
            {record.kind === "ca"
              ? t("certs.alerts.anchorOnly")
              : t("certs.noKey")}
          </AlertTitle>
          <AlertDescription>
            {record.kind === "ca"
              ? t("certs.alerts.anchorOnlyHint")
              : t("certs.noKeyHint")}
          </AlertDescription>
        </Alert>
      )}
      {record.renewedBy && (
        <Alert>
          <HistoryIcon />
          <AlertTitle>{t("certs.alerts.superseded")}</AlertTitle>
          <AlertDescription>
            <Link
              to={`${base}/${record.renewedBy}`}
              className="inline-flex items-center gap-1 underline"
            >
              {t("certs.alerts.viewNewer")}
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-24" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  )
}

export function DetailError({
  error,
  onRetry,
  backTo,
}: {
  error: unknown
  onRetry: () => void
  backTo: string
}) {
  const { t } = useI18n()
  if (isApiError(error) && error.status === 404) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileSearchIcon />
          </EmptyMedia>
          <EmptyTitle>{t("certs.notFound")}</EmptyTitle>
          <EmptyDescription>{t("certs.notFoundHint")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to={backTo}>{t("common.actions.back")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return <QueryError error={error} onRetry={onRetry} />
}
