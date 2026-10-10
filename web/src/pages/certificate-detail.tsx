import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { RefreshCwIcon } from "lucide-react"

import { PageContainer, PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CertDetails, PemBlock } from "@/features/certs/cert-details"
import {
  ChainPath,
  DetailError,
  DetailSkeleton,
  RecordAlerts,
  RecordTitle,
} from "@/features/certs/record-detail"
import { RenewDialog } from "@/features/certs/record-dialogs"
import { DownloadButton, RecordMenu } from "@/features/certs/record-menu"
import { useI18n } from "@/i18n"
import { useRecord } from "@/lib/queries"
import { useWorkspace } from "@/lib/workspace"

export default function CertificateDetailPage() {
  const { t, fmt } = useI18n()
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const record = useRecord("leaf", id)
  const ws = useWorkspace()
  const [renewOpen, setRenewOpen] = React.useState(false)

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
          backTo="/certificates"
        />
      </PageContainer>
    )
  }
  const r = record.data
  const manage = ws.canManage(r)

  return (
    <PageContainer>
      <PageHeader
        title={<RecordTitle record={r} />}
        description={
          <span className="flex flex-col gap-1">
            <ChainPath record={r} />
            <span>
              {t("certs.createdAt", { when: fmt.dateTime(r.createdAt) })}
            </span>
          </span>
        }
        actions={
          <>
            {manage && (
              <Button variant="outline" onClick={() => setRenewOpen(true)}>
                <RefreshCwIcon data-icon="inline-start" />
                {t("certs.renew.short")}
              </Button>
            )}
            <DownloadButton record={r} />
            <RecordMenu
              record={r}
              onDeleted={() => navigate("/certificates", { replace: true })}
            />
          </>
        }
      />
      <RecordAlerts record={r} />
      <Tabs defaultValue="details" className="gap-4">
        <TabsList>
          <TabsTrigger value="details">{t("certs.tabs.details")}</TabsTrigger>
          <TabsTrigger value="pem">{t("certs.tabs.pem")}</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <CertDetails details={r.details} status={r.status} />
        </TabsContent>
        <TabsContent value="pem">
          <PemBlock pem={r.certPem ?? ""} />
        </TabsContent>
      </Tabs>
      {manage && (
        <RenewDialog record={r} open={renewOpen} onOpenChange={setRenewOpen} />
      )}
    </PageContainer>
  )
}
