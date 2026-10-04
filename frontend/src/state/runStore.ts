import { create } from 'zustand'
import type { ClusterEvent, CountersEvent, RatingEvent, RunSummary, StageEvent } from '@/data/api'
import { decodeJudged, type RunEvent } from '@/data/events'
import { GridBuffer } from './gridBuffer'

export const STAGES = ['ingest', 'features', 'systemone', 'corpus', 'decide'] as const
export type StageName = StageEvent['name']
export type StageStatus = 'pending' | StageEvent['status']
export type RunPhase = 'idle' | 'connecting' | 'running' | 'done' | 'error'

/** Already-decoded grid updates: what the cell drip releases, a slice of one `judged` batch. */
export interface CellsEvent {
  type: 'cells'
  indices: ArrayLike<number>
  actions: ArrayLike<number>
}

/** An SSE event with its offset from run start (seconds); replay lines carry the same `t`. */
export type TimedEvent = (RunEvent | CellsEvent) & { t?: number }

export interface RatingPoint {
  t: number
  raw: number
  adjusted: number
  /** Platform-policy rating (Steam's rules emulated); null when not computable. */
  platform: number | null
}

export interface RunViewState {
  runId: string | null
  phase: RunPhase
  stages: Record<StageName, StageStatus>
  featureCounts: Record<string, number> | null
  counters: CountersEvent | null
  rating: RatingEvent | null
  /** rating trail for the ticker sparkline; capped */
  ratingTrail: RatingPoint[]
  /** clusters in arrival order (deduplicated by cid) */
  clusters: ClusterEvent[]
  summary: RunSummary | null
  error: { message: string; retryable: boolean } | null
  /** latest event offset (s) */
  t: number
  grid: GridBuffer
  /** bumps on every grid change; subscribe to this, read `grid` imperatively */
  gridVersion: number
  /** cells per action code as shown on screen [pending, keep, down, flag, exclude] */
  tally: readonly number[]
}

export const RATING_TRAIL_MAX = 240

const pendingStages = (): Record<StageName, StageStatus> =>
  Object.fromEntries(STAGES.map((s) => [s, 'pending'])) as Record<StageName, StageStatus>

export function initialRunState(runId: string | null = null, n = 0, grid = new GridBuffer(n)): RunViewState {
  return {
    runId,
    phase: runId ? 'connecting' : 'idle',
    stages: pendingStages(),
    featureCounts: null,
    counters: null,
    rating: null,
    ratingTrail: [],
    clusters: [],
    summary: null,
    error: null,
    t: 0,
    grid,
    gridVersion: 0,
    tally: Array.from(grid.tally),
  }
}

/**
 * Fold a batch of events into the state. Pure apart from the grid buffer, which is
 * mutated in place (its identity is stable; `gridVersion` signals the change).
 */
export function reduceEvents(state: RunViewState, events: TimedEvent[], now: number): RunViewState {
  if (events.length === 0) return state
  let next: RunViewState = { ...state }
  let gridChanged = false
  for (const e of events) {
    if (e.t != null && e.t > next.t) next.t = e.t
    switch (e.type) {
      case 'stage':
        next.stages = { ...next.stages, [e.name]: e.status }
        if (next.phase === 'connecting' || next.phase === 'idle') next.phase = 'running'
        break
      case 'features_done':
        next.featureCounts = e.counts
        break
      case 'judged': {
        const { indices, actions } = decodeJudged(e)
        if (next.grid.apply(indices, actions, now) > 0) gridChanged = true
        break
      }
      case 'cells':
        if (next.grid.apply(e.indices, e.actions, now) > 0) gridChanged = true
        break
      case 'counters':
        next.counters = e
        if (e.total > next.grid.size) {
          next.grid.ensure(e.total)
          gridChanged = true
        }
        break
      case 'rating': {
        next.rating = e
        const point = { t: e.t ?? next.t, raw: e.raw, adjusted: e.adjusted, platform: e.platform ?? null }
        const trail = next.ratingTrail.length >= RATING_TRAIL_MAX ? thin(next.ratingTrail) : next.ratingTrail
        next.ratingTrail = [...trail, point]
        break
      }
      case 'cluster':
        if (!next.clusters.some((c) => c.cid === e.cid)) next.clusters = [...next.clusters, e]
        break
      case 'done':
        next.summary = e.summary
        next.phase = 'done'
        break
      case 'error':
        next.error = { message: e.message, retryable: e.retryable }
        next.phase = 'error'
        break
    }
  }
  if (gridChanged) {
    next.gridVersion = state.gridVersion + 1
    next.tally = Array.from(next.grid.tally)
  }
  if (next.phase === 'connecting') next.phase = 'running'
  return next
}

/** Halve a trail by keeping every other point (the last point always survives). */
function thin(trail: RatingPoint[]): RatingPoint[] {
  return trail.filter((_, i) => i % 2 === 1 || i === trail.length - 1)
}

interface RunStore extends RunViewState {
  /** Start viewing a run with `n` reviews; reuses the grid buffer allocation. */
  reset: (runId: string | null, n?: number) => void
  ingest: (events: TimedEvent[], now?: number) => void
  loadGrid: (actions: Uint8Array) => void
  fail: (message: string) => void
}

export const useRunStore = create<RunStore>()((set, get) => ({
  ...initialRunState(),
  reset: (runId, n = 0) => {
    const grid = get().grid
    grid.reset(n)
    set({ ...initialRunState(runId, n, grid), gridVersion: get().gridVersion + 1, tally: Array.from(grid.tally) })
  },
  ingest: (events, now = performance.now()) => set((s) => reduceEvents(s, events, now)),
  loadGrid: (actions) => {
    get().grid.load(actions)
    set((s) => ({ gridVersion: s.gridVersion + 1, tally: Array.from(s.grid.tally) }))
  },
  fail: (message) => set({ phase: 'error', error: { message, retryable: true } }),
}))
