import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  CircleCheckIcon,
  KeyRoundIcon,
  MoreHorizontalIcon,
  ShieldIcon,
  ShieldOffIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { PageContainer, PageHeader } from "@/components/common/page-header"
import { QueryError } from "@/components/common/query-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ResetPasswordDialog, UserDialog } from "@/features/access/dialogs"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { toastError } from "@/lib/errors"
import { invalidateDirectory, useAuthState, useUsers } from "@/lib/queries"
import type { User, UserChange } from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"
import NotFoundPage from "@/pages/not-found"

function UserMenu({ user, self }: { user: User; self: boolean }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = React.useState<"reset" | "delete" | null>(null)
  const close = (open: boolean) => !open && setDialog(null)

  const update = async (change: UserChange) => {
    try {
      await api.users.update(user.id, change)
      await invalidateDirectory(queryClient)
      toast.success(t("access.users.updated", { name: user.username }))
    } catch (error) {
      toastError(error, t)
    }
  }

  const remove = async () => {
    try {
      await api.users.remove(user.id)
    } catch (error) {
      toastError(error, t)
      throw error
    }
    toast.success(t("access.users.delete.done", { name: user.username }))
    await invalidateDirectory(queryClient)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common.actions.more")}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setDialog("reset")}>
              <KeyRoundIcon />
              {t("access.users.resetPassword.action")}
            </DropdownMenuItem>
            {!self && (
              <DropdownMenuItem
                onSelect={() => void update({ admin: !user.admin })}
              >
                {user.admin ? <ShieldOffIcon /> : <ShieldIcon />}
                {user.admin
                  ? t("access.users.revokeAdmin")
                  : t("access.users.makeAdmin")}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {!self && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant={user.disabled ? "default" : "destructive"}
                  onSelect={() => void update({ disabled: !user.disabled })}
                >
                  {user.disabled ? <CircleCheckIcon /> : <BanIcon />}
                  {user.disabled
                    ? t("access.users.enable")
                    : t("access.users.disable")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDialog("delete")}
                >
                  <Trash2Icon />
                  {t("common.actions.delete")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ResetPasswordDialog
        user={user}
        open={dialog === "reset"}
        onOpenChange={close}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={t("access.users.delete.title", { name: user.username })}
        description={t("access.users.delete.description")}
        confirmLabel={t("common.actions.delete")}
        onConfirm={remove}
      />
    </>
  )
}

export default function UsersPage() {
  const { t, fmt } = useI18n()
  const ws = useWorkspace()
  const selfId = useAuthState().data?.user?.id
  const users = useUsers()
  const [open, setOpen] = React.useState(false)

  if (!ws.admin) return <NotFoundPage />

  return (
    <PageContainer>
      <PageHeader
        title={t("access.users.title")}
        description={t("access.users.description")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <UserPlusIcon data-icon="inline-start" />
            {t("access.users.new")}
          </Button>
        }
      />
      {users.isError && !users.data ? (
        <QueryError error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <Card className="gap-0 py-0">
          {users.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">
                    {t("access.users.columns.username")}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("access.users.columns.tenants")}
                  </TableHead>
                  <TableHead>{t("access.users.columns.status")}</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t("access.users.columns.created")}
                  </TableHead>
                  <TableHead className="w-12 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users.data ?? []).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="max-w-64 pl-4">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">
                          {u.username}
                        </span>
                        {u.id === selfId && (
                          <span className="text-xs text-muted-foreground">
                            ({t("access.members.you")})
                          </span>
                        )}
                        {u.admin && (
                          <Badge variant="secondary">
                            {t("access.roles.admin")}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-80 md:table-cell">
                      {u.tenants.length === 0 ? (
                        <span className="text-muted-foreground">
                          {u.admin ? "–" : t("access.users.noTenants")}
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {u.tenants.map((m) => (
                            <Badge key={m.id} variant="outline">
                              {m.name} · {t(`access.roles.${m.role}`)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.disabled ? (
                        <Badge variant="destructive">
                          {t("access.users.disabled")}
                        </Badge>
                      ) : (
                        <span className="text-sm">
                          {t("access.users.active")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {fmt.date(u.createdAt)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <UserMenu user={u} self={u.id === selfId} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
      <UserDialog open={open} onOpenChange={setOpen} />
    </PageContainer>
  )
}
