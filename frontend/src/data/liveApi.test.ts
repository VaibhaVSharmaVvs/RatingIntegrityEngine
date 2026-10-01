import { encodeJudged } from '@/test/fixtures'
import type { TimedRunEvent } from './DataSource'
import { gunzipIfNeeded, LiveApi, parseReplay } from './liveApi'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 0
  closed = false
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  listeners = new Map<string, ((m: { data: string }) => void)[]>()
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (m: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  send(type: string, payload: object) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(payload) })
  }
}

function api(fetchFn: typeof fetch = vi.fn()) {
  return new LiveApi('/api', fetchFn, (url) => new FakeEventSource(url) as unknown as EventSource)
}

describe('LiveApi.subscribe', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', { CLOSED: 2 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('forwards typed events with their offsets and closes after done', () => {
    const got: TimedRunEvent[] = []
    api().subscribe('run_1', { onEvent: (e) => got.push(e) })
    const es = FakeEventSource.instances[0]
    expect(es.url).toBe('/api/runs/run_1/events')
    es.send('judged', { t: 0.5, ...encodeJudged([1], [2]) })
    es.send('done', { t: 1, type: 'done', summary: {} })
    expect(got.map((e) => [e.type, e.t])).toEqual([
      ['judged', 0.5],
      ['done', 1],
    ])
    expect(es.closed).toBe(true) // no auto-reconnect that would replay the run again
    es.send('counters', { t: 2, type: 'counters' })
    expect(got).toHaveLength(2)
  })

  it('signals a reset when the stream reconnects (history is resent)', () => {
    const onReset = vi.fn()
    api().subscribe('run_1', { onEvent: () => {}, onReset })
    const es = FakeEventSource.instances[0]
    es.onopen?.()
    expect(onReset).not.toHaveBeenCalled()
    es.onopen?.()
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('reports a connection the browser has given up on', () => {
    const onError = vi.fn()
    api().subscribe('run_1', { onEvent: () => {}, onError })
    const es = FakeEventSource.instances[0]
    es.readyState = 0
    es.onerror?.() // still retrying
    expect(onError).not.toHaveBeenCalled()
    es.readyState = 2
    es.onerror?.()
    expect(onError).toHaveBeenCalledOnce()
  })
})

describe('LiveApi REST', () => {
  it('surfaces FastAPI error details', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ detail: 'run x not found' }), { status: 404 }))
    await expect(api(fetchFn as unknown as typeof fetch).getRun('x')).rejects.toMatchObject({
      status: 404,
      message: 'run x not found',
    })
  })

  it('reads the binary grid', async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([0, 1, 4])))
    expect(Array.from(await api(fetchFn as unknown as typeof fetch).getGrid('r'))).toEqual([0, 1, 4])
  })
})

describe('replay parsing', () => {
  const text = '{"t":0,"event":{"type":"stage","name":"ingest","status":"started"}}\n\n{"t":1.5,"event":{"type":"done","summary":{}}}\n'

  it('parses jsonl and skips blank lines', () => {
    expect(parseReplay(text).map((l) => l.t)).toEqual([0, 1.5])
  })

  it('passes plain text through and inflates gzip', async () => {
    expect(await gunzipIfNeeded(new TextEncoder().encode(text))).toBe(text)
    const gz = new Uint8Array(await new Response(new Response(text).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    expect(gz[0]).toBe(0x1f)
    expect(await gunzipIfNeeded(gz)).toBe(text)
  })
})
