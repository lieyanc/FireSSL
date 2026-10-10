import * as React from "react"
import { Link } from "react-router"
import { BuildingIcon, PlusIcon } from "lucide-react"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TenantDialog } from "@/features/access/dialogs"
import { useI18n } from "@/i18n"
import { useTenants } from "@/lib/queries"
import { useWorkspace } from "@/lib/workspace"
import NotFoundPage from "@/pages/not-found"

export default function TenantsPage() {
  const { t, fmt } = useI18n()
  const ws = useWorkspace()
  const tenants = useTenants()
  const [open, setOpen] = React.useState(false)
  const items = tenants.data ?? []

  if (!ws.admin) return <NotFoundPage />

  const create = (
    <Button onClick={() => setOpen(true)}>
      <PlusIcon data-icon="inline-start" />
      {t("access.tenants.new")}
    </Button>
  )

  return (
    <PageContainer>
      <PageHeader
        title={t("access.tenants.title")}
        description={t("access.tenants.description")}
        actions={create}
      />
      {tenants.isError && !tenants.data ? (
        <QueryError
          error={tenants.error}
          onRetry={() => void tenants.refetch()}
        />
      ) : (
        <Card className="gap-0 py-0">
          {tenants.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BuildingIcon />
                </EmptyMedia>
                <EmptyTitle>{t("access.tenants.empty")}</EmptyTitle>
                <EmptyDescription>
                  {t("access.tenants.emptyHint")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>{create}</EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">
                    {t("access.tenants.columns.name")}
                  </TableHead>
                  <TableHead>{t("access.tenants.columns.members")}</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    {t("access.tenants.columns.records")}
                  </TableHead>
                  <TableHead className="hidden pr-4 md:table-cell">
                    {t("access.tenants.columns.created")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((tn) => (
                  <TableRow key={tn.id}>
                    <TableCell className="max-w-80 pl-4">
                      <Link
                        to={`/tenants/${tn.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {tn.name}
                      </Link>
                      {tn.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {tn.description}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {t("access.tenants.membersValue", {
                        count: tn.memberCount,
                      })}
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {tn.recordCount}
                    </TableCell>
                    <TableCell className="hidden pr-4 md:table-cell">
                      {fmt.date(tn.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
      <TenantDialog open={open} onOpenChange={setOpen} />
    </PageContainer>
  )
}
