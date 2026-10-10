import * as React from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { RotateCwIcon } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { InfoList } from "@/components/common/info-list"
import { QueryError } from "@/components/common/query-state"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { KeyAlgorithmSelect } from "@/features/certs/form-fields"
import { useSaveSection } from "@/features/settings/save-section"
import { useI18n, type Translate } from "@/i18n"
import { api } from "@/lib/api"
import { toastError } from "@/lib/errors"
import { useSettings } from "@/lib/queries"
import type { KeyAlgorithm, Settings } from "@/lib/types"

const digits = (t: Translate, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, t("settings.validation.number"))
    .refine(
      (v) => Number(v) >= min && Number(v) <= max,
      t("settings.validation.range", { min, max })
    )

function pkiSchema(t: Translate) {
  return z.object({
    publicUrl: z
      .string()
      .trim()
      .regex(/^(https?:\/\/[^\s?#]+)?$/i, t("settings.pki.publicUrlInvalid")),
    defaultKeyAlgorithm: z.string(),
    defaultValidityDays: digits(t, 1, 36500),
    expiryWarningDays: digits(t, 1, 365),
  })
}

function PkiCard({ value }: { value: Settings["pki"] }) {
  const { t } = useI18n()
  const save = useSaveSection()
  const resolver = React.useMemo(() => zodResolver(pkiSchema(t)), [t])
  const values = React.useMemo(
    () => ({
      publicUrl: value.publicUrl,
      defaultKeyAlgorithm: value.defaultKeyAlgorithm,
      defaultValidityDays: String(value.defaultValidityDays),
      expiryWarningDays: String(value.expiryWarningDays),
    }),
    [value]
  )
  const form = useForm<z.infer<ReturnType<typeof pkiSchema>>>({
    resolver,
    values,
    resetOptions: { keepDirtyValues: true },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    const ok = await save(
      {
        pki: {
          publicUrl: v.publicUrl,
          defaultKeyAlgorithm: v.defaultKeyAlgorithm as KeyAlgorithm,
          defaultValidityDays: Number(v.defaultValidityDays),
          expiryWarningDays: Number(v.expiryWarningDays),
        },
      },
      form,
      "pki"
    )
    if (ok) form.reset(v)
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.pki.title")}</CardTitle>
        <CardDescription>{t("settings.pki.description")}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <CardContent>
          <FieldGroup>
            <Field data-invalid={!!errors.publicUrl || undefined}>
              <FieldLabel htmlFor="pki-url">
                {t("settings.pki.publicUrl")}
              </FieldLabel>
              <Input
                id="pki-url"
                type="url"
                className="font-mono"
                spellCheck={false}
                placeholder="https://pki.example.com"
                aria-invalid={!!errors.publicUrl}
                {...form.register("publicUrl")}
              />
              {errors.publicUrl ? (
                <FieldError errors={[errors.publicUrl]} />
              ) : (
                <FieldDescription>
                  {t("settings.pki.publicUrlHint")}
                </FieldDescription>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Controller
                control={form.control}
                name="defaultKeyAlgorithm"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="pki-alg">
                      {t("settings.pki.defaultKeyAlgorithm")}
                    </FieldLabel>
                    <KeyAlgorithmSelect
                      id="pki-alg"
                      value={field.value as KeyAlgorithm}
                      onChange={field.onChange}
                    />
                  </Field>
                )}
              />
              <Field data-invalid={!!errors.defaultValidityDays || undefined}>
                <FieldLabel htmlFor="pki-days">
                  {t("settings.pki.defaultValidityDays")}
                </FieldLabel>
                <Input
                  id="pki-days"
                  inputMode="numeric"
                  aria-invalid={!!errors.defaultValidityDays}
                  {...form.register("defaultValidityDays")}
                />
                <FieldError errors={[errors.defaultValidityDays]} />
              </Field>
              <Field data-invalid={!!errors.expiryWarningDays || undefined}>
                <FieldLabel htmlFor="pki-warn">
                  {t("settings.pki.expiryWarningDays")}
                </FieldLabel>
                <Input
                  id="pki-warn"
                  inputMode="numeric"
                  aria-invalid={!!errors.expiryWarningDays}
                  {...form.register("expiryWarningDays")}
                />
                <FieldError errors={[errors.expiryWarningDays]} />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isSubmitting
              ? t("common.actions.saving")
              : t("common.actions.save")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function serverSchema(t: Translate) {
  return z.object({
    host: z.string().trim().min(1, t("settings.validation.required")),
    port: digits(t, 1, 65535),
    level: z.enum(["debug", "info", "warn", "error"]),
  })
}

function ServerCard({ value }: { value: Settings }) {
  const { t } = useI18n()
  const save = useSaveSection()
  const resolver = React.useMemo(() => zodResolver(serverSchema(t)), [t])
  const values = React.useMemo(
    () => ({
      host: value.server.host,
      port: String(value.server.port),
      level: value.logging.level,
    }),
    [value]
  )
  const form = useForm<z.infer<ReturnType<typeof serverSchema>>>({
    resolver,
    values,
    resetOptions: { keepDirtyValues: true },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    const ok = await save(
      {
        server: { host: v.host, port: Number(v.port) },
        logging: { level: v.level },
      },
      form,
      "server",
      { "logging.level": "level" }
    )
    if (ok) form.reset(v)
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.server.title")}</CardTitle>
        <CardDescription>{t("settings.server.description")}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <CardContent className="flex flex-col gap-6">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field data-invalid={!!errors.host || undefined}>
                <FieldLabel htmlFor="server-host">
                  {t("settings.server.host")}
                </FieldLabel>
                <Input
                  id="server-host"
                  className="font-mono"
                  aria-invalid={!!errors.host}
                  {...form.register("host")}
                />
                <FieldError errors={[errors.host]} />
              </Field>
              <Field data-invalid={!!errors.port || undefined}>
                <FieldLabel htmlFor="server-port">
                  {t("settings.server.port")}
                </FieldLabel>
                <Input
                  id="server-port"
                  inputMode="numeric"
                  aria-invalid={!!errors.port}
                  {...form.register("port")}
                />
                <FieldError errors={[errors.port]} />
              </Field>
              <Controller
                control={form.control}
                name="level"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="server-level">
                      {t("settings.server.logLevel")}
                    </FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="server-level" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(["debug", "info", "warn", "error"] as const).map(
                            (l) => (
                              <SelectItem key={l} value={l}>
                                {l}
                              </SelectItem>
                            )
                          )}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
            </div>
            <FieldDescription>{t("settings.server.hostHint")}</FieldDescription>
          </FieldGroup>
          <InfoList
            rows={[
              {
                label: t("settings.server.configPath"),
                value: value.configPath,
                mono: true,
              },
              {
                label: t("settings.server.dataDir"),
                value: value.dataDir,
                mono: true,
              },
            ]}
          />
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isSubmitting
              ? t("common.actions.saving")
              : t("common.actions.save")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

/** Polls until the server answers again after a restart. */
async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  await new Promise((r) => setTimeout(r, 1000))
  while (Date.now() < deadline) {
    try {
      await api.version()
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return false
}

function RestartBanner({ settings }: { settings: Settings }) {
  const { t } = useI18n()
  const [confirming, setConfirming] = React.useState(false)
  const [restarting, setRestarting] = React.useState(false)
  if (!settings.restartRequired && !restarting) return null

  const restart = async () => {
    try {
      await api.settings.restart()
    } catch (error) {
      toastError(error, t)
      throw error
    }
    setRestarting(true)
    if (await waitForServer()) {
      // The listen address may have changed; let the user follow it.
      window.location.reload()
    } else {
      setRestarting(false)
      toast.error(t("settings.restart.timeout"))
    }
  }

  if (restarting) {
    return (
      <Alert>
        <Spinner />
        <AlertTitle>{t("settings.restart.restarting")}</AlertTitle>
        <AlertDescription>
          {t("settings.restart.restartingHint")}
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <>
      <Alert>
        <RotateCwIcon />
        <AlertTitle>{t("settings.restart.title")}</AlertTitle>
        <AlertDescription>{t("settings.restart.description")}</AlertDescription>
        {settings.canRestart && (
          <AlertAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirming(true)}
            >
              {t("settings.restart.button")}
            </Button>
          </AlertAction>
        )}
      </Alert>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("settings.restart.confirmTitle")}
        description={t("settings.restart.confirmDescription")}
        confirmLabel={t("settings.restart.button")}
        destructive={false}
        onConfirm={restart}
      />
    </>
  )
}

export function GeneralTab() {
  const settings = useSettings()
  if (settings.isPending) return <Skeleton className="h-96" />
  if (settings.isError)
    return (
      <QueryError
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
    )
  return (
    <div className="flex flex-col gap-4">
      <RestartBanner settings={settings.data} />
      <PkiCard value={settings.data.pki} />
      <ServerCard value={settings.data} />
    </div>
  )
}
