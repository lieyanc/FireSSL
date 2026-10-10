import * as React from "react"
import { ShieldIcon, ShieldPlusIcon, UploadIcon } from "lucide-react"

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
import { Skeleton } from "@/components/ui/skeleton"
import { CAFormDialog } from "@/features/certs/ca-form-dialog"
import { ImportCADialog } from "@/features/certs/import-ca-dialog"
import { AuthoritiesTable } from "@/features/certs/tables"
import { useI18n } from "@/i18n"
import { useAuthorities } from "@/lib/queries"

export default function AuthoritiesPage() {
  const { t } = useI18n()
  const authorities = useAuthorities()
  const [dialog, setDialog] = React.useState<"ca" | "import" | null>(null)
  const close = (open: boolean) => !open && setDialog(null)
  const items = authorities.data ?? []

  return (
    <PageContainer>
      <PageHeader
        title={t("authorities.title")}
        description={t("authorities.description")}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog("import")}>
              <UploadIcon data-icon="inline-start" />
              {t("authorities.import.short")}
            </Button>
            <Button onClick={() => setDialog("ca")}>
              <ShieldPlusIcon data-icon="inline-start" />
              {t("authorities.newCa")}
            </Button>
          </>
        }
      />
      {authorities.isError && !authorities.data ? (
        <QueryError
          error={authorities.error}
          onRetry={() => void authorities.refetch()}
        />
      ) : (
        <Card className="gap-0 py-0">
          {authorities.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShieldIcon />
                </EmptyMedia>
                <EmptyTitle>{t("authorities.empty")}</EmptyTitle>
                <EmptyDescription>
                  {t("authorities.emptyHint")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex-row justify-center">
                <Button onClick={() => setDialog("ca")}>
                  <ShieldPlusIcon data-icon="inline-start" />
                  {t("authorities.newRoot")}
                </Button>
                <Button variant="outline" onClick={() => setDialog("import")}>
                  <UploadIcon data-icon="inline-start" />
                  {t("authorities.import.short")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <AuthoritiesTable items={items} />
          )}
        </Card>
      )}
      <CAFormDialog open={dialog === "ca"} onOpenChange={close} />
      <ImportCADialog open={dialog === "import"} onOpenChange={close} />
    </PageContainer>
  )
}
