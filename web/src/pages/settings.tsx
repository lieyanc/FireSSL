import { useNavigate, useParams } from "react-router"
import {
  DownloadIcon,
  SlidersHorizontalIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react"

import { PageContainer, PageHeader } from "@/components/common/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AccountTab } from "@/features/settings/account-tab"
import { GeneralTab } from "@/features/settings/general-tab"
import { UpdateTab } from "@/features/settings/update-tab"
import { useI18n } from "@/i18n"
import { useWorkspace } from "@/lib/workspace"

type Tab = "general" | "account" | "update"

const ALL_TABS: {
  value: Tab
  icon: LucideIcon
  Content: () => React.ReactNode
  adminOnly?: boolean
}[] = [
  {
    value: "general",
    icon: SlidersHorizontalIcon,
    Content: GeneralTab,
    adminOnly: true,
  },
  { value: "account", icon: UserIcon, Content: AccountTab },
  { value: "update", icon: DownloadIcon, Content: UpdateTab, adminOnly: true },
]

export default function SettingsPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const params = useParams()
  const { admin } = useWorkspace()
  const TABS = ALL_TABS.filter((def) => admin || !def.adminOnly)
  const tab: Tab =
    TABS.find((def) => def.value === params.tab)?.value ?? TABS[0].value

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          navigate(`/settings/${value}`, { replace: true })
        }
        className="gap-4"
      >
        <div className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          <TabsList>
            {TABS.map(({ value, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="px-2.5">
                <Icon data-icon="inline-start" />
                {t(`settings.tabs.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {TABS.map(({ value, Content }) => (
          <TabsContent key={value} value={value}>
            <Content />
          </TabsContent>
        ))}
      </Tabs>
    </PageContainer>
  )
}
