import * as React from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  IssuerSelect,
  KeyAlgorithmSelect,
  ValidityInput,
} from "@/features/certs/form-fields"
import { SubjectFields } from "@/features/certs/subject-fields"
import { subjectSchema } from "@/features/certs/subject-schema"
import { useI18n, type Translate } from "@/i18n"
import { api } from "@/lib/api"
import { applyServerError } from "@/lib/form"
import { invalidateInventory } from "@/lib/queries"
import type { KeyAlgorithm } from "@/lib/types"

const PATH_LENGTHS = ["unlimited", "0", "1", "2", "3"] as const

function schema(t: Translate) {
  return z
    .object({
      kind: z.enum(["root", "intermediate"]),
      issuerId: z.string(),
      commonName: z
        .string()
        .trim()
        .min(1, t("certs.form.cnRequired"))
        .max(64, t("certs.form.tooLong", { max: 64 })),
      name: z.string().trim().max(128),
      keyAlgorithm: z.string(),
      validityDays: z.string().regex(/^\d+$/, t("certs.form.daysInvalid")),
      pathLen: z.enum(PATH_LENGTHS),
    })
    .extend(subjectSchema(t).shape)
    .superRefine((v, ctx) => {
      if (v.kind === "intermediate" && !v.issuerId) {
        ctx.addIssue({
          code: "custom",
          path: ["issuerId"],
          message: t("certs.form.issuerRequired"),
        })
      }
    })
}

type Values = z.infer<ReturnType<typeof schema>>

const FIELD_MAP: Record<string, string> = {
  "subject.commonName": "commonName",
  "subject.organization": "organization",
  "subject.organizationalUnit": "organizationalUnit",
  "subject.country": "country",
  "subject.province": "province",
  "subject.locality": "locality",
}

/** Creates a root CA, or a sub-CA when issuerId is given or chosen. */
export function CAFormDialog({
  open,
  onOpenChange,
  issuerId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  issuerId?: string
}) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {issuerId
              ? t("authorities.form.subTitle")
              : t("authorities.form.title")}
          </DialogTitle>
          <DialogDescription>
            {t("authorities.form.description")}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CAForm issuerId={issuerId} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CAForm({
  issuerId,
  onDone,
}: {
  issuerId?: string
  onDone: () => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const resolver = React.useMemo(() => zodResolver(schema(t)), [t])
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      kind: issuerId ? "intermediate" : "root",
      issuerId: issuerId ?? "",
      commonName: "",
      name: "",
      keyAlgorithm: "ecdsa-p384",
      validityDays: issuerId ? "1825" : "3650",
      pathLen: issuerId ? "0" : "unlimited",
      organization: "",
      organizationalUnit: "",
      country: "",
      province: "",
      locality: "",
    },
  })
  const { errors, isSubmitting } = form.formState
  const kind = useWatch({ control: form.control, name: "kind" })

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const ca = await api.authorities.create({
        name: v.name,
        issuerId: v.kind === "intermediate" ? v.issuerId : undefined,
        subject: {
          commonName: v.commonName,
          organization: v.organization,
          organizationalUnit: v.organizationalUnit,
          country: v.country,
          province: v.province,
          locality: v.locality,
        },
        keyAlgorithm: v.keyAlgorithm as KeyAlgorithm,
        validityDays: Number(v.validityDays),
        pathLen: v.pathLen === "unlimited" ? null : Number(v.pathLen),
      })
      await invalidateInventory(queryClient)
      toast.success(t("authorities.form.created", { name: ca.name }))
      onDone()
      navigate(`/authorities/${ca.id}`)
    } catch (error) {
      applyServerError(form, error, t, FIELD_MAP)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        {!issuerId && (
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Field>
                <FieldLabel>{t("authorities.form.type")}</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  className="w-full"
                  value={field.value}
                  onValueChange={(v) => {
                    if (!v) return
                    field.onChange(v)
                    form.setValue(
                      "validityDays",
                      v === "root" ? "3650" : "1825"
                    )
                    form.setValue("pathLen", v === "root" ? "unlimited" : "0")
                  }}
                >
                  <ToggleGroupItem value="root" className="flex-1">
                    {t("common.profile.root")}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="intermediate" className="flex-1">
                    {t("common.profile.intermediate")}
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {t(`authorities.form.typeHints.${field.value}`)}
                </FieldDescription>
              </Field>
            )}
          />
        )}
        {kind === "intermediate" && !issuerId && (
          <Controller
            control={form.control}
            name="issuerId"
            render={({ field }) => (
              <Field data-invalid={!!errors.issuerId || undefined}>
                <FieldLabel htmlFor="ca-issuer">
                  {t("authorities.form.parent")}
                </FieldLabel>
                <IssuerSelect
                  id="ca-issuer"
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!errors.issuerId}
                  exclude="no-sub-ca"
                />
                <FieldError errors={[errors.issuerId]} />
              </Field>
            )}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.commonName || undefined}>
            <FieldLabel htmlFor="ca-cn">
              {t("certs.subject.commonName")}
            </FieldLabel>
            <Input
              id="ca-cn"
              autoFocus
              placeholder={kind === "root" ? "Acme Root CA" : "Acme Issuing CA"}
              aria-invalid={!!errors.commonName}
              {...form.register("commonName")}
            />
            <FieldError errors={[errors.commonName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ca-name">
              {t("certs.form.displayName")}
            </FieldLabel>
            <Input
              id="ca-name"
              placeholder={t("certs.form.displayNamePlaceholder")}
              {...form.register("name")}
            />
          </Field>
        </div>
        <SubjectFields form={form} idPrefix="ca" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="keyAlgorithm"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="ca-key">
                  {t("certs.form.keyAlgorithm")}
                </FieldLabel>
                <KeyAlgorithmSelect
                  id="ca-key"
                  value={field.value as KeyAlgorithm}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="pathLen"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="ca-pathlen">
                  {t("authorities.form.pathLen")}
                </FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="ca-pathlen" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {PATH_LENGTHS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p === "unlimited"
                            ? t("common.states.unlimited")
                            : p === "0"
                              ? t("authorities.form.pathLenZero")
                              : p}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        </div>
        <Controller
          control={form.control}
          name="validityDays"
          render={({ field }) => (
            <Field data-invalid={!!errors.validityDays || undefined}>
              <FieldLabel htmlFor="ca-days">
                {t("certs.form.validity")}
              </FieldLabel>
              <ValidityInput
                id="ca-days"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.validityDays}
                presets={[1825, 3650, 7300]}
              />
              {errors.validityDays ? (
                <FieldError errors={[errors.validityDays]} />
              ) : (
                kind === "intermediate" && (
                  <FieldDescription>
                    {t("authorities.form.clampHint")}
                  </FieldDescription>
                )
              )}
            </Field>
          )}
        />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.actions.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {isSubmitting
            ? t("authorities.form.submitting")
            : t("authorities.form.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}
