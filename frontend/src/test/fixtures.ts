import type { HourIndex, JudgedEvent, ReplayLine, RunSummary } from '@/data/api'

/** Encode indices/actions the way the backend does (little-endian u32 + u8, base64). */
export function encodeJudged(indices: number[], actions: number[]): JudgedEvent {
  const idx = new Uint8Array(new Uint32Array(indices).buffer)
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  return { type: 'judged', indices_b64: b64(idx), actions_b64: b64(new Uint8Array(actions)) }
}

export const summaryFor = (n: number, counts: number[]): RunSummary => ({
  n_reviews: n,
  counts: { KEEP: counts[1], DOWNWEIGHT: counts[2], FLAG: counts[3], EXCLUDE: counts[4] },
  raw: 0.7,
  adjusted: 0.66,
  ci: [0.64, 0.68],
  n_eff: n * 0.8,
  rating_scale: 'binary',
  steam_label_raw: 'Mostly Positive',
  steam_label_adjusted: 'Mostly Positive',
  cost_usd: 0,
  tokens_in: 0,
  elapsed_s: 2,
  reviews_per_s: n / 2,
  model_version: 'mock-1',
  timings_s: { ingest: 0.1, features: 0.2, systemone: 1.5, corpus: 0.1, decide: 0.1 },
  reused_judgments: 0,
  requests: 0,
  retries: 0,
  latency_p50_ms: null,
  latency_p95_ms: null,
  embedding_cache_hit: null,
  corpus: {
    clusters: { burst: 1 },
    suspicious_clusters: 1,
    change_points: [],
    penalised_reviews: 0,
    actions_changed_by_clusters: 1,
  },
})

/** Deterministic action for review i: a "burst" band of DOWNWEIGHT in the middle. */
export const fixtureAction = (i: number, n: number) =>
  i >= n * 0.4 && i < n * 0.5 ? 2 : i % 17 === 0 ? 3 : i % 41 === 0 ? 4 : 1

/**
 * A recorded run in the shape of `replay.jsonl.gz` (stage → judged batches with counters
 * and rating → cluster → S4 update → done), over `seconds` of recorded time.
 */
export function recordedRun(n: number, batch = 100, seconds = 2): ReplayLine[] {
  const lines: ReplayLine[] = []
  const at = (t: number, event: ReplayLine['event']) => lines.push({ t, event })
  at(0, { type: 'stage', name: 'ingest', status: 'started' })
  at(0.01, { type: 'stage', name: 'ingest', status: 'done' })
  at(0.02, { type: 'stage', name: 'features', status: 'started' })
  at(0.05, { type: 'features_done', counts: { near_dup: 3 }, timings_s: { minhash: 0.01 } })
  at(0.06, { type: 'stage', name: 'features', status: 'done' })
  at(0.07, { type: 'stage', name: 'systemone', status: 'started' })
  const counts = [n, 0, 0, 0, 0]
  const batches = Math.ceil(n / batch)
  for (let b = 0; b < batches; b++) {
    const t = 0.1 + ((seconds - 0.4) * (b + 1)) / batches
    const idx: number[] = []
    const act: number[] = []
    for (let i = b * batch; i < Math.min(n, (b + 1) * batch); i++) {
      idx.push(i)
      act.push(fixtureAction(i, n))
      counts[0]--
      counts[fixtureAction(i, n)]++
    }
    at(t, encodeJudged(idx, act))
    const processed = n - counts[0]
    at(t, {
      type: 'counters',
      keep: counts[1],
      down: counts[2],
      flag: counts[3],
      exclude: counts[4],
      processed,
      total: n,
      rps: processed / t,
      cost_usd: 0,
      elapsed_s: t,
    })
    at(t, { type: 'rating', raw: 0.7, adjusted: 0.7 - (0.04 * processed) / n, ci: null, n_eff: processed, final: false })
  }
  at(seconds - 0.25, { type: 'stage', name: 'systemone', status: 'done' })
  at(seconds - 0.2, { type: 'stage', name: 'corpus', status: 'started' })
  at(seconds - 0.15, {
    type: 'cluster',
    cid: 7,
    kind: 'burst',
    size: Math.round(n * 0.1),
    suspicion: 0.82,
    caption: `${Math.round(n * 0.1)} reviews · 91% within 3 h · 88% same verdict`,
  })
  at(seconds - 0.1, { type: 'stage', name: 'corpus', status: 'done' })
  at(seconds - 0.08, { type: 'stage', name: 'decide', status: 'started' })
  // S4 escalates one review: the last update wins.
  at(seconds - 0.05, encodeJudged([0], [4]))
  counts[fixtureAction(0, n)]--
  counts[4]++
  at(seconds - 0.04, { type: 'rating', raw: 0.7, adjusted: 0.66, ci: [0.64, 0.68], n_eff: n * 0.8, final: true })
  at(seconds - 0.02, { type: 'stage', name: 'decide', status: 'done' })
  at(seconds, { type: 'done', summary: summaryFor(n, counts) })
  return lines
}

/** n reviews spread over hours, `perHour` each, starting 2024-05-01T00:00Z. */
export function hourIndex(n: number, perHour: number): HourIndex {
  const hours: string[] = []
  const starts: number[] = []
  const counts: number[] = []
  for (let s = 0, h = 0; s < n; s += perHour, h++) {
    hours.push(new Date(Date.UTC(2024, 4, 1, h)).toISOString())
    starts.push(s)
    counts.push(Math.min(perHour, n - s))
  }
  return { hours, starts, counts }
}
