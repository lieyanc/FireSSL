import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/i18n"
import type { CertStatus } from "@/lib/types"

const VARIANTS: Record<
  CertStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  valid: "success",
  expiring: "warning",
  expired: "destructive",
  revoked: "destructive",
  "not-yet-valid": "secondary",
}

export function StatusBadge({ status }: { status: CertStatus }) {
  const { t } = useI18n()
  return (
    <Badge variant={VARIANTS[status]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t(`common.status.${status}`)}
    </Badge>
  )
}
