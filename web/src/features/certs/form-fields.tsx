import * as React from "react"
import { UploadIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  canIssue,
  KEY_ALGORITHMS,
  keyAlgorithmLabel,
  LEAF_PROFILES,
  parseSans,
  sanKind,
  VALIDITY_PRESETS,
} from "@/features/certs/options"
import { useI18n } from "@/i18n"
import { readTextFile } from "@/lib/form"
import { useAuthorities } from "@/lib/queries"
import type { KeyAlgorithm, LeafProfile } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Picks a CA able to sign, indented by hierarchy depth. */
export function IssuerSelect({
  value,
  onChange,
  invalid,
  id,
  exclude,
}: {
  value: string
  onChange: (id: string) => void
  invalid?: boolean
  id?: string
  /** Hides CAs whose path length forbids sub-CAs (when creating one). */
  exclude?: "no-sub-ca"
}) {
  const { t } = useI18n()
  const authorities = useAuthorities()
  const items = (authorities.data ?? []).filter(
    (ca) =>
      canIssue(ca) &&
      !ca.readOnly &&
      !(exclude === "no-sub-ca" && ca.details.pathLen === 0)
  )
  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={authorities.isPending}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue
          placeholder={
            authorities.isPending
              ? t("common.states.loading")
              : items.length === 0
                ? t("certs.form.noIssuers")
                : t("certs.form.issuerPlaceholder")
          }
        />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((ca) => (
            <SelectItem key={ca.id} value={ca.id}>
              <span
                style={{ paddingLeft: `${ca.depth * 0.75}rem` }}
                className="truncate"
              >
                {ca.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {keyAlgorithmLabel(ca.details.keyAlgorithm)}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function KeyAlgorithmSelect({
  value,
  onChange,
  id,
}: {
  value: KeyAlgorithm
  onChange: (alg: KeyAlgorithm) => void
  id?: string
}) {
  const { t } = useI18n()
  return (
    <Select value={value} onValueChange={(v) => onChange(v as KeyAlgorithm)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {KEY_ALGORITHMS.map((alg) => (
            <SelectItem key={alg} value={alg}>
              {keyAlgorithmLabel(alg)}
              <span className="text-xs text-muted-foreground">
                {t(`certs.keyHints.${alg}`)}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function ProfileToggle({
  value,
  onChange,
}: {
  value: LeafProfile
  onChange: (p: LeafProfile) => void
}) {
  const { t } = useI18n()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v as LeafProfile)}
      aria-label={t("certs.form.profile")}
      className="w-full"
    >
      {LEAF_PROFILES.map((p) => (
        <ToggleGroupItem key={p} value={p} className="flex-1">
          {t(`common.profile.${p}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Days input with quick presets. */
export function ValidityInput({
  id,
  invalid,
  value,
  onChange,
  presets = VALIDITY_PRESETS.map((p) => p.days),
}: {
  id?: string
  invalid?: boolean
  value: string
  onChange: (value: string) => void
  presets?: number[]
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-32">
        <Input
          id={id}
          inputMode="numeric"
          aria-invalid={invalid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10 tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          {t("common.units.days")}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map((days) => {
          const preset = VALIDITY_PRESETS.find((p) => p.days === days)
          return (
            <Button
              key={days}
              type="button"
              size="xs"
              variant={value === String(days) ? "secondary" : "ghost"}
              onClick={() => onChange(String(days))}
            >
              {preset?.label ?? `${days}d`}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

const SAN_LABELS = { dns: "DNS", ip: "IP", email: "Email", uri: "URI" }

/** Free-text SAN entry with a live preview of how each name is classified. */
export function SanTextarea({
  id,
  invalid,
  ...props
}: React.ComponentProps<typeof Textarea> & {
  invalid?: boolean
  value: string
}) {
  const { t } = useI18n()
  const entries = React.useMemo(() => {
    const sans = parseSans(props.value)
    return [...sans.dns, ...sans.ip, ...sans.email, ...sans.uri]
  }, [props.value])
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        id={id}
        rows={3}
        spellCheck={false}
        autoCapitalize="off"
        aria-invalid={invalid}
        placeholder={t("certs.form.sansPlaceholder")}
        className="min-h-20 font-mono text-sm"
        {...props}
      />
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entries.map((v) => (
            <Badge
              key={v}
              variant="secondary"
              className="font-mono font-normal"
            >
              <span className="text-muted-foreground">
                {SAN_LABELS[sanKind(v)]}
              </span>
              {v}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

/** Textarea for PEM data with a "load file" button. */
export function PemTextarea({
  id,
  invalid,
  value,
  onChange,
  placeholder,
  accept = ".pem,.crt,.cer,.key,.csr,.req,.txt",
  className,
}: {
  id?: string
  invalid?: boolean
  value: string
  onChange: (value: string) => void
  placeholder?: string
  accept?: string
  className?: string
}) {
  const { t } = useI18n()
  const fileRef = React.useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        id={id}
        spellCheck={false}
        autoCapitalize="off"
        aria-invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "-----BEGIN ..."}
        className={cn(
          "field-sizing-fixed h-32 resize-y font-mono text-xs",
          className
        )}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          <UploadIcon data-icon="inline-start" />
          {t("common.actions.loadFile")}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) onChange(await readTextFile(file))
          }}
        />
      </div>
    </div>
  )
}
