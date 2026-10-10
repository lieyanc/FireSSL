import { defineMessages } from "@/i18n/define"

export const inspect = defineMessages({
  en: {
    title: "Inspector",
    description:
      "Decode certificates, CSRs, private keys and CRLs. Nothing you paste here is stored.",
    placeholder: "Paste one or more PEM blocks (-----BEGIN ...-----)",
    submit: "Inspect",
    emptyTitle: "Paste PEM data to inspect",
    emptyHint:
      "Pasting a certificate together with a private key also checks that they match.",
    selfSigned: "Self-signed",
    known: "Stored in FireSSL",
    unsupported: "This PEM type is not decoded.",
    keyMatch: "Matching certificate",
    keyMatches: "Matches block #{index}",
    keyNoMatch: "No certificate in the input matches this key",
    types: {
      certificate: "Certificate",
      csr: "Certificate signing request",
      privateKey: "Private key",
      crl: "Certificate revocation list",
      unknown: "Unknown block",
    },
    crl: {
      number: "CRL number",
      thisUpdate: "This update",
      nextUpdate: "Next update",
      revoked: "Revoked certificates",
      serials: "Serial numbers",
    },
  },
  zh: {
    title: "证书解析",
    description: "解析证书、CSR、私钥和 CRL。粘贴的内容不会被保存。",
    placeholder: "粘贴一个或多个 PEM 块（-----BEGIN ...-----）",
    submit: "解析",
    emptyTitle: "粘贴 PEM 内容进行解析",
    emptyHint: "同时粘贴证书和私钥，可检查二者是否匹配。",
    selfSigned: "自签名",
    known: "已保存在 FireSSL",
    unsupported: "不支持解析此类 PEM。",
    keyMatch: "匹配的证书",
    keyMatches: "与第 {index} 块匹配",
    keyNoMatch: "输入中没有与此私钥匹配的证书",
    types: {
      certificate: "证书",
      csr: "证书签名请求",
      privateKey: "私钥",
      crl: "证书吊销列表",
      unknown: "未知块",
    },
    crl: {
      number: "CRL 编号",
      thisUpdate: "本次更新",
      nextUpdate: "下次更新",
      revoked: "已吊销证书",
      serials: "序列号",
    },
  },
})
