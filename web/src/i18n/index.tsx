/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

import {
  dictionaries,
  LANGS,
  type Lang,
  type MessageKey,
} from "@/i18n/messages"
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
  parseDate,
} from "@/lib/format"

export type { Lang, MessageKey }
export { LANGS }

const STORAGE_KEY = "firessl-lang"

export const LANG_LABELS: Record<Lang, string> = {
  en: "English",
  zh: "简体中文",
}

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" }

export type TranslateVars = Record<string, string | number>
export type Translate = (key: MessageKey, vars?: TranslateVars) => string

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "en" || stored === "zh") return stored
  } catch {
    // Ignore storage errors and fall back to the browser language.
  }
  const preferred = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  for (const tag of preferred) {
    const lower = tag.toLowerCase()
    if (lower.startsWith("zh")) return "zh"
    if (lower.startsWith("en")) return "en"
  }
  return "en"
}

function interpolate(template: string, vars?: TranslateVars) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  )
}

function makeTranslate(lang: Lang): Translate {
  const dict = dictionaries[lang]
  const fallback = dictionaries.en
  return (key, vars) =>
    interpolate(dict.get(key) ?? fallback.get(key) ?? key, vars)
}

type DateInput = Date | string | number | undefined | null

function toDate(value: DateInput) {
  if (value instanceof Date) return value
  if (typeof value === "number") return new Date(value)
  return parseDate(value)
}

function makeFormatters(lang: Lang) {
  const locale = LOCALES[lang]
  return {
    locale,
    number: (value: number, digits = 0) => formatNumber(locale, value, digits),
    relative: (value: DateInput, now?: number) =>
      formatRelative(locale, toDate(value), now),
    dateTime: (value: DateInput) => formatDateTime(locale, toDate(value)),
    date: (value: DateInput) => formatDate(locale, toDate(value)),
  }
}

export type Formatters = ReturnType<typeof makeFormatters>

type I18nContextValue = {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translate
  fmt: Formatters
}

const I18nContext = React.createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>(detectLang)

  React.useEffect(() => {
    document.documentElement.lang = LOCALES[lang]
  }, [lang])

  const setLang = React.useCallback((next: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore: the choice still applies for this session.
    }
    setLangState(next)
  }, [])

  const value = React.useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: makeTranslate(lang),
      fmt: makeFormatters(lang),
    }),
    [lang, setLang]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = React.useContext(I18nContext)
  if (!context) throw new Error("useI18n must be used within an I18nProvider")
  return context
}
