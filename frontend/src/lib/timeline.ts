import type { HourIndex } from '@/data/api'

const HOUR_MS = 3_600_000
export const N_ACTIONS = 5

/** Hour buckets with a timestamp, as epoch ms, plus their grid ranges. */
export interface HourBuckets {
  ms: Float64Array
  starts: Uint32Array
  counts: Uint32Array
  t0: number
  /** end of the last hour (exclusive) */
  t1: number
}

export function hourBuckets(index: HourIndex): HourBuckets {
  const keep: number[] = []
  index.hours.forEach((h, i) => {
    if (h != null) keep.push(i)
  })
  const ms = new Float64Array(keep.map((i) => Date.parse(index.hours[i]!)))
  const starts = new Uint32Array(keep.map((i) => index.starts[i]))
  const counts = new Uint32Array(keep.map((i) => index.counts[i]))
  const t0 = ms.length ? ms[0] : 0
  const t1 = ms.length ? ms[ms.length - 1] + HOUR_MS : 1
  return { ms, starts, counts, t0, t1 }
}

/** Per-hour action counts from the grid: row-major [hour][action], 5 actions per hour. */
export function hourActionCounts(b: HourBuckets, actions: Uint8Array, out?: Uint32Array): Uint32Array {
  const res = out && out.length === b.ms.length * N_ACTIONS ? out : new Uint32Array(b.ms.length * N_ACTIONS)
  res.fill(0)
  for (let h = 0; h < b.ms.length; h++) {
    const base = h * N_ACTIONS
    const end = b.starts[h] + b.counts[h]
    for (let i = b.starts[h]; i < end; i++) res[base + (actions[i] ?? 0)]++
  }
  return res
}

/**
 * Bin hours into `width` pixel columns over [t0, t1). Each column sums the hours whose
 * start falls in it. Returns row-major [column][action] and the tallest column total.
 */
export function binColumns(
  b: HourBuckets,
  perHour: Uint32Array,
  width: number,
): { columns: Uint32Array; max: number } {
  const columns = new Uint32Array(width * N_ACTIONS)
  const span = b.t1 - b.t0 || 1
  for (let h = 0; h < b.ms.length; h++) {
    const col = Math.min(width - 1, Math.floor(((b.ms[h] - b.t0) / span) * width))
    for (let a = 0; a < N_ACTIONS; a++) columns[col * N_ACTIONS + a] += perHour[h * N_ACTIONS + a]
  }
  let max = 0
  for (let c = 0; c < width; c++) {
    let total = 0
    for (let a = 0; a < N_ACTIONS; a++) total += columns[c * N_ACTIONS + a]
    if (total > max) max = total
  }
  return { columns, max }
}

/** x position (0..width) of a timestamp. */
export const timeToX = (b: HourBuckets, t: number, width: number) => ((t - b.t0) / (b.t1 - b.t0 || 1)) * width

/** Hour bucket nearest to x (within the hours that have reviews), or -1. */
export function bucketAtX(b: HourBuckets, x: number, width: number): number {
  if (!b.ms.length) return -1
  const t = b.t0 + (x / width) * (b.t1 - b.t0)
  let lo = 0
  let hi = b.ms.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (b.ms[mid] <= t) lo = mid
    else hi = mid - 1
  }
  // Prefer the bucket that contains t; else the closer neighbour.
  if (t >= b.ms[lo] && t < b.ms[lo] + HOUR_MS) return lo
  const nextI = Math.min(lo + 1, b.ms.length - 1)
  return Math.abs(b.ms[nextI] - t) < Math.abs(t - (b.ms[lo] + HOUR_MS)) ? nextI : lo
}

/** Hour bucket containing grid index `i`, or -1. */
export function bucketOfIndex(b: HourBuckets, i: number): number {
  let lo = 0
  let hi = b.starts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (i < b.starts[mid]) hi = mid - 1
    else if (i >= b.starts[mid] + b.counts[mid]) lo = mid + 1
    else return mid
  }
  return -1
}

/** Calendar-day ticks (UTC) thinned to at most `maxTicks`. */
export function dayTicks(b: HourBuckets, maxTicks: number): number[] {
  const DAY = 24 * HOUR_MS
  const first = Math.ceil(b.t0 / DAY) * DAY
  const days = Math.max(1, Math.floor((b.t1 - first) / DAY) + 1)
  const steps = [1, 2, 7, 14, 30, 61, 91]
  const step = steps.find((s) => days / s <= maxTicks) ?? Math.ceil(days / maxTicks)
  const out: number[] = []
  for (let t = first; t < b.t1; t += step * DAY) out.push(t)
  return out
}
