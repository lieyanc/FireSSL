import { defineMessages } from "@/i18n/define"

export const dashboard = defineMessages({
  en: {
    title: "Dashboard",
    description: "The state of your private PKI at a glance.",
    issuedBy: "{issuer} · {when}",
    stats: {
      authorities: "Certificate authorities",
      authoritiesHint: "Manage CAs",
      valid: "Valid certificates",
      validHint: "of {total} certificates",
      expiring: "Expiring soon",
      expiringHint: "Within {days} days",
      expired: "Expired or revoked",
      expiredHint: "{expired} expired · {revoked} revoked",
    },
    attention: {
      title: "Needs attention",
      description:
        "Certificates expiring within {days} days or expired recently.",
      empty: "Nothing is about to expire.",
    },
    recent: {
      title: "Recently issued",
      description: "The newest certificates.",
      all: "View all",
      empty: "No certificates issued yet.",
    },
    onboarding: {
      title: "Set up your certificate authority",
      description:
        "FireSSL issues TLS certificates trusted by the devices you control.",
      step1: "Create a root CA (or import an existing one).",
      step2: "Install the root CA as trusted on your devices.",
      step3: "Issue certificates for your servers and clients.",
    },
  },
  zh: {
    title: "概览",
    description: "私有 PKI 的整体状态。",
    issuedBy: "{issuer} · {when}",
    stats: {
      authorities: "证书颁发机构",
      authoritiesHint: "管理 CA",
      valid: "有效证书",
      validHint: "共 {total} 张证书",
      expiring: "即将过期",
      expiringHint: "{days} 天内",
      expired: "已过期或吊销",
      expiredHint: "已过期 {expired} · 已吊销 {revoked}",
    },
    attention: {
      title: "需要关注",
      description: "{days} 天内到期或近期已过期的证书。",
      empty: "近期没有即将过期的证书。",
    },
    recent: {
      title: "最近签发",
      description: "最新签发的证书。",
      all: "查看全部",
      empty: "还没有签发证书。",
    },
    onboarding: {
      title: "设置你的证书颁发机构",
      description: "FireSSL 为你掌控的设备签发受信任的 TLS 证书。",
      step1: "创建根 CA（或导入已有的 CA）。",
      step2: "在设备上将根 CA 安装为受信任证书。",
      step3: "为服务器和客户端签发证书。",
    },
  },
})
