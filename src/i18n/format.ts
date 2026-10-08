import { currentLocale, type Locale } from './locale'

const numberFormats: Record<Locale, Intl.NumberFormat> = {
  vi: new Intl.NumberFormat('vi-VN'),
  en: new Intl.NumberFormat('en-US'),
}

/**
 * Scores, counts and ranks in the current locale. Vietnamese groups thousands
 * with a full stop, so a raw `String(value)` diverges from every other number
 * on the screen as soon as a count passes 999.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return numberFormats[currentLocale()].format(value)
}
