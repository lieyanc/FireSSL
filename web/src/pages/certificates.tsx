import * as React from "react"
import { useSearchParams } from "react-router"
import {
  FileBadgeIcon,
  FilePlus2Icon,
  FileSignatureIcon,
  FilterXIcon,
  SearchIcon,
} from "lucide-react"

import { PageContainer, PageHeader } from "@/components/common/page-header"
import { QueryError } from "@/components/common/query-state"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { CsrDialog } from "@/features/certs/csr-dialog"
import { IssueDialog } from "@/features/certs/issue-dialog"
import { CERT_STATUSES } from "@/features/certs/options"
import { CertificatesTable } from "@/features/certs/tables"
import { useI18n } from "@/i18n"
import { useAuthorities, useCertificates } from "@/lib/queries"
import type { CertRecord, CertStatus } from "@/lib/types"

const ALL = "all"

function matches(r: CertRecord, search: string) {
  const q = search.trim().toLowerCase()
  if (!q) return true
  const s = r.details.sans
  return [
    r.name,
    r.details.subject.commonName,
    r.details.serialNumber,
    ...s.dns,
    ...s.ip,
    ...s.email,
    ...s.uri,
  ].some((v) => v?.toLowerCase().includes(q))
}

export default function CertificatesPage() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const certificates = useCertificates()
  const authorities = useAuthorities()
  const [dialog, setDialog] = React.useState<"issue" | "csr" | null>(null)
  const close = (open: boolean) => !open && setDialog(null)

  const search = params.get("q") ?? ""
  const status = (params.get("status") as CertStatus | null) ?? ALL
  const issuer = params.get("issuer") ?? ALL
  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === ALL) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true }
    )

  const items = React.useMemo(
    () => certificates.data ?? [],
    [certificates.data]
  )
  const filtered = React.useMemo(
    () =>
      items.filter(
        (r) =>
          (status === ALL || r.status === status) &&
          (issuer === ALL || r.issuerId === issuer) &&
          matches(r, search)
      ),
    [items, status, issuer, search]
  )
  const filtering = search.trim() !== "" || status !== ALL || issuer !== ALL
  const clearFilters = () => setParams({}, { replace: true })

  return (
    <PageContainer>
      <PageHeader
        title={t("certs.title")}
        description={t("certs.description")}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog("csr")}>
              <FileSignatureIcon data-icon="inline-start" />
              {t("certs.csr.short")}
            </Button>
            <Button onClick={() => setDialog("issue")}>
              <FilePlus2Icon data-icon="inline-start" />
              {t("certs.issue.short")}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(e) => setParam("q", e.target.value)}
            placeholder={t("certs.filters.search")}
            aria-label={t("certs.filters.search")}
          />
        </InputGroup>
        <Select value={issuer} onValueChange={(v) => setParam("issuer", v)}>
          <SelectTrigger
            className="w-[calc(50%-0.25rem)] sm:w-48"
            aria-label={t("certs.filters.issuer")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>
                {t("certs.filters.allIssuers")}
              </SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              {(authorities.data ?? []).map((ca) => (
                <SelectItem key={ca.id} value={ca.id}>
                  {ca.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setParam("status", v)}>
          <SelectTrigger
            className="w-[calc(50%-0.25rem)] sm:w-40"
            aria-label={t("certs.filters.status")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>
                {t("certs.filters.allStatuses")}
              </SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              {CERT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`common.status.${s}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <FilterXIcon data-icon="inline-start" />
            {t("certs.filters.clear")}
          </Button>
        )}
        {certificates.data && (
          <span className="text-sm text-muted-foreground tabular-nums sm:ml-auto">
            {filtering
              ? t("certs.countFiltered", {
                  shown: filtered.length,
                  count: items.length,
                })
              : t("certs.count", { count: items.length })}
          </span>
        )}
      </div>

      {certificates.isError && !certificates.data ? (
        <QueryError
          error={certificates.error}
          onRetry={() => void certificates.refetch()}
        />
      ) : (
        <Card className="gap-0 py-0">
          {certificates.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileBadgeIcon />
                </EmptyMedia>
                <EmptyTitle>{t("certs.empty")}</EmptyTitle>
                <EmptyDescription>{t("certs.emptyHint")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex-row justify-center">
                <Button onClick={() => setDialog("issue")}>
                  <FilePlus2Icon data-icon="inline-start" />
                  {t("certs.issue.short")}
                </Button>
                <Button variant="outline" onClick={() => setDialog("csr")}>
                  <FileSignatureIcon data-icon="inline-start" />
                  {t("certs.csr.short")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : filtered.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>{t("common.states.noResults")}</EmptyTitle>
                <EmptyDescription>
                  {t("common.states.noResultsHint")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={clearFilters}>
                  <FilterXIcon data-icon="inline-start" />
                  {t("certs.filters.clear")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <CertificatesTable items={filtered} />
          )}
        </Card>
      )}
      <IssueDialog open={dialog === "issue"} onOpenChange={close} />
      <CsrDialog open={dialog === "csr"} onOpenChange={close} />
    </PageContainer>
  )
}
