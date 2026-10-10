import * as React from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useNavigate } from "react-router"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { InfoList } from "@/components/common/info-list"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { SanList } from "@/features/certs/cert-details"
import {
  IssuerSelect,
  PemTextarea,
  ProfileToggle,
  SanTextarea,
  ValidityInput,
} from "@/features/certs/form-fields"
import { FormSkeleton } from "@/features/certs/form-skeleton"
import {
  formatSans,
  keyAlgorithmLabel,
  parseSans,
} from "@/features/certs/options"
import { useI18n, type Translate } from "@/i18n"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/errors"
import { applyServerError } from "@/lib/form"
import { invalidateInventory, useSettings } from "@/lib/queries"
import type { CSRDetails, LeafProfile } from "@/lib/types"

function schema(t: Translate) {
  return z.object({
    csr: z.string().trim().min(1, t("certs.csr.required")),
    issuerId: z.string().min(1, t("certs.form.issuerRequired")),
    profile: z.enum(["server", "client", "server-client"]),
    sans: z.string(),
    validityDays: z.string().regex(/^\d+$/, t("certs.form.daysInvalid")),
    name: z.string().trim().max(128),
  })
}

type Values = z.infer<ReturnType<typeof schema>>

const FIELD_MAP: Record<string, string> = {
  "sans.dns": "sans",
  "sans.ip": "sans",
  "sans.email": "sans",
  "sans.uri": "sans",
  "subject.commonName": "sans",
}

/** Decodes the pasted CSR on the server for a preview. */
function useCsrPreview(text: string) {
  const [debounced, setDebounced] = React.useState(text)
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), 300)
    return () => clearTimeout(id)
  }, [text])
  return useQuery({
    queryKey: ["inspect", "csr", debounced],
    queryFn: async () => {
      const items = await api.inspect(debounced)
      const csr = items.find((i) => i.type === "csr")
      if (!csr?.csr) throw new Error(csr?.error || "no-csr")
      return csr.csr
    },
    enabled: debounced.includes("-----BEGIN"),
    retry: false,
    staleTime: Infinity,
  })
}

export function CsrDialog({
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
          <DialogTitle>{t("certs.csr.title")}</DialogTitle>
          <DialogDescription>{t("certs.csr.description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <CsrFormLoader
            issuerId={issuerId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CsrFormLoader(props: { issuerId?: string; onDone: () => void }) {
  const settings = useSettings()
  if (settings.isPending) return <FormSkeleton />
  return (
    <CsrForm
      {...props}
      defaultDays={settings.data?.pki.defaultValidityDays ?? 397}
    />
  )
}

function CsrPreview({ csr }: { csr: CSRDetails }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <InfoList
        rows={[
          {
            label: t("certs.details.subject"),
            value: csr.subjectDn || "–",
            mono: true,
          },
          {
            label: t("certs.details.keyAlgorithm"),
            value: keyAlgorithmLabel(csr.keyAlgorithm),
          },
          {
            label: t("certs.csr.signature"),
            value: csr.signatureValid ? (
              <span className="flex items-center gap-1 text-success">
                <CircleCheckIcon className="size-4" />
                {t("certs.csr.signatureValid")}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-destructive">
                <CircleAlertIcon className="size-4" />
                {t("certs.csr.signatureInvalid")}
              </span>
            ),
          },
          {
            label: t("certs.details.sans"),
            value: <SanList sans={csr.sans} />,
          },
        ]}
      />
    </div>
  )
}

function CsrForm({
  issuerId,
  onDone,
  defaultDays,
}: {
  issuerId?: string
  onDone: () => void
  defaultDays: number
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const resolver = React.useMemo(() => zodResolver(schema(t)), [t])
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      csr: "",
      issuerId: issuerId ?? "",
      profile: "server",
      sans: "",
      validityDays: String(defaultDays),
      name: "",
    },
  })
  const { errors, isSubmitting } = form.formState
  const csrText = useWatch({ control: form.control, name: "csr" })
  const preview = useCsrPreview(csrText)

  // Start the SAN list from the CSR, unless the user already edited it.
  const lastCsr = React.useRef<CSRDetails | undefined>(undefined)
  React.useEffect(() => {
    const csr = preview.data
    if (!csr || csr === lastCsr.current) return
    lastCsr.current = csr
    if (!form.getFieldState("sans").isDirty) {
      form.setValue("sans", formatSans(csr.sans))
    }
  }, [preview.data, form])

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const cert = await api.certificates.signCsr({
        csr: v.csr,
        issuerId: v.issuerId,
        profile: v.profile as LeafProfile,
        sans: parseSans(v.sans),
        validityDays: Number(v.validityDays),
        name: v.name,
      })
      await invalidateInventory(queryClient)
      toast.success(t("certs.csr.done", { name: cert.name }))
      onDone()
      navigate(`/certificates/${cert.id}`)
    } catch (error) {
      applyServerError(form, error, t, FIELD_MAP)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Controller
          control={form.control}
          name="csr"
          render={({ field }) => (
            <Field data-invalid={!!errors.csr || undefined}>
              <FieldLabel htmlFor="csr-pem">{t("certs.csr.pem")}</FieldLabel>
              <PemTextarea
                id="csr-pem"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.csr}
                placeholder="-----BEGIN CERTIFICATE REQUEST-----"
                accept=".csr,.req,.pem,.txt"
              />
              <FieldError errors={[errors.csr]} />
              {preview.isFetching && !preview.data && (
                <FieldDescription className="flex items-center gap-2">
                  <Spinner /> {t("certs.csr.decoding")}
                </FieldDescription>
              )}
              {preview.isError && (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertDescription>
                    {preview.error.message === "no-csr"
                      ? t("certs.csr.notCsr")
                      : errorMessage(preview.error, t)}
                  </AlertDescription>
                </Alert>
              )}
              {preview.data && <CsrPreview csr={preview.data} />}
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="issuerId"
          render={({ field }) => (
            <Field data-invalid={!!errors.issuerId || undefined}>
              <FieldLabel htmlFor="csr-issuer">
                {t("certs.form.issuer")}
              </FieldLabel>
              <IssuerSelect
                id="csr-issuer"
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
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="sans"
          render={({ field }) => (
            <Field data-invalid={!!errors.sans || undefined}>
              <FieldLabel htmlFor="csr-sans">{t("certs.form.sans")}</FieldLabel>
              <SanTextarea
                id="csr-sans"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={!!errors.sans}
              />
              {errors.sans ? (
                <FieldError errors={[errors.sans]} />
              ) : (
                <FieldDescription>{t("certs.csr.sansHint")}</FieldDescription>
              )}
            </Field>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="validityDays"
            render={({ field }) => (
              <Field
                data-invalid={!!errors.validityDays || undefined}
                className="sm:col-span-2"
              >
                <FieldLabel htmlFor="csr-days">
                  {t("certs.form.validity")}
                </FieldLabel>
                <ValidityInput
                  id="csr-days"
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!errors.validityDays}
                  presets={[90, 397, 825]}
                />
                <FieldError errors={[errors.validityDays]} />
              </Field>
            )}
          />
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="csr-name">
              {t("certs.form.displayName")}
            </FieldLabel>
            <Input
              id="csr-name"
              placeholder={t("certs.form.displayNamePlaceholder")}
              {...form.register("name")}
            />
          </Field>
        </div>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.actions.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting || preview.isError}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {isSubmitting ? t("certs.csr.submitting") : t("certs.csr.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}
