import type { ReplayLine } from './api'
import type { TimedRunEvent } from './DataSource'
import { decodeJudged } from './events'

/**
 * How a finished run plays back.
 * - `fill`: the grid fills in `seconds` whatever the run's size or recorded pace, so a
 *   50K heuristic run (decided in one instant) and a 5K Jev run (two minutes) both read.
 * - `realtime`: recorded pace × `speed`; idle gaps are kept, as recorded.
 */
export type ReplayPace = { mode: 'fill'; seconds: number } | { mode: 'realtime'; speed: number }

/** One scheduled event: when to release it (ms from start) and, for `judged`, how long to drip its cells. */
export interface PlannedEvent {
  event: TimedRunEvent
  atMs: number
  spreadMs: number
}

/** In fill mode a gap with no decisions (e.g. the corpus stage) plays for at most this long. */
export const MAX_IDLE_GAP_MS = 1200
/** In real time, one batch's cells drip over at most this long. */
export const MAX_SPREAD_MS = 2000

const cellCount = (e: TimedRunEvent) => (e.type === 'judged' ? decodeJudged(e).indices.length : 0)
/** events that ride along with decisions; in fill mode the drip, not the recording, paces them */
const FLOW = new Set<TimedRunEvent['type']>(['judged', 'counters', 'rating'])

/**
 * Turn a recording into a wall-clock schedule. Events keep their order; whatever follows a
 * `judged` batch (counters, rating) is released only once that batch has dripped in, so
 * the numbers on screen always match the grid.
 */
export function planReplay(lines: ReplayLine[], pace: ReplayPace): PlannedEvent[] {
  const events = lines.map((l) => ({ ...l.event, t: l.t }) as TimedRunEvent)
  const cells = events.map(cellCount)
  const total = cells.reduce((a, b) => a + b, 0)
  const plan: PlannedEvent[] = []
  let wall = 0
  let revealEnd = 0
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const dt = i === 0 ? 0 : Math.max(0, (e.t - events[i - 1].t) * 1000)
    if (pace.mode === 'fill') {
      // Decisions are paced by count (the drip); idle time between stages is capped.
      wall = Math.max(wall + (FLOW.has(e.type) ? 0 : Math.min(dt, MAX_IDLE_GAP_MS)), revealEnd)
    } else {
      wall = Math.max(wall + dt / pace.speed, revealEnd)
    }
    let spread = 0
    if (cells[i] > 0) {
      if (pace.mode === 'fill') {
        spread = total ? (pace.seconds * 1000 * cells[i]) / total : 0
      } else {
        const next = events.findIndex((x, k) => k > i && x.type === 'judged')
        spread = next < 0 ? 0 : Math.min(MAX_SPREAD_MS, ((events[next].t - e.t) * 1000) / pace.speed)
      }
      revealEnd = wall + spread
    }
    plan.push({ event: e, atMs: wall, spreadMs: spread })
  }
  return plan
}

export interface ReplayOptions {
  now?: () => number
  schedule?: (cb: () => void) => number
  cancel?: (id: number) => void
}

export interface ReplayHandle {
  stop: () => void
  /** release everything that is left, now (Skip to end) */
  finish: () => void
  /** planned length, ms */
  readonly duration: number
}

/** Release planned events at their wall-clock times, one `emit` per tick with every due event. */
export function playReplay(
  plan: PlannedEvent[],
  emit: (events: PlannedEvent[]) => void,
  {
    now = () => performance.now(),
    schedule = (cb) => requestAnimationFrame(cb),
    cancel = (id) => cancelAnimationFrame(id),
  }: ReplayOptions = {},
  onEnd?: () => void,
): ReplayHandle {
  const t0 = now()
  let next = 0
  let handle: number | null = null
  let stopped = false

  const release = (until: number) => {
    const batch: PlannedEvent[] = []
    while (next < plan.length && plan[next].atMs <= until) batch.push(plan[next++])
    if (batch.length) emit(batch)
  }
  const tick = () => {
    handle = null
    if (stopped) return
    release(now() - t0)
    if (next < plan.length) handle = schedule(tick)
    else onEnd?.()
  }
  tick()

  return {
    stop: () => {
      stopped = true
      if (handle !== null) cancel(handle)
    },
    finish: () => {
      if (stopped) return
      stopped = true
      if (handle !== null) cancel(handle)
      emit(plan.slice(next).map((p) => ({ ...p, spreadMs: 0 })))
      next = plan.length
      onEnd?.()
    },
    duration: plan.length ? plan[plan.length - 1].atMs + plan[plan.length - 1].spreadMs : 0,
  }
}
