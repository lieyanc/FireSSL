import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { z } from "zod"

import { PasswordInput } from "@/components/common/password-input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { applyServerError } from "@/lib/form"
import {
  invalidateDirectory,
  invalidateInventory,
  useTenants,
} from "@/lib/queries"
import type { CertRecord, Role, Tenant, User } from "@/lib/types"
import { ROLES } from "@/lib/workspace"

/** Role picker with a hint under each option. */
export function RoleSelect({
  id,
  value,
  onChange,
}: {
  id?: string
  value: Role
  onChange: (role: Role) => void
}) {
  const { t } = useI18n()
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)}>
      <SelectTrigger id={id} className="w-full">
        {/* Only the role name in the trigger; hints show in the list. */}
        <SelectValue>{t(`access.roles.${value}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              <span className="flex flex-col">
                <span>{t(`access.roles.${r}`)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`access.roleHints.${r}`)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

const PLATFORM = "platform"

/** Tenant picker; "" is the platform. */
export function TenantSelect({
  id,
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (id: string) => void
}) {
  const { t } = useI18n()
  const tenants = useTenants()
  return (
    <Select
      value={value || PLATFORM}
      onValueChange={(v) => onChange(v === PLATFORM ? "" : v)}
      disabled={tenants.isPending}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={PLATFORM}>
            {t("access.workspace.platform")}
          </SelectItem>
          {(tenants.data ?? []).map((tn) => (
            <SelectItem key={tn.id} value={tn.id}>
              {tn.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && children}
      </DialogContent>
    </Dialog>
  )
}

function Footer({
  pending,
  onCancel,
  label,
}: {
  pending: boolean
  onCancel: () => void
  label: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        {t("common.actions.cancel")}
      </Button>
      <Button type="submit" disabled={pending}>
        {pending && <Spinner data-icon="inline-start" />}
        {label}
      </Button>
    </DialogFooter>
  )
}

/** Creates a tenant, or edits one when `tenant` is given. */
export function TenantDialog({
  open,
  onOpenChange,
  tenant,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenant?: Tenant
  onCreated?: (tenant: Tenant) => void
}) {
  const { t } = useI18n()
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={
        tenant
          ? t("access.tenants.form.editTitle")
          : t("access.tenants.form.createTitle")
      }
      description={tenant ? undefined : t("access.tenants.description")}
    >
      <TenantForm
        tenant={tenant}
        onCreated={onCreated}
        onDone={() => onOpenChange(false)}
      />
    </DialogShell>
  )
}

function TenantForm({
  tenant,
  onCreated,
  onDone,
}: {
  tenant?: Tenant
  onCreated?: (tenant: Tenant) => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const schema = React.useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("access.tenants.form.nameRequired"))
          .max(64),
        description: z.string().trim().max(256),
      }),
    [t]
  )
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: tenant?.name ?? "",
      description: tenant?.description ?? "",
    },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (tenant) {
        await api.tenants.update(tenant.id, v)
        toast.success(t("access.tenants.form.saved"))
      } else {
        const created = await api.tenants.create(v)
        toast.success(t("access.tenants.form.created", { name: created.name }))
        onCreated?.(created)
      }
      await invalidateDirectory(queryClient)
      onDone()
    } catch (error) {
      applyServerError(form, error, t)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="tenant-name">
            {t("access.tenants.form.name")}
          </FieldLabel>
          <Input
            id="tenant-name"
            autoFocus
            aria-invalid={!!errors.name}
            {...form.register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={!!errors.description || undefined}>
          <FieldLabel htmlFor="tenant-description">
            {t("access.tenants.form.description")}
          </FieldLabel>
          <Input
            id="tenant-description"
            placeholder={t("access.tenants.form.descriptionPlaceholder")}
            {...form.register("description")}
          />
          <FieldError errors={[errors.description]} />
        </Field>
      </FieldGroup>
      <Footer
        pending={isSubmitting}
        onCancel={onDone}
        label={
          tenant ? t("common.actions.save") : t("access.tenants.new")
        }
      />
    </form>
  )
}

/** Adds a member to a tenant by username. */
export function AddMemberDialog({
  open,
  onOpenChange,
  tenant,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenant: Tenant
}) {
  const { t } = useI18n()
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("access.members.add")}
      description={t("access.members.addHint")}
    >
      <AddMemberForm tenant={tenant} onDone={() => onOpenChange(false)} />
    </DialogShell>
  )
}

function AddMemberForm({
  tenant,
  onDone,
}: {
  tenant: Tenant
  onDone: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const schema = React.useMemo(
    () =>
      z.object({
        username: z
          .string()
          .trim()
          .min(1, t("access.members.usernameRequired")),
        role: z.enum(["owner", "operator", "viewer"]),
      }),
    [t]
  )
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", role: "operator" },
  })
  const { errors, isSubmitting } = form.formState
  const role = useWatch({ control: form.control, name: "role" })

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.tenants.setMember(tenant.id, v.username, v.role)
      await invalidateDirectory(queryClient)
      toast.success(
        t("access.members.added", {
          name: v.username,
          role: t(`access.roles.${v.role}`),
        })
      )
      onDone()
    } catch (error) {
      applyServerError(form, error, t)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={!!errors.username || undefined}>
          <FieldLabel htmlFor="member-username">
            {t("access.members.username")}
          </FieldLabel>
          <Input
            id="member-username"
            autoFocus
            autoComplete="off"
            aria-invalid={!!errors.username}
            {...form.register("username")}
          />
          <FieldError errors={[errors.username]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="member-role">
            {t("access.members.role")}
          </FieldLabel>
          <RoleSelect
            id="member-role"
            value={role}
            onChange={(r) => form.setValue("role", r)}
          />
        </Field>
      </FieldGroup>
      <Footer
        pending={isSubmitting}
        onCancel={onDone}
        label={t("access.members.add")}
      />
    </form>
  )
}

/** Creates a user account. */
export function UserDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("access.users.form.createTitle")}
    >
      <UserForm onDone={() => onOpenChange(false)} />
    </DialogShell>
  )
}

function UserForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const schema = React.useMemo(
    () =>
      z.object({
        username: z
          .string()
          .trim()
          .min(1, t("auth.validation.usernameRequired"))
          .max(64, t("auth.validation.usernameLength")),
        password: z
          .string()
          .min(8, t("auth.validation.passwordLength"))
          .max(128, t("auth.validation.passwordLength")),
        admin: z.boolean(),
      }),
    [t]
  )
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "", admin: false },
  })
  const { errors, isSubmitting } = form.formState
  const admin = useWatch({ control: form.control, name: "admin" })

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const user = await api.users.create(v)
      await invalidateDirectory(queryClient)
      toast.success(t("access.users.form.created", { name: user.username }))
      onDone()
    } catch (error) {
      applyServerError(form, error, t)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={!!errors.username || undefined}>
          <FieldLabel htmlFor="user-username">
            {t("access.users.form.username")}
          </FieldLabel>
          <Input
            id="user-username"
            autoFocus
            autoComplete="off"
            aria-invalid={!!errors.username}
            {...form.register("username")}
          />
          <FieldError errors={[errors.username]} />
        </Field>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="user-password">
            {t("access.users.form.password")}
          </FieldLabel>
          <PasswordInput
            id="user-password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...form.register("password")}
          />
          {errors.password ? (
            <FieldError errors={[errors.password]} />
          ) : (
            <FieldDescription>
              {t("access.users.form.passwordHint")}
            </FieldDescription>
          )}
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="user-admin">
              {t("access.users.form.admin")}
            </FieldLabel>
            <FieldDescription>{t("access.users.form.adminHint")}</FieldDescription>
          </FieldContent>
          <Switch
            id="user-admin"
            checked={admin}
            onCheckedChange={(c) => form.setValue("admin", c)}
          />
        </Field>
      </FieldGroup>
      <Footer
        pending={isSubmitting}
        onCancel={onDone}
        label={t("access.users.new")}
      />
    </form>
  )
}

/** Sets a new password for another user. */
export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: User
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("access.users.resetPassword.title", { name: user.username })}
      description={t("access.users.resetPassword.description")}
    >
      <ResetPasswordForm user={user} onDone={() => onOpenChange(false)} />
    </DialogShell>
  )
}

function ResetPasswordForm({
  user,
  onDone,
}: {
  user: User
  onDone: () => void
}) {
  const { t } = useI18n()
  const schema = React.useMemo(
    () =>
      z.object({
        password: z
          .string()
          .min(8, t("auth.validation.passwordLength"))
          .max(128, t("auth.validation.passwordLength")),
      }),
    [t]
  )
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "" },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.users.update(user.id, { password: v.password })
      toast.success(t("access.users.resetPassword.done"))
      onDone()
    } catch (error) {
      applyServerError(form, error, t)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="reset-password">
            {t("settings.account.newPassword")}
          </FieldLabel>
          <PasswordInput
            id="reset-password"
            autoFocus
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...form.register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>
      </FieldGroup>
      <Footer
        pending={isSubmitting}
        onCancel={onDone}
        label={t("access.users.resetPassword.submit")}
      />
    </form>
  )
}

/** Hands a sub-CA (and everything below it) to a tenant. */
export function AssignTenantDialog({
  record,
  open,
  onOpenChange,
}: {
  record: CertRecord
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("access.assign.title", { name: record.name })}
      description={t("access.assign.description")}
    >
      <AssignForm record={record} onDone={() => onOpenChange(false)} />
    </DialogShell>
  )
}

function AssignForm({
  record,
  onDone,
}: {
  record: CertRecord
  onDone: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const tenants = useTenants()
  const [tenantId, setTenantId] = React.useState(record.tenantId ?? "")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await api.authorities.assignTenant(record.id, tenantId)
      await Promise.all([
        invalidateInventory(queryClient),
        invalidateDirectory(queryClient),
      ])
      const name = tenants.data?.find((tn) => tn.id === tenantId)?.name
      toast.success(
        name
          ? t("access.assign.done", { name: record.name, tenant: name })
          : t("access.assign.unassigned", { name: record.name })
      )
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="assign-tenant">
            {t("access.assign.tenant")}
          </FieldLabel>
          <TenantSelect
            id="assign-tenant"
            value={tenantId}
            onChange={setTenantId}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>
      <Footer
        pending={pending}
        onCancel={onDone}
        label={t("access.assign.submit")}
      />
    </form>
  )
}
