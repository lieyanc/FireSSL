import * as React from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { PasswordInput } from "@/components/common/password-input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { ValidityInput } from "@/features/certs/form-fields"
import { REVOCATION_REASONS } from "@/features/certs/options"
import { useI18n } from "@/i18n"
import { isApiError, recordsApi, api } from "@/lib/api"
import { errorMessage, toastError } from "@/lib/errors"
import { invalidateInventory } from "@/lib/queries"
import type { CertRecord, RevocationReason } from "@/lib/types"

type DialogProps = {
  record: CertRecord
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Runs an async submit with a pending flag and an inline error. */
function useSubmit() {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      if (isApiError(e) && (e.code === "validation" || e.code === "conflict")) {
        setError(errorMessage(e, t))
      } else {
        toastError(e, t)
      }
    } finally {
      setPending(false)
    }
  }
  return { pending, error, run }
}

export function RevokeDialog({ record, open, onOpenChange }: DialogProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [reason, setReason] = React.useState<RevocationReason>("unspecified")
  const { pending, error, run } = useSubmit()
  const reasons =
    record.kind === "ca"
      ? REVOCATION_REASONS
      : REVOCATION_REASONS.filter((r) => r !== "caCompromise")

  const submit = () =>
    run(async () => {
      await recordsApi(record.kind).revoke(record.id, reason)
      await invalidateInventory(queryClient)
      toast.success(t("certs.revoke.done", { name: record.name }))
      onOpenChange(false)
    })

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("certs.revoke.title", { name: record.name })}
          </DialogTitle>
          <DialogDescription>
            {record.kind === "ca"
              ? t("certs.revoke.descriptionCa")
              : t("certs.revoke.description")}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="revoke-reason">
              {t("certs.revoke.reason")}
            </FieldLabel>
            <Select
              value={reason}
              onValueChange={(v) => setReason(v as RevocationReason)}
            >
              <SelectTrigger id="revoke-reason" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {reasons.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`common.reasons.${r}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {error && <FieldError>{error}</FieldError>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => void submit()}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {t("certs.revoke.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RenameDialog({ record, open, onOpenChange }: DialogProps) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("certs.rename.title")}</DialogTitle>
          <DialogDescription>{t("certs.rename.description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <RenameForm record={record} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({
  record,
  onDone,
}: {
  record: CertRecord
  onDone: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [name, setName] = React.useState(record.name)
  const { pending, error, run } = useSubmit()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await recordsApi(record.kind).rename(record.id, name)
      await invalidateInventory(queryClient)
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor="rename-name">
          {t("certs.form.displayName")}
        </FieldLabel>
        <Input
          id="rename-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!error}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onDone}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending && <Spinner data-icon="inline-start" />}
          {t("common.actions.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function RenewDialog({ record, open, onOpenChange }: DialogProps) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("certs.renew.title", { name: record.name })}
          </DialogTitle>
          <DialogDescription>{t("certs.renew.description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <RenewForm record={record} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RenewForm({
  record,
  onDone,
}: {
  record: CertRecord
  onDone: () => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const lifetime = Math.max(
    1,
    Math.round(
      (new Date(record.details.notAfter).getTime() -
        new Date(record.details.notBefore).getTime()) /
        86_400_000
    )
  )
  const [days, setDays] = React.useState(String(lifetime))
  const [reuseKey, setReuseKey] = React.useState(!record.hasKey)
  const [revokeOld, setRevokeOld] = React.useState(false)
  const { pending, error, run } = useSubmit()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const next = await api.certificates.renew(record.id, {
        validityDays: Number(days),
        reuseKey,
        revokeOld,
      })
      await invalidateInventory(queryClient)
      toast.success(t("certs.renew.done", { name: next.name }))
      onDone()
      navigate(`/certificates/${next.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="renew-days">
            {t("certs.form.validity")}
          </FieldLabel>
          <ValidityInput
            id="renew-days"
            value={days}
            onChange={setDays}
            presets={[90, 397, 825]}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="renew-reuse">
              {t("certs.renew.reuseKey")}
            </FieldLabel>
            <FieldDescription>
              {record.hasKey
                ? t("certs.renew.reuseKeyHint")
                : t("certs.renew.csrHint")}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="renew-reuse"
            checked={reuseKey}
            disabled={!record.hasKey}
            onCheckedChange={setReuseKey}
          />
        </Field>
        {record.status !== "revoked" && (
          <Field orientation="horizontal">
            <Checkbox
              id="renew-revoke"
              checked={revokeOld}
              onCheckedChange={(v) => setRevokeOld(v === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor="renew-revoke">
                {t("certs.renew.revokeOld")}
              </FieldLabel>
              <FieldDescription>
                {t("certs.renew.revokeOldHint")}
              </FieldDescription>
            </FieldContent>
          </Field>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onDone}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button type="submit" disabled={pending || !/^\d+$/.test(days)}>
          {pending && <Spinner data-icon="inline-start" />}
          {t("certs.renew.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function Pkcs12Dialog({ record, open, onOpenChange }: DialogProps) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("certs.pkcs12.title")}</DialogTitle>
          <DialogDescription>{t("certs.pkcs12.description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <Pkcs12Form record={record} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Pkcs12Form({
  record,
  onDone,
}: {
  record: CertRecord
  onDone: () => void
}) {
  const { t } = useI18n()
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [legacy, setLegacy] = React.useState(false)
  const { pending, error, run } = useSubmit()

  const mismatch = confirm !== "" && confirm !== password

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mismatch) return
    void run(async () => {
      const name = await recordsApi(record.kind).pkcs12(
        record.id,
        password,
        legacy
      )
      toast.success(t("certs.download.saved", { name }))
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="p12-password">
            {t("certs.pkcs12.password")}
          </FieldLabel>
          <PasswordInput
            id="p12-password"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Field data-invalid={mismatch || undefined}>
          <FieldLabel htmlFor="p12-confirm">
            {t("certs.pkcs12.confirm")}
          </FieldLabel>
          <PasswordInput
            id="p12-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
          />
          {mismatch && <FieldError>{t("certs.pkcs12.mismatch")}</FieldError>}
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="p12-legacy">
              {t("certs.pkcs12.legacy")}
            </FieldLabel>
            <FieldDescription>{t("certs.pkcs12.legacyHint")}</FieldDescription>
          </FieldContent>
          <Switch
            id="p12-legacy"
            checked={legacy}
            onCheckedChange={setLegacy}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onDone}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={pending || password.length < 4 || confirm !== password}
        >
          {pending && <Spinner data-icon="inline-start" />}
          {t("certs.pkcs12.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}
