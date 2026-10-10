import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowRightLeftIcon,
  PencilIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { PageContainer, PageHeader } from "@/components/common/page-header"
import { QueryError } from "@/components/common/query-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AddMemberDialog,
  RoleSelect,
  TenantDialog,
} from "@/features/access/dialogs"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { toastError } from "@/lib/errors"
import { invalidateDirectory, useAuthState, useTenant } from "@/lib/queries"
import type { Member, Role, Tenant } from "@/lib/types"
import { roleCan, selectTenant, useWorkspace } from "@/lib/workspace"
import NotFoundPage from "@/pages/not-found"

function MemberRow({
  tenant,
  member,
  canManage,
  self,
  onRemove,
}: {
  tenant: Tenant
  member: Member
  canManage: boolean
  self: boolean
  onRemove: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [pending, setPending] = React.useState(false)

  const changeRole = async (role: Role) => {
    if (role === member.role) return
    setPending(true)
    try {
      await api.tenants.setMember(tenant.id, member.username, role)
      await invalidateDirectory(queryClient)
      toast.success(
        t("access.members.updated", {
          name: member.username,
          role: t(`access.roles.${role}`),
        })
      )
    } catch (error) {
      toastError(error, t)
    } finally {
      setPending(false)
    }
  }

  return (
    <TableRow>
      <TableCell className="pl-4">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{member.username}</span>
          {self && (
            <span className="text-xs text-muted-foreground">
              ({t("access.members.you")})
            </span>
          )}
          {member.disabled && (
            <Badge variant="secondary">{t("access.members.disabled")}</Badge>
          )}
        </span>
      </TableCell>
      <TableCell className="w-56">
        {canManage ? (
          <fieldset disabled={pending}>
            <RoleSelect value={member.role} onChange={changeRole} />
          </fieldset>
        ) : (
          <Badge variant="outline">{t(`access.roles.${member.role}`)}</Badge>
        )}
      </TableCell>
      <TableCell className="w-12 pr-4 text-right">
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("access.members.remove")}
            onClick={onRemove}
          >
            <UserMinusIcon />
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

export default function TenantDetailPage() {
  const { t } = useI18n()
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ws = useWorkspace()
  const selfId = useAuthState().data?.user?.id
  const tenant = useTenant(id)
  const [dialog, setDialog] = React.useState<
    "add" | "edit" | "delete" | null
  >(null)
  const [removing, setRemoving] = React.useState<Member | null>(null)
  const close = (open: boolean) => !open && setDialog(null)

  const membership = ws.tenants.find((m) => m.id === id)
  if (!ws.admin && !membership) return <NotFoundPage />

  if (tenant.isPending) {
    return (
      <PageContainer className="max-w-4xl">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </PageContainer>
    )
  }
  if (tenant.isError) {
    return (
      <PageContainer className="max-w-4xl">
        <QueryError
          error={tenant.error}
          onRetry={() => void tenant.refetch()}
        />
      </PageContainer>
    )
  }
  const tn = tenant.data
  const canManage = !!tn.role && roleCan(tn.role, "members")
  const members = tn.members ?? []

  const remove = async () => {
    if (!removing) return
    try {
      await api.tenants.removeMember(tn.id, removing.userId)
    } catch (error) {
      toastError(error, t)
      throw error
    }
    toast.success(t("access.members.removed", { name: removing.username }))
    await invalidateDirectory(queryClient)
  }

  const deleteTenant = async () => {
    try {
      await api.tenants.remove(tn.id)
    } catch (error) {
      toastError(error, t)
      throw error
    }
    toast.success(t("access.tenants.delete.done", { name: tn.name }))
    await invalidateDirectory(queryClient)
    navigate("/tenants", { replace: true })
  }

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title={tn.name}
        description={tn.description}
        actions={
          <>
            {ws.tenant?.id !== tn.id && (
              <Button
                variant="outline"
                onClick={() => {
                  selectTenant(tn.id)
                  navigate("/")
                }}
              >
                <ArrowRightLeftIcon data-icon="inline-start" />
                {t("access.tenants.open")}
              </Button>
            )}
            {ws.admin && (
              <>
                <Button variant="outline" onClick={() => setDialog("edit")}>
                  <PencilIcon data-icon="inline-start" />
                  {t("access.tenants.edit")}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("common.actions.delete")}
                  onClick={() => setDialog("delete")}
                >
                  <Trash2Icon />
                </Button>
              </>
            )}
          </>
        }
      />
      <Card className="gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>{t("access.members.title")}</CardTitle>
          <CardDescription>
            {t("access.members.description", { name: tn.name })}
          </CardDescription>
          {canManage && (
            <CardAction>
              <Button size="sm" onClick={() => setDialog("add")}>
                <UserPlusIcon data-icon="inline-start" />
                {t("access.members.add")}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        {members.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>{t("access.members.empty")}</EmptyTitle>
              <EmptyDescription>{t("access.members.addHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">
                  {t("access.members.username")}
                </TableHead>
                <TableHead>{t("access.members.role")}</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <MemberRow
                  key={m.userId}
                  tenant={tn}
                  member={m}
                  canManage={canManage}
                  self={m.userId === selfId}
                  onRemove={() => setRemoving(m)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {canManage && (
        <AddMemberDialog
          open={dialog === "add"}
          onOpenChange={close}
          tenant={tn}
        />
      )}
      {ws.admin && (
        <>
          <TenantDialog
            open={dialog === "edit"}
            onOpenChange={close}
            tenant={tn}
          />
          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={close}
            title={t("access.tenants.delete.title", { name: tn.name })}
            description={t("access.tenants.delete.description")}
            confirmLabel={t("common.actions.delete")}
            onConfirm={deleteTenant}
          />
        </>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("access.members.removeTitle", {
          name: removing?.username ?? "",
          tenant: tn.name,
        })}
        description={t("access.members.removeDescription")}
        confirmLabel={t("access.members.remove")}
        onConfirm={remove}
      />
    </PageContainer>
  )
}
