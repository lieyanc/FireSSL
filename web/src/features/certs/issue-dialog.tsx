import * as React from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useNavigate } from "react-router"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import {
  IssuerSelect,
  KeyAlgorithmSelect,
  ProfileToggle,
  SanTextarea,
  ValidityInput,
} from "@/features/certs/form-fields"
import { APPLE_MAX_TLS_DAYS, parseSans } from "@/features/certs/options"
import { FormSkeleton } from "@/features/certs/form-skeleton"
import { SubjectFields } from "@/features/certs/subject-fields"
import {
  subjectSchema,
  type SubjectValues,
} from "@/features/certs/subject-schema"
import { useI18n, type Translate } from "@/i18n"
import { api, isApiError } from "@/lib/api"
import { applyServerError } from "@/lib/form"
import { invalidateInventory, usePkiDefaults } from "@/lib/queries"
import type { KeyAlgorithm, LeafProfile, PkiDefaults } from "@/lib/types"

function schema(t: Translate) {
  return z
    .object({
      issuerId: z.string().min(1, t("certs.form.issuerRequired")),
      profile: z.enum(["server", "client", "server-client"]),
      commonName: z
        .string()
        .trim()
        .max(64, t("certs.form.tooLong", { max: 64 })),
      sans: z.string(),
      keyAlgorithm: z.string(),
      validityDays: z.string().regex(/^\d+$/, t("certs.form.daysInvalid")),
      name: z.string().trim().max(128),
    })
    .extend(subjectSchema(t).shape)
    .superRefine((v, ctx) => {
      if (!v.commonName && !v.sans.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["commonName"],
          message: t("certs.form.nameRequired"),
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
  "sans.dns": "sans",
  "sans.ip": "sans",
  "sans.email": "sans",
  "sans.uri": "sans",
}

export function IssueDialog({
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
          <DialogTitle>{t("certs.issue.title")}</DialogTitle>
          <DialogDescription>{t("certs.issue.description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <IssueFormLoader
            issuerId={issuerId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Waits for the configured defaults so the form starts from them. */
function IssueFormLoader(props: { issuerId?: string; onDone: () => void }) {
  const defaults = usePkiDefaults()
  if (defaults.isPending) return <FormSkeleton />
  return <IssueForm {...props} defaults={defaults.data} />
}

function IssueForm({
  issuerId,
  onDone,
  defaults,
}: {
  issuerId?: string
  onDone: () => void
  defaults?: PkiDefaults
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [moreOpen, setMoreOpen] = React.useState(false)
  const resolver = React.useMemo(() => zodResolver(schema(t)), [t])

  const form = useForm<Values>({
    resolver,
    defaultValues: {
      issuerId: issuerId ?? "",
      profile: "server",
      commonName: "",
      sans: "",
      keyAlgorithm: defaults?.defaultKeyAlgorithm ?? "ecdsa-p256",
      validityDays: String(defaults?.defaultValidityDays ?? 397),
      name: "",
      organization: "",
      organizationalUnit: "",
      country: "",
      province: "",
      locality: "",
    },
  })
  const { errors, isSubmitting } = form.formState
  const [profile, days] = useWatch({
    control: form.control,
    name: ["profile", "validityDays"],
  })
  const tooLong = profile !== "client" && Number(days) > APPLE_MAX_TLS_DAYS

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const subject: SubjectValues & { commonName: string } = {
        commonName: v.commonName,
        organization: v.organization,
        organizationalUnit: v.organizationalUnit,
        country: v.country,
        province: v.province,
        locality: v.locality,
      }
      const cert = await api.certificates.issue({
        issuerId: v.issuerId,
        profile: v.profile as LeafProfile,
        subject,
        sans: parseSans(v.sans),
        keyAlgorithm: v.keyAlgorithm as KeyAlgorithm,
        validityDays: Number(v.validityDays),
        name: v.name,
      })
      await invalidateInventory(queryClient)
      toast.success(t("certs.issue.done", { name: cert.name }))
      onDone()
      navigate(`/certificates/${cert.id}`)
    } catch (error) {
      if (
        isApiError(error) &&
        error.field?.startsWith("subject.") &&
        error.field !== "subject.commonName"
      ) {
        setMoreOpen(true)
      }
      applyServerError(form, error, t, FIELD_MAP)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Controller
          control={form.control}
          name="issuerId"
          render={({ field }) => (
            <Field data-invalid={!!errors.issuerId || undefined}>
              <FieldLabel htmlFor="issue-issuer">
                {t("certs.form.issuer")}
              </FieldLabel>
              <IssuerSelect
                id="issue-issuer"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.issuerId}
              />
              <FieldError errors={[errors.issuerId]} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="profile"
          render={({ field }) => (
            <Field>
              <FieldLabel>{t("certs.form.profile")}</FieldLabel>
              <ProfileToggle
                value={field.value as LeafProfile}
                onChange={field.onChange}
              />
              <FieldDescription>
                {t(`certs.profileHints.${field.value as LeafProfile}`)}
              </FieldDescription>
            </Field>
          )}
        />
        <Field data-invalid={!!errors.commonName || undefined}>
          <FieldLabel htmlFor="issue-cn">
            {t("certs.subject.commonName")}
          </FieldLabel>
          <Input
            id="issue-cn"
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            placeholder={profile === "client" ? "alice" : "app.example.com"}
            aria-invalid={!!errors.commonName}
            {...form.register("commonName")}
          />
          {errors.commonName ? (
            <FieldError errors={[errors.commonName]} />
          ) : (
            profile !== "client" && (
              <FieldDescription>{t("certs.form.cnHint")}</FieldDescription>
            )
          )}
        </Field>
        <Controller
          control={form.control}
          name="sans"
          render={({ field }) => (
            <Field data-invalid={!!errors.sans || undefined}>
              <FieldLabel htmlFor="issue-sans">
                {t("certs.form.sans")}
              </FieldLabel>
              <SanTextarea
                id="issue-sans"
                invalid={!!errors.sans}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
              {errors.sans ? (
                <FieldError errors={[errors.sans]} />
              ) : (
                <FieldDescription>{t("certs.form.sansHint")}</FieldDescription>
              )}
            </Field>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="keyAlgorithm"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="issue-key">
                  {t("certs.form.keyAlgorithm")}
                </FieldLabel>
                <KeyAlgorithmSelect
                  id="issue-key"
                  value={field.value as KeyAlgorithm}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <Field data-invalid={!!errors.name || undefined}>
            <FieldLabel htmlFor="issue-name">
              {t("certs.form.displayName")}
            </FieldLabel>
            <Input
              id="issue-name"
              placeholder={t("certs.form.displayNamePlaceholder")}
              {...form.register("name")}
            />
          </Field>
        </div>
        <Controller
          control={form.control}
          name="validityDays"
          render={({ field }) => (
            <Field data-invalid={!!errors.validityDays || undefined}>
              <FieldLabel htmlFor="issue-days">
                {t("certs.form.validity")}
              </FieldLabel>
              <ValidityInput
                id="issue-days"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.validityDays}
                presets={[90, 397, 825, 1825]}
              />
              <FieldError errors={[errors.validityDays]} />
              {tooLong && (
                <Alert>
                  <TriangleAlertIcon />
                  <AlertDescription>
                    {t("certs.form.appleLimit", { days: APPLE_MAX_TLS_DAYS })}
                  </AlertDescription>
                </Alert>
              )}
            </Field>
          )}
        />
        <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="-ml-2">
              <ChevronDownIcon
                data-icon="inline-start"
                className={
                  moreOpen
                    ? "rotate-180 transition-transform"
                    : "transition-transform"
                }
              />
              {t("certs.form.moreSubject")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <SubjectFields form={form} idPrefix="issue" />
          </CollapsibleContent>
        </Collapsible>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.actions.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {isSubmitting ? t("certs.issue.submitting") : t("certs.issue.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}
