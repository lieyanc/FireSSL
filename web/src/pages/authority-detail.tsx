import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { FileBadgeIcon, FilePlus2Icon } from "lucide-react"

import { PageContainer, PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CertDetails, PemBlock } from "@/features/certs/cert-details"
import { IssueDialog } from "@/features/certs/issue-dialog"
import { canIssue } from "@/features/certs/options"
import {
  ChainPath,
  DetailError,
  DetailSkeleton,
  RecordAlerts,
  RecordTitle,
} from "@/features/certs/record-detail"
import { DownloadButton, RecordMenu } from "@/features/certs/record-menu"
import { AuthoritiesTable, CertificatesTable } from "@/features/certs/tables"
import { TrustGuide } from "@/features/certs/trust-guide"
import { useI18n } from "@/i18n"
import {
  useAuthorities,
  useCertificates,
  usePkiDefaults,
  useRecord,
} from "@/lib/queries"
import type { CertRecord } from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"

function IssuedTab({ ca }: { ca: CertRecord }) {
  const { t } = useI18n()
  const certificates = useCertificates(ca.id)
  const authorities = useAuthorities()
  const subCAs = (authorities.data ?? []).filter((a) => a.issuerId === ca.id)

  if (certificates.isPending) return <Skeleton className="h-48" />
  const certs = certificates.data ?? []
  return (
    <div className="flex flex-col gap-4">
      {subCAs.length > 0 && (
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>{t("authorities.detail.subCas")}</CardTitle>
          </CardHeader>
          <AuthoritiesTable items={subCAs.map((a) => ({ ...a, depth: 0 }))} />
        </Card>
      )}
      <Card className="gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>{t("authorities.detail.certificates")}</CardTitle>
        </CardHeader>
        {certs.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileBadgeIcon />
              </EmptyMedia>
              <EmptyTitle>{t("authorities.detail.noCertificates")}</EmptyTitle>
              <EmptyDescription>
                {t("authorities.detail.noCertificatesHint")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <CertificatesTable items={certs} showIssuer={false} />
        )}
      </Card>
    </div>
  )
}

function DistributionCard({ ca }: { ca: CertRecord }) {
  const { t } = useI18n()
  const defaults = usePkiDefaults()
  const publicUrl = defaults.data?.publicUrl.replace(/\/+$/, "")
  const origin = publicUrl || window.location.origin
  const rows = [
    {
      label: t("authorities.detail.crlUrl"),
      value: `${origin}/crl/${ca.id}.crl`,
    },
    {
      label: t("authorities.detail.caUrl"),
      value: `${origin}/ca/${ca.id}.crt`,
    },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("authorities.detail.distribution")}</CardTitle>
        <CardDescription>
          {publicUrl
            ? t("authorities.detail.distributionHint")
            : t("authorities.detail.distributionNoUrl")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{row.label}</span>
            <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">
              {row.value}
            </code>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function AuthorityDetailPage() {
  const { t, fmt } = useI18n()
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const record = useRecord("ca", id)
  const ws = useWorkspace()
  const [issueOpen, setIssueOpen] = React.useState(false)

  if (record.isPending) {
    return (
      <PageContainer>
        <DetailSkeleton />
      </PageContainer>
    )
  }
  if (record.isError) {
    return (
      <PageContainer>
        <DetailError
          error={record.error}
          onRetry={() => void record.refetch()}
          backTo="/authorities"
        />
      </PageContainer>
    )
  }
  const ca = record.data
  const issuing = canIssue(ca) && !ca.readOnly && ws.can("issue")

  return (
    <PageContainer>
      <PageHeader
        title={<RecordTitle record={ca} />}
        description={
          <span className="flex flex-col gap-1">
            {ca.chain && ca.chain.length > 0 && <ChainPath record={ca} />}
            <span>
              {t("authorities.detail.summary", {
                certs: ca.issuedCount,
                cas: ca.childCount,
              })}
              {" · "}
              {t("certs.createdAt", { when: fmt.dateTime(ca.createdAt) })}
            </span>
          </span>
        }
        actions={
          <>
            {issuing && (
              <Button onClick={() => setIssueOpen(true)}>
                <FilePlus2Icon data-icon="inline-start" />
                {t("certs.issue.short")}
              </Button>
            )}
            <DownloadButton record={ca} />
            <RecordMenu
              record={ca}
              onDeleted={() => navigate("/authorities", { replace: true })}
            />
          </>
        }
      />
      <RecordAlerts record={ca} />
      <Tabs defaultValue="issued" className="gap-4">
        <TabsList>
          <TabsTrigger value="issued">
            {t("authorities.detail.tabs.issued")}
          </TabsTrigger>
          <TabsTrigger value="details">{t("certs.tabs.details")}</TabsTrigger>
          <TabsTrigger value="trust">
            {t("authorities.detail.tabs.trust")}
          </TabsTrigger>
          <TabsTrigger value="pem">{t("certs.tabs.pem")}</TabsTrigger>
        </TabsList>
        <TabsContent value="issued">
          <IssuedTab ca={ca} />
        </TabsContent>
        <TabsContent value="details">
          <CertDetails details={ca.details} status={ca.status} />
        </TabsContent>
        <TabsContent value="trust" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("authorities.trust.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <TrustGuide record={ca} />
            </CardContent>
          </Card>
          {ca.hasKey && <DistributionCard ca={ca} />}
        </TabsContent>
        <TabsContent value="pem">
          <PemBlock pem={ca.certPem ?? ""} />
        </TabsContent>
      </Tabs>
      {issuing && (
        <IssueDialog
          open={issueOpen}
          onOpenChange={setIssueOpen}
          issuerId={ca.id}
        />
      )}
    </PageContainer>
  )
}
