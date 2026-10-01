import type {
  ClusterDetail,
  ClusterOut,
  CsvPreview,
  DatasetDetail,
  DatasetOut,
  HourIndex,
  PreflightOut,
  ReplayLine,
  ReviewDetail,
  ReviewPage,
  RunCreate,
  RunOut,
  RunScores,
} from './api'
import {
  ApiError,
  type ColumnMapping,
  type DataSource,
  type ReviewFilter,
  type RunStreamHandlers,
  type TimedRunEvent,
} from './DataSource'

export const RUN_EVENT_TYPES = [
  'stage',
  'features_done',
  'judged',
  'counters',
  'rating',
  'cluster',
  'done',
  'error',
] as const

type EventSourceFactory = (url: string) => EventSource

/** REST + EventSource against the FastAPI backend. In dev, Vite proxies `/api` to :8001. */
export class LiveApi implements DataSource {
  readonly mode = 'live' as const
  readonly canStartRuns = true
  private readonly base: string
  private readonly fetchFn: typeof fetch
  private readonly makeEventSource: EventSourceFactory

  constructor(
    base: string = import.meta.env.VITE_API_BASE ?? '/api',
    fetchFn: typeof fetch = (...a) => fetch(...a),
    makeEventSource: EventSourceFactory = (url) => new EventSource(url),
  ) {
    this.base = base.replace(/\/$/, '')
    this.fetchFn = fetchFn
    this.makeEventSource = makeEventSource
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchFn(`${this.base}${path}`, init)
    if (!res.ok) {
      let detail: unknown = null
      try {
        detail = (await res.json()).detail
      } catch {
        /* not JSON */
      }
      const message =
        typeof detail === 'string'
          ? detail
          : detail && typeof detail === 'object' && 'message' in detail
            ? String((detail as { message: unknown }).message)
            : `${res.status} ${res.statusText}`
      throw new ApiError(res.status, message, detail)
    }
    return res
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request(path, init)).json() as Promise<T>
  }

  listDatasets = () => this.json<DatasetOut[]>('/datasets')
  getDataset = (id: string) => this.json<DatasetDetail>(`/datasets/${encodeURIComponent(id)}`)
  getHours = (id: string) => this.json<HourIndex>(`/datasets/${encodeURIComponent(id)}/hours`)
  listRuns = () => this.json<RunOut[]>('/runs')
  getRun = (id: string) => this.json<RunOut>(`/runs/${encodeURIComponent(id)}`)

  createRun = (req: RunCreate) =>
    this.json<RunOut>('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })

  getGrid = async (runId: string) =>
    new Uint8Array(await (await this.request(`/runs/${encodeURIComponent(runId)}/grid`)).arrayBuffer())

  getClusters = (runId: string, kind?: ClusterOut['kind']) =>
    this.json<ClusterOut[]>(`/runs/${encodeURIComponent(runId)}/clusters${kind ? `?kind=${kind}` : ''}`)

  getCluster = (runId: string, cid: number, sample = 0) =>
    this.json<ClusterDetail>(`/runs/${encodeURIComponent(runId)}/clusters/${cid}?sample=${sample}`)

  getReview = (runId: string, reviewId: number) =>
    this.json<ReviewDetail>(`/runs/${encodeURIComponent(runId)}/reviews/${reviewId}`)

  listReviews = (runId: string, filter: ReviewFilter = {}) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v))
    const tail = qs.toString() ? `?${qs}` : ''
    return this.json<ReviewPage>(`/runs/${encodeURIComponent(runId)}/reviews${tail}`)
  }

  getScores = (runId: string) => this.json<RunScores>(`/runs/${encodeURIComponent(runId)}/scores`)

  exportUrl = (runId: string, fmt: 'csv' | 'json') => `${this.base}/runs/${encodeURIComponent(runId)}/export?fmt=${fmt}`

  preflight = (req: RunCreate) =>
    this.json<PreflightOut>('/runs/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })

  previewCsv = (file: File) => {
    const body = new FormData()
    body.set('file', file)
    return this.json<CsvPreview>('/datasets/csv/preview', { method: 'POST', body })
  }

  uploadCsv = (file: File, name: string, mapping: ColumnMapping, ratingScale?: string) => {
    const body = new FormData()
    body.set('file', file)
    body.set('name', name)
    body.set('mapping', JSON.stringify(mapping))
    if (ratingScale) body.set('rating_scale', ratingScale)
    return this.json<DatasetOut>('/datasets/csv', { method: 'POST', body })
  }

  getReplay = async (runId: string): Promise<ReplayLine[]> => {
    const res = await this.request(`/runs/${encodeURIComponent(runId)}/replay`)
    return parseReplay(await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer())))
  }

  subscribe(runId: string, h: RunStreamHandlers): () => void {
    const es = this.makeEventSource(`${this.base}/runs/${encodeURIComponent(runId)}/events`)
    let opens = 0
    let closed = false
    const close = () => {
      closed = true
      es.close()
    }
    // The backend sends the full history on every connection, so a reconnect restarts the stream.
    es.onopen = () => {
      if (opens++ > 0) h.onReset?.()
    }
    es.onerror = () => {
      // CLOSED means the browser gave up; CONNECTING means it is retrying by itself.
      if (!closed && es.readyState === EventSource.CLOSED) h.onError?.('Lost the connection to the event stream.')
    }
    for (const type of RUN_EVENT_TYPES) {
      es.addEventListener(type, (msg) => {
        if (closed) return
        const event = JSON.parse((msg as MessageEvent<string>).data) as TimedRunEvent
        h.onEvent(event) // the payload carries its own `type` and `t`
        // Without this, EventSource would reconnect after the server ends the stream
        // and replay the whole run again.
        if (type === 'done' || type === 'error') close()
      })
    }
    return close
  }
}

export function parseReplay(text: string): ReplayLine[] {
  const out: ReplayLine[] = []
  for (const line of text.split('\n')) if (line.trim()) out.push(JSON.parse(line) as ReplayLine)
  return out
}

/** The replay endpoint serves `application/gzip` without Content-Encoding, so inflate it here. */
export async function gunzipIfNeeded(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes)
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
