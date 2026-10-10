import { InfoIcon } from "lucide-react"

import { CopyButton } from "@/components/common/copy-button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n, type MessageKey } from "@/i18n"
import type { CertRecord } from "@/lib/types"

/** Mirrors the server's download file name for a record. */
function fileStem(name: string, id: string) {
  const stem = name
    .replaceAll("*", "wildcard")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
  return stem && /[^_]/.test(stem) ? stem.slice(0, 80) : id
}

type Platform = {
  id: string
  label: MessageKey
  hint?: MessageKey
  script: (file: string) => string
}

const PLATFORMS: Platform[] = [
  {
    id: "debian",
    label: "authorities.trust.debian",
    script: (f) =>
      `sudo cp ${f} /usr/local/share/ca-certificates/${f}\nsudo update-ca-certificates`,
  },
  {
    id: "rhel",
    label: "authorities.trust.rhel",
    script: (f) =>
      `sudo cp ${f} /etc/pki/ca-trust/source/anchors/\nsudo update-ca-trust`,
  },
  {
    id: "macos",
    label: "authorities.trust.macos",
    script: (f) =>
      `sudo security add-trusted-cert -d -r trustRoot \\\n  -k /Library/Keychains/System.keychain ${f}`,
  },
  {
    id: "windows",
    label: "authorities.trust.windows",
    hint: "authorities.trust.windowsHint",
    script: (f) =>
      `Import-Certificate -FilePath .\\${f} -CertStoreLocation Cert:\\LocalMachine\\Root`,
  },
  {
    id: "firefox",
    label: "authorities.trust.firefox",
    hint: "authorities.trust.firefoxHint",
    script: () => `security.enterprise_roots.enabled = true`,
  },
]

export function TrustGuide({ record }: { record: CertRecord }) {
  const { t } = useI18n()
  if (!record.details.selfSigned) {
    return (
      <Alert>
        <InfoIcon />
        <AlertDescription>
          {t("authorities.trust.intermediate")}
        </AlertDescription>
      </Alert>
    )
  }
  const file = `${fileStem(record.name, record.id)}.crt`
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t("authorities.trust.intro", { file })}
      </p>
      <Tabs defaultValue="debian" className="gap-3">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            {PLATFORMS.map((p) => (
              <TabsTrigger key={p.id} value={p.id}>
                {t(p.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {PLATFORMS.map((p) => {
          const script = p.script(file)
          return (
            <TabsContent
              key={p.id}
              value={p.id}
              className="flex flex-col gap-2"
            >
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 pr-12 font-mono text-xs leading-relaxed">
                  {script}
                </pre>
                <div className="absolute top-2 right-2">
                  <CopyButton value={script} variant="ghost" size="icon-sm" />
                </div>
              </div>
              {p.hint && (
                <p className="text-sm text-muted-foreground">{t(p.hint)}</p>
              )}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
