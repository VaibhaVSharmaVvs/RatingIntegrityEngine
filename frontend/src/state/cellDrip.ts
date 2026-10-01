import { decodeJudged } from '@/data/events'
import type { TimedEvent } from './runStore'

/**
 * Reveal each `judged` batch cell by cell over a time window instead of all at once.
 * Events are released in order: anything after a batch (counters, rating, the next
 * batch) waits until that batch is fully on screen, so numbers always match the grid.
 * One `apply` per animation frame.
 */
export interface CellDrip {
  /** `spreadMs` = how long to drip this batch; omitted → estimated from arrival rate (live) */
  push: (e: TimedEvent, spreadMs?: number) => void
  /** apply everything queued now (Skip to end, reconnect) */
  flushAll: () => void
  /** cells waiting to be shown */
  readonly backlog: number
  dispose: () => void
}

interface CellsItem {
  kind: 'cells'
  indices: Uint32Array
  actions: Uint8Array
  pos: number
  spreadMs: number
  /** when the batch arrived; it can't start before that */
  arrived: number
  /** when its drip started (set when it reaches the head of the queue) */
  start: number | null
  t?: number
}
type Item = CellsItem | { kind: 'event'; event: TimedEvent }

/** live streams: never let a batch take longer than this to appear */
export const LIVE_MAX_SPREAD_MS = 1500
/** with more queued batches than this, each drips in at most CATCH_UP_MS (stay near real time) */
const CATCH_UP_BATCHES = 2
const CATCH_UP_MS = 120

export function createCellDrip(
  apply: (events: TimedEvent[]) => void,
  {
    now = () => performance.now(),
    schedule = (cb: () => void) => requestAnimationFrame(cb),
    cancel = (id: number) => cancelAnimationFrame(id),
  } = {},
): CellDrip {
  const queue: Item[] = []
  let handle: number | null = null
  let disposed = false
  let lastJudgedAt: number | null = null
  let interval = 0 // EMA of live judged inter-arrival, ms
  let backlog = 0
  /** when the last batch finished dripping: the next one starts there, not at "now" */
  let lastEnd = -Infinity

  const cellsEvent = (it: CellsItem, end: number): TimedEvent => ({
    type: 'cells',
    indices: it.indices.subarray(it.pos, end),
    actions: it.actions.subarray(it.pos, end),
    t: it.t,
  })

  const drain = (all: boolean) => {
    const out: TimedEvent[] = []
    const t = now()
    let batchesQueued = queue.reduce((k, it) => k + (it.kind === 'cells' ? 1 : 0), 0)
    while (queue.length) {
      const head = queue[0]
      if (head.kind === 'event') {
        out.push(head.event)
        queue.shift()
        continue
      }
      const spread = batchesQueued > CATCH_UP_BATCHES ? Math.min(head.spreadMs, CATCH_UP_MS) : head.spreadMs
      head.start ??= Math.min(t, Math.max(lastEnd, head.arrived))
      const len = head.indices.length
      const target = all || spread <= 0 ? len : Math.min(len, Math.ceil((len * (t - head.start)) / spread))
      if (target > head.pos) {
        out.push(cellsEvent(head, target))
        backlog -= target - head.pos
        head.pos = target
      }
      if (head.pos < len) break
      lastEnd = all ? t : Math.min(t, head.start + spread)
      queue.shift()
      batchesQueued--
    }
    if (out.length) apply(out)
  }

  const tick = () => {
    handle = null
    if (disposed) return
    drain(false)
    if (queue.length) handle = schedule(tick)
  }
  const kick = () => {
    if (handle === null && !disposed) handle = schedule(tick)
  }

  return {
    push: (e, spreadMs) => {
      if (disposed) return
      if (e.type === 'judged') {
        const { indices, actions } = decodeJudged(e)
        let spread = spreadMs
        if (spread === undefined) {
          const at = now()
          if (lastJudgedAt !== null) interval = interval ? 0.7 * interval + 0.3 * (at - lastJudgedAt) : at - lastJudgedAt
          lastJudgedAt = at
          spread = Math.min(interval, LIVE_MAX_SPREAD_MS)
        }
        queue.push({ kind: 'cells', indices, actions, pos: 0, spreadMs: spread, arrived: now(), start: null, t: e.t })
        backlog += indices.length
      } else {
        queue.push({ kind: 'event', event: e })
      }
      kick()
    },
    flushAll: () => drain(true),
    get backlog() {
      return backlog
    },
    dispose: () => {
      disposed = true
      if (handle !== null) cancel(handle)
      queue.length = 0
    },
  }
}
