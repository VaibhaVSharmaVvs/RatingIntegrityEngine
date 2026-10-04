import type { ExcludedWindowOut } from '@/data/api'
import type { HourBuckets } from './timeline'

const HOUR_MS = 3_600_000

/**
 * The grid's "Steam policy" view: which reviews Steam's own review-score rules would count
 * (app/decide/platform.py). Class per cell: 0 pending (not revealed yet), 1 counts,
 * 2 left out because it falls in an off-topic review-bomb window, 3 left out as a key
 * activation (not bought on Steam).
 */
export const STEAM_CLASSES = ['PENDING', 'COUNTS', 'WINDOW', 'KEY'] as const
export type SteamClass = (typeof STEAM_CLASSES)[number]

export const STEAM_LABELS: Record<SteamClass, string> = {
  PENDING: 'Pending',
  COUNTS: 'Counts',
  WINDOW: 'Off-topic window',
  KEY: 'Key activation',
}

/** What each class means, for tooltips. */
export const STEAM_DETAIL: Record<SteamClass, string> = {
  PENDING: 'Not decided yet',
  COUNTS: 'Counts in Steam’s score',
  WINDOW: 'Left out: inside an off-topic review-bomb window',
  KEY: 'Left out: key activation, not bought on Steam',
}

/**
 * Re-uses three action colours (already validated together on the instrument surface):
 * counts = keep teal, window = exclude vermilion, key activation = flag violet.
 * Indexed by class; slot 4 is unused padding so the paint tables stay 5 wide.
 */
export function steamHex(actionHex: readonly string[]): string[] {
  return [actionHex[0], actionHex[1], actionHex[4], actionHex[3], actionHex[0]]
}

/**
 * Per-review Steam class from the scores endpoint. The backend removes key activations
 * first, then the off-topic windows, so a review left out that is not a key activation is
 * in a window; with `keyActivation` the split matches the run summary exactly.
 *
 * Scores exported before `platform_key_activation` existed fall back to the windows:
 * whole hours, [start, end + 1 h), the backend's bounds, so a review's hour bucket decides
 * it (a key activation inside a window then shows as the window).
 */
export function steamClasses(
  countsInPlatform: readonly boolean[],
  keyActivation: readonly boolean[] | undefined,
  windows: readonly ExcludedWindowOut[],
  buckets: HourBuckets | null,
): Uint8Array {
  const n = countsInPlatform.length
  const out = new Uint8Array(n)
  if (keyActivation && keyActivation.length === n) {
    for (let i = 0; i < n; i++) out[i] = countsInPlatform[i] ? 1 : keyActivation[i] ? 3 : 2
    return out
  }
  for (let i = 0; i < n; i++) out[i] = countsInPlatform[i] ? 1 : 3
  if (!buckets || windows.length === 0) return out
  const spans = windows.map((w) => [Date.parse(w.start), Date.parse(w.end) + HOUR_MS] as const)
  for (let h = 0; h < buckets.ms.length; h++) {
    const t = buckets.ms[h]
    if (!spans.some(([a, b]) => a <= t && t < b)) continue
    const end = Math.min(n, buckets.starts[h] + buckets.counts[h])
    for (let i = buckets.starts[h]; i < end; i++) if (!countsInPlatform[i]) out[i] = 2
  }
  return out
}

/** Revealed cells per class, [pending, counts, window, key]. */
export function steamTally(actions: Uint8Array, classes: Uint8Array, n: number): [number, number, number, number] {
  const t: [number, number, number, number] = [0, 0, 0, 0]
  const m = Math.min(n, actions.length, classes.length)
  for (let i = 0; i < m; i++) t[actions[i] ? classes[i] : 0]++
  t[0] += Math.max(0, n - m)
  return t
}
