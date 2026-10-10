import { CopyButton } from "@/components/common/copy-button"
import { InfoList } from "@/components/common/info-list"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  keyAlgorithmLabel,
  lifetimeElapsed,
  sanCount,
} from "@/features/certs/options"
import { useI18n } from "@/i18n"
import { daysUntil } from "@/lib/format"
import type { CertStatus, Details, SANs } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Elapsed share of the validity period, colored by status. */
export function ValidityBar({
  details,
  status,
  className,
}: {
  details: Details
  status?: CertStatus
  className?: string
}) {
  const { t } = useI18n()
  const elapsed = lifetimeElapsed(details.notBefore, details.notAfter)
  const days = daysUntil(details.notAfter)
  const tone =
    status === "revoked" || status === "expired" || days < 0
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : status === "expiring"
        ? "[&_[data-slot=progress-indicator]]:bg-warning"
        : ""
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Progress
        value={Math.round(elapsed * 100)}
        className={cn("h-1.5", tone)}
        aria-label={t("certs.details.lifetime")}
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {days < 0
          ? t("certs.details.expiredAgo", { days: -days })
          : t("certs.details.daysLeft", { days })}
      </span>
    </div>
  )
}

export function SanList({
  sans,
  empty,
}: {
  sans: SANs
  empty?: React.ReactNode
}) {
  const { t } = useI18n()
  if (sanCount(sans) === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {empty ?? t("common.states.none")}
      </p>
    )
  }
  const groups: [keyof SANs, string][] = [
    ["dns", "DNS"],
    ["ip", "IP"],
    ["email", t("certs.sans.email")],
    ["uri", "URI"],
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.flatMap(([kind, label]) =>
        sans[kind].map((value) => (
          <Badge
            key={kind + value}
            variant="outline"
            className="h-auto max-w-full py-0.5 font-mono font-normal"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="truncate">{value}</span>
          </Badge>
        ))
      )}
    </div>
  )
}

function Mono({ children }: { children: string }) {
  return <span className="font-mono text-xs break-all">{children}</span>
}

function Fingerprint({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <CopyButton value={value} variant="ghost" size="icon-xs" />
      </div>
      <Mono>{value}</Mono>
    </div>
  )
}

function UsageBadges({ items }: { items: string[] }) {
  const { t } = useI18n()
  if (items.length === 0) return <>{t("common.states.none")}</>
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((u) => (
        <Badge key={u} variant="secondary" className="font-normal">
          {u}
        </Badge>
      ))}
    </span>
  )
}

/** Every decoded field of a certificate, as a grid of cards. */
export function CertDetails({
  details,
  status,
}: {
  details: Details
  status?: CertStatus
}) {
  const { t, fmt } = useI18n()
  const s = details.subject
  const pathLen =
    details.pathLen === undefined
      ? t("common.states.unlimited")
      : String(details.pathLen)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("certs.details.subject")}</CardTitle>
          <CardDescription className="font-mono text-xs break-all">
            {details.subjectDn || "–"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InfoList
            rows={[
              {
                label: t("certs.subject.commonName"),
                value: s.commonName || "–",
              },
              {
                label: t("certs.subject.organization"),
                value: s.organization || "–",
              },
              ...(s.organizationalUnit
                ? [
                    {
                      label: t("certs.subject.organizationalUnit"),
                      value: s.organizationalUnit,
                    },
                  ]
                : []),
              ...(s.locality
                ? [{ label: t("certs.subject.locality"), value: s.locality }]
                : []),
              ...(s.province
                ? [{ label: t("certs.subject.province"), value: s.province }]
                : []),
              { label: t("certs.subject.country"), value: s.country || "–" },
              {
                label: t("certs.details.issuer"),
                value: <Mono>{details.issuerDn}</Mono>,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("certs.details.validity")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <InfoList
            rows={[
              {
                label: t("certs.details.notBefore"),
                value: fmt.dateTime(details.notBefore),
              },
              {
                label: t("certs.details.notAfter"),
                value: fmt.dateTime(details.notAfter),
              },
            ]}
          />
          <ValidityBar details={details} status={status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("certs.details.sans")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SanList sans={details.sans} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("certs.details.keyAndUsage")}</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoList
            rows={[
              {
                label: t("certs.details.keyAlgorithm"),
                value: keyAlgorithmLabel(details.keyAlgorithm),
              },
              {
                label: t("certs.details.signatureAlgorithm"),
                value: details.signatureAlgorithm,
              },
              {
                label: t("certs.details.keyUsage"),
                value: <UsageBadges items={details.keyUsage} />,
              },
              {
                label: t("certs.details.extKeyUsage"),
                value: <UsageBadges items={details.extKeyUsage} />,
              },
              ...(details.isCa
                ? [{ label: t("certs.details.pathLen"), value: pathLen }]
                : []),
            ]}
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("certs.details.identifiers")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Fingerprint
            label={t("certs.details.serialNumber")}
            value={details.serialNumber}
          />
          <Fingerprint label="SHA-256" value={details.fingerprintSha256} />
          <Fingerprint label="SHA-1" value={details.fingerprintSha1} />
          {details.subjectKeyId && (
            <Fingerprint
              label={t("certs.details.subjectKeyId")}
              value={details.subjectKeyId}
            />
          )}
          {details.authorityKeyId && (
            <Fingerprint
              label={t("certs.details.authorityKeyId")}
              value={details.authorityKeyId}
            />
          )}
          {details.crlDistributionPoints.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                {t("certs.details.crlUrls")}
              </span>
              {details.crlDistributionPoints.map((u) => (
                <Mono key={u}>{u}</Mono>
              ))}
            </div>
          )}
          {details.issuingCertificateUrl.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                {t("certs.details.issuerUrls")}
              </span>
              {details.issuingCertificateUrl.map((u) => (
                <Mono key={u}>{u}</Mono>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** A PEM document with a copy button. */
export function PemBlock({
  pem,
  className,
}: {
  pem: string
  className?: string
}) {
  const { t } = useI18n()
  return (
    <div className={cn("relative", className)}>
      <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">
        {pem.trim()}
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton
          value={pem}
          size="sm"
          variant="outline"
          label={t("common.actions.copy")}
        />
      </div>
    </div>
  )
}
