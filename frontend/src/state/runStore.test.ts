import { encodeJudged, fixtureAction, recordedRun } from '@/test/fixtures'
import { GridBuffer } from './gridBuffer'
import { initialRunState, RATING_TRAIL_MAX, reduceEvents, useRunStore, type TimedEvent } from './runStore'

const N = 500
const events = (): TimedEvent[] => recordedRun(N).map((l) => ({ ...l.event, t: l.t }) as TimedEvent)

describe('reduceEvents', () => {
  it('replays a recorded run to its final state', () => {
    const s = reduceEvents(initialRunState('run_x', N), events(), 0)
    expect(s.phase).toBe('done')
    expect(Object.values(s.stages)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(s.counters?.processed).toBe(N)
    expect(s.rating?.final).toBe(true)
    expect(s.summary?.n_reviews).toBe(N)
    expect(s.t).toBe(2)
    // every cell decided; review 0 was escalated by S4 (last update wins)
    expect(s.grid.actions[0]).toBe(4)
    for (let i = 1; i < N; i++) expect(s.grid.actions[i]).toBe(fixtureAction(i, N))
  })

  it('gives the same grid whether events arrive one at a time or in one batch', () => {
    const all = events()
    const batched = reduceEvents(initialRunState('a', N), all, 0)
    let single = initialRunState('b', N)
    for (const e of all) single = reduceEvents(single, [e], 0)
    expect(Array.from(single.grid.actions)).toEqual(Array.from(batched.grid.actions))
    expect(single.clusters).toEqual(batched.clusters)
  })

  it('bumps gridVersion only when a cell actually changes', () => {
    let s = initialRunState('r', 10)
    s = reduceEvents(s, [encodeJudged([1, 2], [1, 2])], 0)
    expect(s.gridVersion).toBe(1)
    s = reduceEvents(s, [encodeJudged([1, 2], [1, 2])], 0)
    expect(s.gridVersion).toBe(1)
    s = reduceEvents(s, [{ type: 'stage', name: 'ingest', status: 'started' }], 0)
    expect(s.gridVersion).toBe(1)
  })

  it('returns the same object for an empty batch', () => {
    const s = initialRunState('r', 10)
    expect(reduceEvents(s, [], 0)).toBe(s)
  })

  it('deduplicates clusters by cid (a reconnect replays history)', () => {
    const c: TimedEvent = { type: 'cluster', cid: 3, kind: 'semantic', size: 20, suspicion: 0.6, caption: 'x' }
    const s = reduceEvents(initialRunState('r', 10), [c, c, { ...c, cid: 4 }], 0)
    expect(s.clusters.map((x) => x.cid)).toEqual([3, 4])
  })

  it('grows the grid from counters.total and from out-of-range indices', () => {
    let s = initialRunState('r', 0)
    s = reduceEvents(
      s,
      [{ type: 'counters', keep: 0, down: 0, flag: 0, exclude: 0, processed: 0, total: 50, rps: 0, cost_usd: 0, elapsed_s: 0 }],
      0,
    )
    expect(s.grid.size).toBe(50)
    s = reduceEvents(s, [encodeJudged([80], [3])], 0)
    expect(s.grid.size).toBe(81)
    expect(s.grid.actions[80]).toBe(3)
  })

  it('caps the rating trail by thinning, keeping the latest point', () => {
    const ratings: TimedEvent[] = Array.from({ length: RATING_TRAIL_MAX * 3 }, (_, i) => ({
      type: 'rating',
      raw: 0.5,
      adjusted: i / 1000,
      ci: null,
      platform: null,
      platform_ci: null,
      n_eff: i,
      final: false,
      t: i,
    }))
    const s = reduceEvents(initialRunState('r', 1), ratings, 0)
    expect(s.ratingTrail.length).toBeLessThanOrEqual(RATING_TRAIL_MAX)
    expect(s.ratingTrail.at(-1)?.t).toBe(RATING_TRAIL_MAX * 3 - 1)
    const ts = s.ratingTrail.map((p) => p.t)
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
  })

  it('records an error event and stops in the error phase', () => {
    const s = reduceEvents(initialRunState('r', 1), [{ type: 'error', message: 'Jev quota', retryable: false }], 0)
    expect(s.phase).toBe('error')
    expect(s.error).toEqual({ message: 'Jev quota', retryable: false })
  })
})

describe('GridBuffer', () => {
  it('remembers the previous action and change time for the fade', () => {
    const g = new GridBuffer(4)
    g.apply([2], [1], 100)
    g.apply([2], [4], 200)
    expect(g.prev[2]).toBe(1)
    expect(g.actions[2]).toBe(4)
    expect(g.changedAt[2]).toBe(200)
    expect(g.drainDirty()).toEqual([2, 2])
    expect(g.drainDirty()).toEqual([])
    expect(g.counts()).toEqual([3, 0, 0, 0, 1])
  })

  it('loads a whole grid without animating it', () => {
    const g = new GridBuffer(2)
    g.load(new Uint8Array([1, 2, 3]))
    expect(g.size).toBe(3)
    expect(Array.from(g.prev)).toEqual([1, 2, 3])
    expect(g.changedAt[0]).toBe(-Infinity)
    expect(g.fullDirty).toBe(true)
  })
})

describe('useRunStore', () => {
  it('reset reuses the buffer, clears it and sizes it for the new run', () => {
    const store = useRunStore.getState()
    store.reset('one', 5)
    const grid = useRunStore.getState().grid
    store.ingest([encodeJudged([0], [2])], 0)
    expect(useRunStore.getState().grid.actions[0]).toBe(2)
    store.reset('two', 8)
    const s = useRunStore.getState()
    expect(s.grid).toBe(grid)
    expect(s.grid.size).toBe(8)
    expect(s.grid.actions[0]).toBe(0)
    expect(s.runId).toBe('two')
    expect(s.phase).toBe('connecting')
  })

  it('reset to a smaller run counts only that run as pending (no negative "decided")', () => {
    const store = useRunStore.getState()
    store.reset('big', 12)
    store.ingest([encodeJudged([0, 1, 2], [1, 1, 2])], 0)
    store.reset('small', 5)
    const s = useRunStore.getState()
    expect(s.grid.size).toBe(5)
    expect(s.tally).toEqual([5, 0, 0, 0, 0])
    store.ingest([encodeJudged([0, 1, 2, 3, 4], [1, 1, 2, 3, 4])], 0)
    expect(useRunStore.getState().tally).toEqual([0, 2, 1, 1, 1])
  })
})
