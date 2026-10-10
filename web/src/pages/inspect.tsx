import * as React from "react"
import { Link } from "react-router"
import { useMutation } from "@tanstack/react-query"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FileBadgeIcon,
  FileSignatureIcon,
  KeyRoundIcon,
  ListXIcon,
  ScanSearchIcon,
} from "lucide-react"

import { InfoList } from "@/components/common/info-list"
import { PageContainer, PageHeader } from "@/components/common/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { CertDetails, SanList } from "@/features/certs/cert-details"
import { PemTextarea } from "@/features/certs/form-fields"
import { keyAlgorithmLabel } from "@/features/certs/options"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/errors"
import type { Inspected } from "@/lib/types"

const ICONS = {
  certificate: FileBadgeIcon,
  csr: FileSignatureIcon,
  privateKey: KeyRoundIcon,
  crl: ListXIcon,
  unknown: CircleAlertIcon,
}

function certStatus(item: Inspected) {
  const c = item.certificate
  if (!c) return undefined
  const now = Date.now()
  if (new Date(c.notAfter).getTime() < now) return "expired" as const
  if (new Date(c.notBefore).getTime() > now) return "not-yet-valid" as const
  return "valid" as const
}

function ItemCard({ item, index }: { item: Inspected; index: number }) {
  const { t, fmt } = useI18n()
  const Icon = ICONS[item.type]
  const title = item.certificate
    ? item.certificate.subject.commonName ||
      item.certificate.subjectDn ||
      t("inspect.types.certificate")
    : t(`inspect.types.${item.type}`)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>#{index + 1}</span>
          <Badge variant="outline" className="font-mono font-normal">
            {item.pemType}
          </Badge>
          {item.certificate?.isCa && <Badge variant="secondary">CA</Badge>}
          {item.certificate?.selfSigned && (
            <Badge variant="secondary">{t("inspect.selfSigned")}</Badge>
          )}
        </CardDescription>
        {item.knownId && (
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link
                to={`${item.knownKind === "ca" ? "/authorities" : "/certificates"}/${item.knownId}`}
              >
                {t("inspect.known")}
              </Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {item.error ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{item.error}</AlertDescription>
          </Alert>
        ) : item.certificate ? (
          <CertDetails details={item.certificate} status={certStatus(item)} />
        ) : item.csr ? (
          <InfoList
            rows={[
              {
                label: t("certs.details.subject"),
                value: item.csr.subjectDn || "–",
                mono: true,
              },
              {
                label: t("certs.details.keyAlgorithm"),
                value: keyAlgorithmLabel(item.csr.keyAlgorithm),
              },
              {
                label: t("certs.details.signatureAlgorithm"),
                value: item.csr.signatureAlgorithm,
              },
              {
                label: t("certs.csr.signature"),
                value: item.csr.signatureValid
                  ? t("certs.csr.signatureValid")
                  : t("certs.csr.signatureInvalid"),
              },
              {
                label: t("certs.details.sans"),
                value: <SanList sans={item.csr.sans} />,
              },
            ]}
          />
        ) : item.key ? (
          <InfoList
            rows={[
              {
                label: t("certs.details.keyAlgorithm"),
                value: keyAlgorithmLabel(item.key.keyAlgorithm),
              },
              {
                label: t("inspect.keyMatch"),
                value:
                  item.key.matchesCertificate >= 0 ? (
                    <span className="flex items-center gap-1 text-success">
                      <CircleCheckIcon className="size-4" />
                      {t("inspect.keyMatches", {
                        index: item.key.matchesCertificate + 1,
                      })}
                    </span>
                  ) : (
                    t("inspect.keyNoMatch")
                  ),
              },
            ]}
          />
        ) : item.crl ? (
          <InfoList
            rows={[
              {
                label: t("certs.details.issuer"),
                value: item.crl.issuerDn,
                mono: true,
              },
              { label: t("inspect.crl.number"), value: item.crl.number || "–" },
              {
                label: t("inspect.crl.thisUpdate"),
                value: fmt.dateTime(item.crl.thisUpdate),
              },
              {
                label: t("inspect.crl.nextUpdate"),
                value: item.crl.nextUpdate
                  ? fmt.dateTime(item.crl.nextUpdate)
                  : "–",
              },
              {
                label: t("inspect.crl.revoked"),
                value: String(item.crl.revokedCount),
              },
              ...(item.crl.revoked.length > 0
                ? [
                    {
                      label: t("inspect.crl.serials"),
                      value: (
                        <span className="flex flex-col gap-0.5 font-mono text-xs">
                          {item.crl.revoked.map((s) => (
                            <span key={s}>{s}</span>
                          ))}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("inspect.unsupported")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default function InspectPage() {
  const { t } = useI18n()
  const [text, setText] = React.useState("")
  const inspect = useMutation({ mutationFn: api.inspect })

  return (
    <PageContainer>
      <PageHeader
        title={t("inspect.title")}
        description={t("inspect.description")}
      />
      <Card>
        <CardContent className="flex flex-col gap-3">
          <PemTextarea
            value={text}
            onChange={setText}
            placeholder={t("inspect.placeholder")}
            className="h-48"
          />
          <div className="flex justify-end">
            <Button
              disabled={!text.trim() || inspect.isPending}
              onClick={() => inspect.mutate(text)}
            >
              {inspect.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ScanSearchIcon data-icon="inline-start" />
              )}
              {t("inspect.submit")}
            </Button>
          </div>
        </CardContent>
      </Card>
      {inspect.isError && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{errorMessage(inspect.error, t)}</AlertDescription>
        </Alert>
      )}
      {inspect.data ? (
        <div className="flex flex-col gap-4">
          {inspect.data.map((item, i) => (
            <ItemCard key={i} item={item} index={i} />
          ))}
        </div>
      ) : (
        !inspect.isError && (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScanSearchIcon />
              </EmptyMedia>
              <EmptyTitle>{t("inspect.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("inspect.emptyHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      )}
    </PageContainer>
  )
}
