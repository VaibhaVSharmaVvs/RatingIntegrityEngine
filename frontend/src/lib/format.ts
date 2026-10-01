/** Display formatters. `rating_norm` is in [0, 1] for every scale (backend normalize.py). */
export type RatingScale = 'binary' | '1-5' | '1-10' | string

export function scaleMax(scale: RatingScale): number | null {
  const m = /^1-(\d+)$/.exec(scale)
  return m ? Number(m[1]) : null
}

/** Normalised rating → display number: % positive for binary, stars for 1-N scales. */
export function ratingValue(norm: number, scale: RatingScale): number {
  const max = scaleMax(scale)
  return max ? 1 + norm * (max - 1) : norm * 100
}

export function formatRating(norm: number | null | undefined, scale: RatingScale): string {
  if (norm == null || Number.isNaN(norm)) return '—'
  const max = scaleMax(scale)
  const v = ratingValue(norm, scale)
  return max ? v.toFixed(2) : `${v.toFixed(1)}%`
}

export function ratingUnit(scale: RatingScale): string {
  const max = scaleMax(scale)
  return max ? `of ${max}` : 'positive'
}

export function formatRatingRange(ci: [number, number] | null | undefined, scale: RatingScale): string {
  if (!ci) return '—'
  const max = scaleMax(scale)
  const [a, b] = ci.map((c) => ratingValue(c, scale))
  return max ? `${a.toFixed(2)}–${b.toFixed(2)}` : `${a.toFixed(1)}–${b.toFixed(1)}%`
}

/** Signed difference adjusted − raw, in display units (pp for binary). */
export function formatDelta(raw: number, adjusted: number, scale: RatingScale): string {
  const max = scaleMax(scale)
  const d = ratingValue(adjusted, scale) - ratingValue(raw, scale)
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
  return max ? `${sign}${Math.abs(d).toFixed(2)}` : `${sign}${Math.abs(d).toFixed(1)} pp`
}

/** The reviewer's verdict in words for a single review. */
export function verdictWords(norm: number | null, raw: number | null, scale: RatingScale): string {
  if (norm == null) return 'No rating'
  const max = scaleMax(scale)
  if (!max) return norm >= 0.5 ? 'Recommended' : 'Not recommended'
  return `${raw ?? ratingValue(norm, scale)} of ${max}`
}

const int = new Intl.NumberFormat('en-US')
export const formatInt = (n: number | null | undefined) => (n == null ? '—' : int.format(Math.round(n)))

export function formatPct(part: number, total: number, digits = 1): string {
  return total > 0 ? `${((100 * part) / total).toFixed(digits)}%` : '—'
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '$0'
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null) return '—'
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  if (m < 60) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function formatRate(rps: number | null | undefined): string {
  if (rps == null) return '—'
  return rps >= 100 ? int.format(Math.round(rps)) : rps.toFixed(1)
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const hourFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  hourCycle: 'h23',
})

export const formatDay = (d: Date | string) => dayFmt.format(new Date(d))
export const formatHour = (d: Date | string) => `${hourFmt.format(new Date(d))} UTC`

export function snippet(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}
