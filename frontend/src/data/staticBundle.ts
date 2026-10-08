import type {
  BenchmarkOut,
  ClusterDetail,
  ClusterOut,
  DatasetDetail,
  DatasetOut,
  HourIndex,
  ReplayLine,
  ReviewDetail,
  ReviewPage,
  ReviewRow,
  RunOut,
  RunScores,
} from './api'
import type { DataSource, ReviewFilter, RunStreamHandlers, TimedRunEvent } from './DataSource'
import { gunzipIfNeeded, parseReplay } from './liveApi'

const CHUNK = 1000 // reviews per detail file (tools/export_bundle.py)
/** A missing file on a single-page-app host comes back as index.html with 200, not 404. */
const isMissing = (r: Response) => !r.ok || (r.headers.get('content-type') ?? '').startsWith('text/html')
const readOnly = (what: string) => () => Promise.reject(new Error(`${what} is not available in the public demo: runs are pre-recorded.`))

interface BundleIndex {
  exported_at: string
  games: { key: string; runId: string }[]
}

/**
 * Replay-only data source for the public build: the showcase runs exported to static
 * files by tools/export_bundle.py. No backend, no API key; anything that would start a
 * run, spend money or upload data is refused.
 */
export class StaticBundle implements DataSource {
  readonly mode = 'static' as const
  readonly canStartRuns = false
  private readonly base: string
  private readonly cache = new Map<string, Promise<unknown>>()

  constructor(base: string = `${import.meta.env.BASE_URL}bundle`) {
    this.base = base.replace(/\/$/, '')
  }

  private get<T>(path: string): Promise<T> {
    let p = this.cache.get(path) as Promise<T> | undefined
    if (!p) {
      p = fetch(`${this.base}/${path}`).then((r) => {
        if (isMissing(r)) throw new Error(`${path}: not found (${r.status})`)
        return r.json() as Promise<T>
      })
      p.catch(() => this.cache.delete(path)) // a failed fetch can be retried
      this.cache.set(path, p)
    }
    return p
  }

  private index = () => this.get<BundleIndex>('index.json')

  listRuns = async () => Promise.all((await this.index()).games.map((g) => this.getRun(g.runId)))
  listDatasets = async () => {
    const runs = await this.listRuns()
    return Promise.all(runs.map((r) => this.get<DatasetOut>(`datasets/${r.dataset_id}.json`)))
  }
  getRun = (id: string) => this.get<RunOut>(`runs/${encodeURIComponent(id)}/run.json`)
  getDataset = (id: string) => this.get<DatasetDetail>(`datasets/${encodeURIComponent(id)}.json`)
  getHours = (id: string) => this.get<HourIndex>(`datasets/${encodeURIComponent(id)}.hours.json`)

  getGrid = async (runId: string) => {
    const s = await this.getScores(runId)
    return Uint8Array.from(s.action)
  }

  getClusters = async (runId: string, kind?: ClusterOut['kind']) => {
    const all = await this.get<ClusterOut[]>(`runs/${encodeURIComponent(runId)}/clusters.json`)
    return kind ? all.filter((c) => c.kind === kind) : all
  }
  getCluster = (runId: string, cid: number) => this.get<ClusterDetail>(`runs/${encodeURIComponent(runId)}/clusters/${cid}.json`)

  getReview = async (runId: string, reviewId: number) => {
    const chunk = await this.get<ReviewDetail[]>(`runs/${encodeURIComponent(runId)}/reviews/${Math.floor(reviewId / CHUNK)}.json`)
    const r = chunk[reviewId % CHUNK]
    if (!r || r.review_id !== reviewId) throw new Error(`review ${reviewId} not found`)
    return r
  }

  /** The reviews table, filtered in the browser over the exported index. */
  listReviews = async (runId: string, f: ReviewFilter = {}): Promise<ReviewPage> => {
    let rows = await this.get<ReviewRow[]>(`runs/${encodeURIComponent(runId)}/rows.json`)
    if (f.action) rows = rows.filter((r) => r.action === f.action)
    if (f.reason) rows = rows.filter((r) => r.reasons.includes(f.reason!))
    if (f.verdict) rows = rows.filter((r) => r.rating_norm != null && (f.verdict === 'positive') === r.rating_norm >= 0.5)
    if (f.q) {
      const q = f.q.toLowerCase()
      rows = rows.filter((r) => r.snippet.toLowerCase().includes(q)) // the index keeps the first 220 characters
    }
    if (f.cluster != null) {
      const members = new Set((await this.getCluster(runId, f.cluster)).member_ids)
      rows = rows.filter((r) => members.has(r.review_id))
    }
    if (f.sort === 'integrity') {
      rows = [...rows].sort((a, b) => (a.integrity_score ?? 2) - (b.integrity_score ?? 2) || a.review_id - b.review_id)
    }
    const offset = f.offset ?? 0
    return { total: rows.length, offset, items: rows.slice(offset, offset + (f.limit ?? 50)) }
  }

  getScores = (runId: string) => this.get<RunScores>(`runs/${encodeURIComponent(runId)}/scores.json`)
  exportUrl = () => null
  listBenchmarks = () => this.get<BenchmarkOut[]>('benchmarks.json')

  getReplay = async (runId: string): Promise<ReplayLine[]> => {
    const res = await fetch(`${this.base}/runs/${encodeURIComponent(runId)}/replay.jsonl.gz`)
    if (isMissing(res)) throw new Error(`replay ${runId}: not found (${res.status})`)
    // some hosts serve .gz with Content-Encoding (already inflated), others as raw bytes
    return parseReplay(await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer())))
  }

  /** A finished run "streamed live" (e.g. Skip to end): the whole recording at once. */
  subscribe(runId: string, h: RunStreamHandlers): () => void {
    let closed = false
    this.getReplay(runId)
      .then((lines) => {
        for (const l of lines) {
          if (closed) return
          h.onEvent({ ...l.event, t: l.t } as TimedRunEvent)
        }
      })
      .catch((e: Error) => !closed && h.onError?.(e.message))
    return () => {
      closed = true
    }
  }

  createRun = readOnly('Starting a run')
  preflight = readOnly('The cost estimate')
  getUploadLimits = readOnly('Uploading')
  previewCsv = readOnly('Uploading')
  uploadCsv = readOnly('Uploading')
  listLabelSets = readOnly('Labelling')
  getLabelSet = readOnly('Labelling')
  putLabel = readOnly('Labelling')
}
