import * as React from "react"
import { Link } from "react-router"
import {
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockAlertIcon,
  FileBadgeIcon,
  FilePlus2Icon,
  ShieldIcon,
  ShieldPlusIcon,
  UploadIcon,
} from "lucide-react"

import { PageContainer, PageHeader } from "@/components/common/page-header"
import { QueryError } from "@/components/common/query-state"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { CAFormDialog } from "@/features/certs/ca-form-dialog"
import { ImportCADialog } from "@/features/certs/import-ca-dialog"
import { IssueDialog } from "@/features/certs/issue-dialog"
import { StatusBadge } from "@/features/certs/status-badge"
import { useI18n } from "@/i18n"
import { daysUntil } from "@/lib/format"
import { useOverview } from "@/lib/queries"
import type { CertRecord, Overview } from "@/lib/types"
import { cn } from "@/lib/utils"

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  to,
}: {
  title: string
  value: number
  hint: string
  icon: React.ComponentType<{ className?: string }>
  tone?: "warning" | "destructive"
  to: string
}) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">
          {value}
        </CardTitle>
        <CardAction>
          <Icon
            className={cn(
              "size-5 text-muted-foreground",
              tone === "warning" && value > 0 && "text-warning",
              tone === "destructive" && value > 0 && "text-destructive"
            )}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Link
          to={to}
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          {hint}
        </Link>
      </CardContent>
    </Card>
  )
}

function RecordItem({
  record,
  showExpiry,
}: {
  record: CertRecord
  showExpiry?: boolean
}) {
  const { t, fmt } = useI18n()
  const days = daysUntil(record.details.notAfter)
  const to =
    record.kind === "ca"
      ? `/authorities/${record.id}`
      : `/certificates/${record.id}`
  return (
    <Item asChild size="sm" className="px-2">
      <Link to={to}>
        <ItemMedia variant="icon">
          {record.kind === "ca" ? <ShieldIcon /> : <FileBadgeIcon />}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="w-full truncate">{record.name}</ItemTitle>
          <ItemDescription className="truncate">
            {showExpiry
              ? days < 0
                ? t("certs.details.expiredAgo", { days: -days })
                : t("certs.details.daysLeft", { days })
              : t("dashboard.issuedBy", {
                  issuer: record.issuerName ?? "–",
                  when: fmt.relative(record.createdAt),
                })}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <StatusBadge status={record.status} />
        </ItemActions>
      </Link>
    </Item>
  )
}

function Onboarding({
  onCreate,
  onImport,
}: {
  onCreate: () => void
  onImport: () => void
}) {
  const { t } = useI18n()
  const steps = [
    t("dashboard.onboarding.step1"),
    t("dashboard.onboarding.step2"),
    t("dashboard.onboarding.step3"),
  ]
  return (
    <Card>
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldPlusIcon />
          </EmptyMedia>
          <EmptyTitle>{t("dashboard.onboarding.title")}</EmptyTitle>
          <EmptyDescription>
            {t("dashboard.onboarding.description")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <ol className="flex flex-col gap-2 text-left text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{s}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onCreate}>
              <ShieldPlusIcon data-icon="inline-start" />
              {t("authorities.newRoot")}
            </Button>
            <Button variant="outline" onClick={onImport}>
              <UploadIcon data-icon="inline-start" />
              {t("authorities.import.short")}
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </Card>
  )
}

function Lists({ data }: { data: Overview }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.attention.title")}</CardTitle>
          <CardDescription>
            {t("dashboard.attention.description", { days: data.warningDays })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.attention.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CircleCheckIcon className="size-4 text-success" />
              {t("dashboard.attention.empty")}
            </div>
          ) : (
            <ItemGroup className="gap-1">
              {data.attention.map((r) => (
                <RecordItem key={r.id} record={r} showExpiry />
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.recent.title")}</CardTitle>
          <CardDescription>{t("dashboard.recent.description")}</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/certificates">
                {t("dashboard.recent.all")}
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {t("dashboard.recent.empty")}
            </p>
          ) : (
            <ItemGroup className="gap-1">
              {data.recent.map((r) => (
                <RecordItem key={r.id} record={r} />
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function DashboardPage() {
  const { t } = useI18n()
  const overview = useOverview()
  const [dialog, setDialog] = React.useState<"ca" | "import" | "issue" | null>(
    null
  )
  const close = (open: boolean) => !open && setDialog(null)
  const data = overview.data
  const empty = data && data.authorities === 0

  return (
    <PageContainer>
      <PageHeader
        title={t("dashboard.title")}
        description={t("dashboard.description")}
        actions={
          !empty && (
            <>
              <Button variant="outline" onClick={() => setDialog("ca")}>
                <ShieldPlusIcon data-icon="inline-start" />
                {t("authorities.newCa")}
              </Button>
              <Button onClick={() => setDialog("issue")} disabled={!data}>
                <FilePlus2Icon data-icon="inline-start" />
                {t("certs.issue.short")}
              </Button>
            </>
          )
        }
      />
      {overview.isError && !data ? (
        <QueryError
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      ) : !data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </>
      ) : empty ? (
        <Onboarding
          onCreate={() => setDialog("ca")}
          onImport={() => setDialog("import")}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title={t("dashboard.stats.authorities")}
              value={data.authorities}
              hint={t("dashboard.stats.authoritiesHint")}
              icon={ShieldIcon}
              to="/authorities"
            />
            <StatCard
              title={t("dashboard.stats.valid")}
              value={data.valid}
              hint={t("dashboard.stats.validHint", {
                total: data.certificates,
              })}
              icon={CircleCheckIcon}
              to="/certificates?status=valid"
            />
            <StatCard
              title={t("dashboard.stats.expiring")}
              value={data.expiring}
              hint={t("dashboard.stats.expiringHint", {
                days: data.warningDays,
              })}
              icon={ClockAlertIcon}
              tone="warning"
              to="/certificates?status=expiring"
            />
            <StatCard
              title={t("dashboard.stats.expired")}
              value={data.expired + data.revoked}
              hint={t("dashboard.stats.expiredHint", {
                expired: data.expired,
                revoked: data.revoked,
              })}
              icon={CircleAlertIcon}
              tone="destructive"
              to="/certificates?status=expired"
            />
          </div>
          <Lists data={data} />
        </>
      )}
      <CAFormDialog open={dialog === "ca"} onOpenChange={close} />
      <ImportCADialog open={dialog === "import"} onOpenChange={close} />
      <IssueDialog open={dialog === "issue"} onOpenChange={close} />
    </PageContainer>
  )
}
