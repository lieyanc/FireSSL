import * as React from "react"
import { Controller, useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { z } from "zod"

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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { PemTextarea } from "@/features/certs/form-fields"
import { useI18n, type Translate } from "@/i18n"
import { api } from "@/lib/api"
import { applyServerError } from "@/lib/form"
import { invalidateInventory } from "@/lib/queries"

function schema(t: Translate) {
  return z.object({
    certificate: z.string().trim().min(1, t("authorities.import.certRequired")),
    privateKey: z.string(),
    name: z.string().trim().max(128),
  })
}

type Values = z.infer<ReturnType<typeof schema>>

export function ImportCADialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("authorities.import.title")}</DialogTitle>
          <DialogDescription>
            {t("authorities.import.description")}
          </DialogDescription>
        </DialogHeader>
        {open && <ImportForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const resolver = React.useMemo(() => zodResolver(schema(t)), [t])
  const form = useForm<Values>({
    resolver,
    defaultValues: { certificate: "", privateKey: "", name: "" },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const ca = await api.authorities.import(v)
      await invalidateInventory(queryClient)
      toast.success(t("authorities.import.done", { name: ca.name }))
      onDone()
      navigate(`/authorities/${ca.id}`)
    } catch (error) {
      applyServerError(form, error, t)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Controller
          control={form.control}
          name="certificate"
          render={({ field }) => (
            <Field data-invalid={!!errors.certificate || undefined}>
              <FieldLabel htmlFor="import-cert">
                {t("authorities.import.cert")}
              </FieldLabel>
              <PemTextarea
                id="import-cert"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.certificate}
                placeholder="-----BEGIN CERTIFICATE-----"
              />
              <FieldError errors={[errors.certificate]} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="privateKey"
          render={({ field }) => (
            <Field data-invalid={!!errors.privateKey || undefined}>
              <FieldLabel htmlFor="import-key">
                {t("authorities.import.key")}
              </FieldLabel>
              <PemTextarea
                id="import-key"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.privateKey}
                placeholder="-----BEGIN PRIVATE KEY-----"
              />
              {errors.privateKey ? (
                <FieldError errors={[errors.privateKey]} />
              ) : (
                <FieldDescription>
                  {t("authorities.import.keyHint")}
                </FieldDescription>
              )}
            </Field>
          )}
        />
        <Field>
          <FieldLabel htmlFor="import-name">
            {t("certs.form.displayName")}
          </FieldLabel>
          <Input
            id="import-name"
            placeholder={t("certs.form.displayNamePlaceholder")}
            {...form.register("name")}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.actions.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {t("authorities.import.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}
