import { defineMessages } from "@/i18n/define"

export const authorities = defineMessages({
  en: {
    title: "Certificate authorities",
    description:
      "Root and intermediate CAs. Each CA signs certificates and publishes its own revocation list.",
    empty: "No certificate authorities",
    emptyHint:
      "Create a root CA to start issuing certificates, or import one you already have.",
    newCa: "New CA",
    newRoot: "Create root CA",
    newSubCa: "New sub-CA",
    anchorOnly: "no key",
    columns: {
      issued: "Issued",
      issuedValue: "{certs} certs · {cas} CAs",
    },
    form: {
      title: "Create a certificate authority",
      subTitle: "Create a sub-CA",
      description:
        "Generates a CA key pair and certificate. Keep root CAs offline-minded: use them to sign intermediates.",
      type: "Type",
      typeHints: {
        root: "Self-signed. Install it as trusted on your devices.",
        intermediate:
          "Signed by another CA. Issue day-to-day certificates from it so the root key is rarely used.",
      },
      parent: "Parent CA",
      pathLen: "Path length",
      pathLenZero: "0 — no further sub-CAs",
      clampHint: "Validity is capped at the parent CA's expiry.",
      submit: "Create",
      submitting: "Creating…",
      created: "Created {name}",
    },
    import: {
      short: "Import CA",
      title: "Import a certificate authority",
      description:
        "Add an existing CA certificate. With its private key it can issue certificates here; without it, it anchors chains only.",
      cert: "CA certificate",
      certRequired: "Paste the CA certificate",
      key: "Private key (optional)",
      keyHint:
        "Unencrypted PEM (PKCS#8, PKCS#1 or SEC 1). It is stored encrypted.",
      submit: "Import",
      done: "Imported {name}",
    },
    detail: {
      summary: "{certs} certificates and {cas} sub-CAs issued",
      tabs: {
        issued: "Issued",
        trust: "Trust & distribution",
      },
      subCas: "Sub-CAs",
      certificates: "Certificates",
      noCertificates: "Nothing issued yet",
      noCertificatesHint: "Certificates signed by this CA will be listed here.",
      distribution: "Public endpoints",
      distributionHint:
        "Embedded in certificates issued from now on. Served without authentication.",
      distributionNoUrl:
        "Served without authentication. Set a public URL in Settings to embed them in newly issued certificates.",
      crlUrl: "Revocation list",
      caUrl: "CA certificate",
    },
    trust: {
      title: "Trust this root CA",
      intro:
        "Download the certificate ({file}), then install it on each device that should trust certificates from this CA.",
      intermediate:
        "Intermediate CAs are not installed as trusted. Install the root CA instead, and serve this CA in the full chain of your servers.",
      debian: "Debian / Ubuntu",
      rhel: "RHEL / Fedora",
      macos: "macOS",
      windows: "Windows",
      windowsHint:
        "Run in an elevated PowerShell. Or double-click the file and import it into “Trusted Root Certification Authorities”.",
      firefox: "Firefox",
      firefoxHint:
        "Firefox keeps its own store. Set this in about:config to trust the system's roots, or import the file under Settings → Certificates.",
    },
  },
  zh: {
    title: "证书颁发机构",
    description: "根 CA 与中间 CA。每个 CA 负责签发证书并发布自己的吊销列表。",
    empty: "还没有证书颁发机构",
    emptyHint: "创建根 CA 以开始签发证书，或导入已有的 CA。",
    newCa: "新建 CA",
    newRoot: "创建根 CA",
    newSubCa: "新建子 CA",
    anchorOnly: "无私钥",
    columns: {
      issued: "已签发",
      issuedValue: "{certs} 张证书 · {cas} 个 CA",
    },
    form: {
      title: "创建证书颁发机构",
      subTitle: "创建子 CA",
      description: "生成 CA 密钥对和证书。建议仅用根 CA 签发中间 CA。",
      type: "类型",
      typeHints: {
        root: "自签名。需要在设备上安装为受信任的根证书。",
        intermediate:
          "由其他 CA 签发。日常证书由它签发，从而减少根 CA 私钥的使用。",
      },
      parent: "上级 CA",
      pathLen: "路径长度",
      pathLenZero: "0 — 不允许再有子 CA",
      clampHint: "有效期不会超过上级 CA 的到期时间。",
      submit: "创建",
      submitting: "创建中…",
      created: "已创建 {name}",
    },
    import: {
      short: "导入 CA",
      title: "导入证书颁发机构",
      description:
        "添加已有的 CA 证书。提供私钥后可在此签发证书；否则仅用作证书链的信任锚。",
      cert: "CA 证书",
      certRequired: "请粘贴 CA 证书",
      key: "私钥（可选）",
      keyHint: "未加密的 PEM（PKCS#8、PKCS#1 或 SEC 1），将加密保存。",
      submit: "导入",
      done: "已导入 {name}",
    },
    detail: {
      summary: "已签发 {certs} 张证书和 {cas} 个子 CA",
      tabs: {
        issued: "已签发",
        trust: "信任与分发",
      },
      subCas: "子 CA",
      certificates: "证书",
      noCertificates: "尚未签发任何证书",
      noCertificatesHint: "由此 CA 签发的证书会显示在这里。",
      distribution: "公开地址",
      distributionHint: "此后签发的证书会包含这些地址，访问无需登录。",
      distributionNoUrl:
        "访问无需登录。在设置中配置公开地址后，新签发的证书会包含这些地址。",
      crlUrl: "吊销列表",
      caUrl: "CA 证书",
    },
    trust: {
      title: "信任此根 CA",
      intro:
        "下载证书（{file}），然后安装到需要信任此 CA 所签发证书的每台设备上。",
      intermediate:
        "中间 CA 无需安装为受信任证书。请安装根 CA，并在服务器的完整证书链中提供此 CA。",
      debian: "Debian / Ubuntu",
      rhel: "RHEL / Fedora",
      macos: "macOS",
      windows: "Windows",
      windowsHint:
        "在管理员 PowerShell 中运行；或双击证书文件，导入到“受信任的根证书颁发机构”。",
      firefox: "Firefox",
      firefoxHint:
        "Firefox 使用独立的证书库。在 about:config 中设置此项以信任系统根证书，或在 设置 → 证书 中导入。",
    },
  },
})
