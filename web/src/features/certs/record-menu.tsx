import * as React from "react"
import { Link } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  DownloadIcon,
  EyeIcon,
  FilePlus2Icon,
  FileSignatureIcon,
  MoreHorizontalIcon,
  NetworkIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { CAFormDialog } from "@/features/certs/ca-form-dialog"
import { CsrDialog } from "@/features/certs/csr-dialog"
import { IssueDialog } from "@/features/certs/issue-dialog"
import { canIssue } from "@/features/certs/options"
import {
  Pkcs12Dialog,
  RenameDialog,
  RenewDialog,
  RevokeDialog,
} from "@/features/certs/record-dialogs"
import { useI18n, type MessageKey } from "@/i18n"
import { recordsApi } from "@/lib/api"
import { toastError } from "@/lib/errors"
import { invalidateInventory } from "@/lib/queries"
import type { CertRecord, ExportFormat } from "@/lib/types"

type DownloadItem = {
  format: ExportFormat | "p12"
  label: MessageKey
  hint: MessageKey
}

function downloadItems(r: CertRecord): DownloadItem[][] {
  const hasIssuer = !!r.issuerId
  const cert: DownloadItem[] = [
    {
      format: "cert",
      label: "certs.download.cert",
      hint: "certs.download.certHint",
    },
    ...(r.kind === "leaf" || hasIssuer
      ? [
          {
            format: "fullchain",
            label: "certs.download.fullchain",
            hint: "certs.download.fullchainHint",
          } as const,
        ]
      : []),
    ...(hasIssuer
      ? [
          {
            format: "chain",
            label: "certs.download.chain",
            hint: "certs.download.chainHint",
          } as const,
        ]
      : []),
    {
      format: "der",
      label: "certs.download.der",
      hint: "certs.download.derHint",
    },
  ]
  const key: DownloadItem[] = r.hasKey
    ? [
        {
          format: "key",
          label: "certs.download.key",
          hint: "certs.download.keyHint",
        },
        {
          format: "p12",
          label: "certs.download.p12",
          hint: "certs.download.p12Hint",
        },
      ]
    : []
  const bundle: DownloadItem[] = [
    {
      format: "zip",
      label: "certs.download.zip",
      hint: r.hasKey ? "certs.download.zipHint" : "certs.download.zipNoKeyHint",
    },
  ]
  const crl: DownloadItem[] =
    r.kind === "ca" && r.hasKey
      ? [
          {
            format: "crl",
            label: "certs.download.crl",
            hint: "certs.download.crlHint",
          },
          {
            format: "crl-pem",
            label: "certs.download.crlPem",
            hint: "certs.download.crlPemHint",
          },
        ]
      : []
  return [cert, key, bundle, crl].filter((g) => g.length > 0)
}

function useDownload(record: CertRecord, onPkcs12: () => void) {
  const { t } = useI18n()
  const [busy, setBusy] = React.useState(false)
  return {
    busy,
    download: async (format: DownloadItem["format"]) => {
      if (format === "p12") {
        onPkcs12()
        return
      }
      setBusy(true)
      try {
        const name = await recordsApi(record.kind).export(record.id, format)
        toast.success(t("certs.download.saved", { name }))
      } catch (error) {
        toastError(error, t)
      } finally {
        setBusy(false)
      }
    },
  }
}

function DownloadEntries({
  record,
  onSelect,
}: {
  record: CertRecord
  onSelect: (format: DownloadItem["format"]) => void
}) {
  const { t } = useI18n()
  return downloadItems(record).map((group, i) => (
    <React.Fragment key={i}>
      {i > 0 && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        {group.map((item) => (
          <DropdownMenuItem
            key={item.format}
            onSelect={() => onSelect(item.format)}
            className="flex-col items-start gap-0"
          >
            <span>{t(item.label)}</span>
            <span className="text-xs text-muted-foreground">
              {t(item.hint)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </React.Fragment>
  ))
}

/** Prominent download button with every export format. */
export function DownloadButton({ record }: { record: CertRecord }) {
  const { t } = useI18n()
  const [p12Open, setP12Open] = React.useState(false)
  const { busy, download } = useDownload(record, () => setP12Open(true))
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={busy}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            {t("certs.download.button")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DownloadEntries record={record} onSelect={(f) => void download(f)} />
        </DropdownMenuContent>
      </DropdownMenu>
      <Pkcs12Dialog record={record} open={p12Open} onOpenChange={setP12Open} />
    </>
  )
}

type DialogName =
  | "rename"
  | "revoke"
  | "renew"
  | "delete"
  | "p12"
  | "issue"
  | "csr"
  | "subca"
  | null

/**
 * The "more" menu of a record. In tables it also offers viewing and
 * downloads; on detail pages those have their own buttons.
 */
export function RecordMenu({
  record,
  inTable = false,
  onDeleted,
}: {
  record: CertRecord
  inTable?: boolean
  onDeleted?: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = React.useState<DialogName>(null)
  const close = (open: boolean) => !open && setDialog(null)
  const { download } = useDownload(record, () => setDialog("p12"))
  const isCA = record.kind === "ca"
  const issuing = isCA && canIssue(record)
  const base = isCA ? "/authorities" : "/certificates"

  const remove = async () => {
    try {
      await recordsApi(record.kind).remove(record.id)
    } catch (error) {
      toastError(error, t)
      throw error
    }
    toast.success(t("certs.delete.done", { name: record.name }))
    onDeleted?.()
    await invalidateInventory(queryClient)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={inTable ? "ghost" : "outline"}
            size="icon"
            aria-label={t("common.actions.more")}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {inTable && (
            <>
              <DropdownMenuLabel className="truncate">
                {record.name}
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link to={`${base}/${record.id}`}>
                    <EyeIcon />
                    {t("common.actions.view")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <DownloadIcon />
                    {t("certs.download.button")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    <DownloadEntries
                      record={record}
                      onSelect={(f) => void download(f)}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            {issuing && inTable && (
              <DropdownMenuItem onSelect={() => setDialog("issue")}>
                <FilePlus2Icon />
                {t("certs.issue.short")}
              </DropdownMenuItem>
            )}
            {issuing && (
              <DropdownMenuItem onSelect={() => setDialog("csr")}>
                <FileSignatureIcon />
                {t("certs.csr.short")}
              </DropdownMenuItem>
            )}
            {issuing && record.details.pathLen !== 0 && (
              <DropdownMenuItem onSelect={() => setDialog("subca")}>
                <NetworkIcon />
                {t("authorities.newSubCa")}
              </DropdownMenuItem>
            )}
            {!isCA && inTable && (
              <DropdownMenuItem onSelect={() => setDialog("renew")}>
                <RefreshCwIcon />
                {t("certs.renew.short")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setDialog("rename")}>
              <PencilIcon />
              {t("certs.rename.short")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {record.status !== "revoked" && !(isCA && !record.issuerId) && (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDialog("revoke")}
              >
                <BanIcon />
                {t("certs.revoke.short")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog("delete")}
            >
              <Trash2Icon />
              {t("common.actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        record={record}
        open={dialog === "rename"}
        onOpenChange={close}
      />
      <RevokeDialog
        record={record}
        open={dialog === "revoke"}
        onOpenChange={close}
      />
      <Pkcs12Dialog
        record={record}
        open={dialog === "p12"}
        onOpenChange={close}
      />
      {!isCA && (
        <RenewDialog
          record={record}
          open={dialog === "renew"}
          onOpenChange={close}
        />
      )}
      {issuing && (
        <>
          <IssueDialog
            open={dialog === "issue"}
            onOpenChange={close}
            issuerId={record.id}
          />
          <CsrDialog
            open={dialog === "csr"}
            onOpenChange={close}
            issuerId={record.id}
          />
          <CAFormDialog
            open={dialog === "subca"}
            onOpenChange={close}
            issuerId={record.id}
          />
        </>
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={t("certs.delete.title", { name: record.name })}
        description={
          isCA
            ? t("certs.delete.descriptionCa")
            : record.hasKey
              ? t("certs.delete.description")
              : t("certs.delete.descriptionNoKey")
        }
        confirmLabel={t("common.actions.delete")}
        onConfirm={remove}
      />
    </>
  )
}
