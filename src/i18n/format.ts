const numberFormat = new Intl.NumberFormat('vi-VN')

/**
 * Scores, counts and ranks. Vietnamese groups thousands with a full stop, so a
 * raw `String(value)` diverges from every other number on the screen as soon as
 * a count passes 999.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return numberFormat.format(value)
}
