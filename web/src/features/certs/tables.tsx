import { Link } from "react-router"
import { LockKeyholeOpenIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { keyAlgorithmLabel } from "@/features/certs/options"
import { RecordMenu } from "@/features/certs/record-menu"
import { StatusBadge } from "@/features/certs/status-badge"
import { useI18n } from "@/i18n"
import { daysUntil } from "@/lib/format"
import type { CertRecord } from "@/lib/types"
import { cn } from "@/lib/utils"

export function Expiry({ record }: { record: CertRecord }) {
  const { t, fmt } = useI18n()
  const days = daysUntil(record.details.notAfter)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "tabular-nums",
            record.status === "expiring" && "text-warning",
            record.status === "expired" && "text-destructive"
          )}
        >
          {fmt.date(record.details.notAfter)}
          <span className="block text-xs text-muted-foreground">
            {days < 0
              ? t("certs.details.expiredAgo", { days: -days })
              : t("certs.details.daysLeft", { days })}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{fmt.dateTime(record.details.notAfter)}</TooltipContent>
    </Tooltip>
  )
}

function sanSummary(r: CertRecord) {
  const all = [
    ...r.details.sans.dns,
    ...r.details.sans.ip,
    ...r.details.sans.email,
    ...r.details.sans.uri,
  ]
  const shown = all.filter((v) => v !== r.name)
  return {
    first: shown.slice(0, 2).join(", "),
    more: Math.max(0, shown.length - 2),
  }
}

export function CertificatesTable({
  items,
  showIssuer = true,
}: {
  items: CertRecord[]
  showIssuer?: boolean
}) {
  const { t } = useI18n()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">{t("certs.columns.name")}</TableHead>
          {showIssuer && (
            <TableHead className="hidden md:table-cell">
              {t("certs.columns.issuer")}
            </TableHead>
          )}
          <TableHead className="hidden lg:table-cell">
            {t("certs.columns.profile")}
          </TableHead>
          <TableHead>{t("certs.columns.status")}</TableHead>
          <TableHead className="hidden sm:table-cell">
            {t("certs.columns.expires")}
          </TableHead>
          <TableHead className="w-12 pr-4" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => {
          const sans = sanSummary(r)
          return (
            <TableRow key={r.id}>
              <TableCell className="max-w-72 pl-4">
                <Link
                  to={`/certificates/${r.id}`}
                  className="block truncate font-medium hover:underline"
                >
                  {r.name}
                </Link>
                <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {!r.hasKey && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <LockKeyholeOpenIcon
                          className="size-3 shrink-0"
                          aria-label={t("certs.noKey")}
                        />
                      </TooltipTrigger>
                      <TooltipContent>{t("certs.noKeyHint")}</TooltipContent>
                    </Tooltip>
                  )}
                  <span className="truncate font-mono">
                    {sans.first || r.details.subject.commonName || "–"}
                    {sans.more > 0 && ` +${sans.more}`}
                  </span>
                </span>
              </TableCell>
              {showIssuer && (
                <TableCell className="hidden max-w-48 md:table-cell">
                  {r.issuerId ? (
                    <Link
                      to={`/authorities/${r.issuerId}`}
                      className="block truncate hover:underline"
                    >
                      {r.issuerName}
                    </Link>
                  ) : (
                    "–"
                  )}
                </TableCell>
              )}
              <TableCell className="hidden lg:table-cell">
                <div className="flex flex-col items-start gap-1">
                  <Badge variant="outline">
                    {t(`common.profile.${r.profile}`)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {keyAlgorithmLabel(r.details.keyAlgorithm)}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Expiry record={r} />
              </TableCell>
              <TableCell className="pr-4 text-right">
                <RecordMenu record={r} inTable />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** CAs in hierarchy order, indented by depth. */
export function AuthoritiesTable({ items }: { items: CertRecord[] }) {
  const { t } = useI18n()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">{t("certs.columns.name")}</TableHead>
          <TableHead className="hidden md:table-cell">
            {t("certs.columns.type")}
          </TableHead>
          <TableHead className="hidden lg:table-cell">
            {t("authorities.columns.issued")}
          </TableHead>
          <TableHead>{t("certs.columns.status")}</TableHead>
          <TableHead className="hidden sm:table-cell">
            {t("certs.columns.expires")}
          </TableHead>
          <TableHead className="w-12 pr-4" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="max-w-80 pl-4">
              <div
                className="flex min-w-0 items-center"
                style={{ paddingLeft: `${r.depth * 1.25}rem` }}
              >
                {r.depth > 0 && (
                  <span className="mr-2 h-4 w-3 shrink-0 self-start rounded-bl border-b border-l border-muted-foreground/40" />
                )}
                <div className="min-w-0">
                  <Link
                    to={`/authorities/${r.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {keyAlgorithmLabel(r.details.keyAlgorithm)}
                    {!r.hasKey && ` · ${t("authorities.anchorOnly")}`}
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">
                  {t(`common.profile.${r.profile}`)}
                </Badge>
                {r.source === "imported" && (
                  <Badge variant="secondary">
                    {t("common.source.imported")}
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="hidden tabular-nums lg:table-cell">
              {t("authorities.columns.issuedValue", {
                certs: r.issuedCount,
                cas: r.childCount,
              })}
            </TableCell>
            <TableCell>
              <StatusBadge status={r.status} />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <Expiry record={r} />
            </TableCell>
            <TableCell className="pr-4 text-right">
              <RecordMenu record={r} inTable />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
