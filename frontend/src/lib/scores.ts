import type { RunScores } from '@/data/api'

/** ActionCode bytes (grid order): 0 PENDING, 1 KEEP, 2 DOWNWEIGHT, 3 FLAG, 4 EXCLUDE. */
const KEEP = 1
const DOWNWEIGHT = 2

export interface Weights {
  KEEP: number
  DOWNWEIGHT: number
  FLAG: number
  EXCLUDE: number
}

const weightOf = (w: Weights, a: number) => (a === 1 ? w.KEEP : a === 2 ? w.DOWNWEIGHT : a === 3 ? w.FLAG : a === 4 ? w.EXCLUDE : 0)

/** Σ w·r / Σ w over reviews with a rating: the backend's adjusted rating (decide/rating.py). */
export function weightedRating(rating: readonly (number | null)[], weight: (i: number) => number): number | null {
  let num = 0
  let den = 0
  for (let i = 0; i < rating.length; i++) {
    const r = rating[i]
    if (r == null) continue
    const w = weight(i)
    num += w * r
    den += w
  }
  return den > 0 ? num / den : null
}

export const rawRating = (s: RunScores) => weightedRating(s.rating_norm, () => 1)
export const adjustedRating = (s: RunScores, w: Weights = s.weights) => weightedRating(s.rating_norm, (i) => weightOf(w, s.action[i]))
export const platformRating = (s: RunScores) => weightedRating(s.rating_norm, (i) => (s.counts_in_platform[i] ? 1 : 0))

export interface WaterfallStep {
  code: string
  /** reviews whose first reason is this code and whose weight is below 1 */
  reviews: number
  /** rating after this step, in [0, 1] */
  after: number
  delta: number
  /** action most of these reviews got */
  action: number
}

/**
 * Raw → adjusted, one step per primary reason: each step applies the decided weights of
 * the reviews whose first reason is that code. Steps that change nothing are dropped;
 * reviews with a reduced weight but no reason are grouped as OTHER. The last step's
 * `after` equals the adjusted rating exactly.
 */
export function waterfall(s: RunScores): WaterfallStep[] {
  const n = s.rating_norm.length
  const applied = new Uint8Array(n)
  const w = s.weights
  const rating = () => weightedRating(s.rating_norm, (i) => (applied[i] ? weightOf(w, s.action[i]) : 1))
  let prev = rating() ?? 0
  const groups = [...s.reason_codes.map((_, k) => k), -1]
  const steps: WaterfallStep[] = []
  for (const k of groups) {
    const tally = [0, 0, 0, 0, 0]
    let count = 0
    for (let i = 0; i < n; i++) {
      if (s.primary_reason[i] !== k || s.rating_norm[i] == null || weightOf(w, s.action[i]) >= 1) continue
      applied[i] = 1
      tally[s.action[i]]++
      count++
    }
    if (!count) continue
    const after = rating() ?? prev
    steps.push({
      code: k === -1 ? 'OTHER' : s.reason_codes[k],
      reviews: count,
      after,
      delta: after - prev,
      action: tally.indexOf(Math.max(...tally)),
    })
    prev = after
  }
  return steps
}

export interface Sensitivity {
  downweightBelow: number
  downweightWeight: number
  /** false: split on integrity before the cluster penalty */
  clusterPenalty: boolean
}

export interface Resimulated {
  rating: number | null
  /** reviews whose action differs from the run's */
  changed: number
  counts: [number, number, number, number, number]
}

/**
 * Re-derive the KEEP / DOWNWEIGHT split from the stored integrity scores under other
 * settings. FLAG and EXCLUDE stay as decided, and so does a later copy's DOWNWEIGHT floor:
 * those come from rules the scores alone cannot replay. An exact re-run is free with the
 * "cached" backend (POST /runs, reuse_judgments_from).
 */
export function resimulate(s: RunScores, o: Sensitivity): Resimulated {
  const n = s.rating_norm.length
  const copy = s.reason_codes.indexOf('NEAR_DUPLICATE')
  const actions = new Uint8Array(n)
  const counts: Resimulated['counts'] = [0, 0, 0, 0, 0]
  let changed = 0
  for (let i = 0; i < n; i++) {
    let a = s.action[i]
    const score = o.clusterPenalty ? s.integrity[i] : s.base_integrity[i]
    if ((a === KEEP || a === DOWNWEIGHT) && score != null && s.primary_reason[i] !== copy) {
      a = score < o.downweightBelow ? DOWNWEIGHT : KEEP
    }
    actions[i] = a
    counts[a]++
    if (a !== s.action[i]) changed++
  }
  const w = { ...s.weights, DOWNWEIGHT: o.downweightWeight }
  return { rating: weightedRating(s.rating_norm, (i) => weightOf(w, actions[i])), changed, counts }
}
