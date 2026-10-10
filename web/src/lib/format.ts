// Locale-aware formatting helpers. Pure functions; components get bound
// versions through useI18n().fmt so the active language is applied.

const numberFormats = new Map<string, Intl.NumberFormat>()

export function formatNumber(locale: string, value: number, digits = 0) {
  if (!Number.isFinite(value)) return "–"
  const key = `${locale}|${digits}`
  let nf = numberFormats.get(key)
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { maximumFractionDigits: digits })
    numberFormats.set(key, nf)
  }
  return nf.format(value)
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()

export function formatRelative(locale: string, date: Date, now = Date.now()) {
  if (Number.isNaN(date.getTime())) return "–"
  let rtf = relativeFormats.get(locale)
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    relativeFormats.set(locale, rtf)
  }
  const diff = (date.getTime() - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 5) return rtf.format(0, "second")
  if (abs < 60) return rtf.format(Math.round(diff), "second")
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour")
  if (abs < 86400 * 45) return rtf.format(Math.round(diff / 86400), "day")
  if (abs < 86400 * 365)
    return rtf.format(Math.round(diff / 86400 / 30), "month")
  return rtf.format(Math.round(diff / 86400 / 365), "year")
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = locale + JSON.stringify(options)
  let df = dateFormats.get(key)
  if (!df) {
    df = new Intl.DateTimeFormat(locale, options)
    dateFormats.set(key, df)
  }
  return df
}

export function formatDateTime(locale: string, date: Date) {
  if (Number.isNaN(date.getTime())) return "–"
  return dateFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    date
  )
}

export function formatDate(locale: string, date: Date) {
  if (Number.isNaN(date.getTime())) return "–"
  return dateFormat(locale, { dateStyle: "medium" }).format(date)
}

export function parseDate(value: string | undefined | null) {
  return value ? new Date(value) : new Date(NaN)
}

/** Whole days from now until date (negative once passed). */
export function daysUntil(value: string, now = Date.now()) {
  return Math.floor((parseDate(value).getTime() - now) / 86_400_000)
}
