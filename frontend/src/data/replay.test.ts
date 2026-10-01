import { createCellDrip } from '@/state/cellDrip'
import { createEventBatcher } from '@/state/eventBatcher'
import { initialRunState, reduceEvents, type TimedEvent } from '@/state/runStore'
import { encodeJudged, recordedRun } from '@/test/fixtures'
import type { ReplayLine } from './api'
import { MAX_IDLE_GAP_MS, planReplay, playReplay, type PlannedEvent } from './replay'

function fakeClock() {
  let t = 0
  const queue: (() => void)[] = []
  return {
    now: () => t,
    schedule: (cb: () => void) => queue.push(cb),
    cancel: () => {},
    /** advance by ms and run one frame */
    frame(ms: number) {
      t += ms
      queue.splice(0).forEach((cb) => cb())
    },
    pending: () => queue.length,
  }
}

const totalSpreadMs = (p: PlannedEvent[]) =>
  p.filter((x) => x.event.type === 'judged').reduce((k, x) => k + x.spreadMs, 0)

describe('planReplay', () => {
  it('fills the grid in the requested time, whatever the recorded pace', () => {
    // a heuristic-style run: every decision recorded at the same instant
    const instant: ReplayLine[] = recordedRun(1000, 50, 2).map((l) => ({
      ...l,
      t: l.event.type === 'judged' || l.event.type === 'counters' || l.event.type === 'rating' ? 1 : l.t,
    }))
    instant.sort((a, b) => a.t - b.t)
    const plan = planReplay(instant, { mode: 'fill', seconds: 30 })
    expect(totalSpreadMs(plan)).toBeCloseTo(30_000)
    // events stay in order and never overlap a batch that is still dripping
    for (let i = 1; i < plan.length; i++) expect(plan[i].atMs).toBeGreaterThanOrEqual(plan[i - 1].atMs)
    const judged = plan.filter((p) => p.event.type === 'judged')
    for (let i = 1; i < judged.length; i++)
      expect(judged[i].atMs).toBeGreaterThanOrEqual(judged[i - 1].atMs + judged[i - 1].spreadMs - 1e-6)
  })

  it('caps idle gaps in fill mode but keeps them in real time', () => {
    const lines: ReplayLine[] = [
      { t: 0, event: { type: 'stage', name: 'corpus', status: 'started' } },
      { t: 87, event: { type: 'stage', name: 'corpus', status: 'done' } },
    ]
    expect(planReplay(lines, { mode: 'fill', seconds: 30 })[1].atMs).toBe(MAX_IDLE_GAP_MS)
    expect(planReplay(lines, { mode: 'realtime', speed: 1 })[1].atMs).toBe(87_000)
    expect(planReplay(lines, { mode: 'realtime', speed: 4 })[1].atMs).toBe(21_750)
  })

  it('drips each batch over the gap to the next one in real time', () => {
    const lines: ReplayLine[] = [
      { t: 0, event: encodeJudged([0, 1], [1, 1]) },
      { t: 1.5, event: encodeJudged([2, 3], [2, 2]) },
    ]
    const plan = planReplay(lines, { mode: 'realtime', speed: 1 })
    expect(plan[0].spreadMs).toBe(1500)
    expect(plan[1].atMs).toBe(1500)
  })
})

describe('playReplay', () => {
  it('releases planned events on time, and finish() releases the rest at once', () => {
    const plan = planReplay(recordedRun(200, 20, 2), { mode: 'fill', seconds: 10 })
    const clock = fakeClock()
    const got: PlannedEvent[] = []
    let ended = false
    const h = playReplay(plan, (b) => got.push(...b), clock, () => (ended = true))
    clock.frame(h.duration / 2)
    expect(got.length).toBeGreaterThan(0)
    expect(got.length).toBeLessThan(plan.length)
    h.finish()
    expect(got).toHaveLength(plan.length)
    expect(got.slice(-3).every((p) => p.spreadMs === 0)).toBe(true)
    expect(ended).toBe(true)
  })

  it('stops on request', () => {
    const plan = planReplay(recordedRun(200, 20, 2), { mode: 'realtime', speed: 1 })
    const clock = fakeClock()
    const got: PlannedEvent[] = []
    const h = playReplay(plan, (b) => got.push(...b), clock)
    clock.frame(500)
    const before = got.length
    h.stop()
    clock.frame(5000)
    expect(got.length).toBe(before)
  })
})

describe('createCellDrip', () => {
  const setup = () => {
    const clock = fakeClock()
    let state = initialRunState('r', 100)
    const applied: TimedEvent[][] = []
    const drip = createCellDrip(
      (events) => {
        applied.push(events)
        state = reduceEvents(state, events, clock.now())
      },
      clock,
    )
    return { clock, drip, applied, get state() { return state } }
  }

  it('reveals a batch cell by cell over its spread', () => {
    const s = setup()
    const idx = Array.from({ length: 40 }, (_, i) => i)
    s.drip.push(encodeJudged(idx, idx.map(() => 1)), 400)
    s.clock.frame(100)
    const quarter = s.state.grid.counts()[1]
    expect(quarter).toBeGreaterThan(0)
    expect(quarter).toBeLessThan(40)
    s.clock.frame(100)
    expect(s.state.grid.counts()[1]).toBeGreaterThan(quarter)
    s.clock.frame(300)
    expect(s.state.grid.counts()[1]).toBe(40)
    expect(s.drip.backlog).toBe(0)
  })

  it('holds counters and rating until their batch is on screen', () => {
    const s = setup()
    s.drip.push(encodeJudged([0, 1, 2, 3], [2, 2, 2, 2]), 200)
    s.drip.push({ type: 'rating', raw: 0.7, adjusted: 0.6, ci: null, n_eff: 3, final: false })
    s.clock.frame(50)
    expect(s.state.rating).toBeNull() // batch still dripping
    s.clock.frame(200)
    expect(s.state.rating?.adjusted).toBe(0.6)
    expect(s.state.grid.counts()[2]).toBe(4)
  })

  it('applies a live backlog without delay (joining a finished or running stream)', () => {
    const s = setup()
    for (let b = 0; b < 10; b++) s.drip.push(encodeJudged([b * 2, b * 2 + 1], [1, 3])) // all arrive at once
    s.clock.frame(16)
    expect(s.state.grid.counts()[1] + s.state.grid.counts()[3]).toBe(20)
  })

  it('flushAll shows everything now', () => {
    const s = setup()
    s.drip.push(encodeJudged([5, 6], [4, 4]), 10_000)
    s.drip.push({ type: 'stage', name: 'decide', status: 'done' })
    s.drip.flushAll()
    expect(s.state.grid.actions[6]).toBe(4)
    expect(s.state.stages.decide).toBe('done')
  })
})

describe('createEventBatcher', () => {
  it('applies everything pushed in a frame as one batch', () => {
    const clock = fakeClock()
    const batches: number[][] = []
    const b = createEventBatcher<number>((e) => batches.push(e), clock.schedule, clock.cancel)
    b.push(1)
    b.push(2)
    b.push(3)
    expect(batches).toEqual([])
    clock.frame(16)
    expect(batches).toEqual([[1, 2, 3]])
    b.push(4)
    b.flush()
    expect(batches).toEqual([[1, 2, 3], [4]])
    b.dispose()
    b.push(5)
    clock.frame(16)
    expect(batches).toHaveLength(2)
  })
})
