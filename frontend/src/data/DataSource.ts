// One interface, two implementations (MVP_SPEC §9):
// LiveApi for local development, StaticBundle for the replay-only public build.
import type {
  BenchmarkOut,
  ClusterDetail,
  ClusterOut,
  CsvPreview,
  DatasetDetail,
  DatasetOut,
  HourIndex,
  LabelSet,
  LabelSetSummary,
  PreflightOut,
  ReplayLine,
  ReviewDetail,
  ReviewPage,
  RunCreate,
  RunOut,
  RunScores,
  UploadLimits,
} from './api'
import type { RunEvent } from './events'

export type DataSourceMode = 'live' | 'static'

export const dataSourceMode: DataSourceMode = import.meta.env.MODE === 'static' ? 'static' : 'live'

export type TimedRunEvent = RunEvent & { t: number }

export interface RunStreamHandlers {
  onEvent: (e: TimedRunEvent) => void
  /** the stream restarted from the beginning (reconnect): drop what you have */
  onReset?: () => void
  /** transport failure that will not recover on its own */
  onError?: (message: string) => void
}

/** Filters for the reviews table (GET /runs/{id}/reviews). */
export interface ReviewFilter {
  action?: 'KEEP' | 'DOWNWEIGHT' | 'FLAG' | 'EXCLUDE'
  reason?: string
  cluster?: number
  verdict?: 'positive' | 'negative'
  q?: string
  sort?: 'time' | 'integrity'
  limit?: number
  offset?: number
}

/** The CSV column mapper's output (backend csv_loader.ColumnMapping). */
export interface ColumnMapping {
  text: string
  rating: string
  timestamp?: string | null
  author?: string | null
  ext_id?: string | null
  extras?: string[]
}

export interface DataSource {
  readonly mode: DataSourceMode
  /** false in the static build: no uploads, fetches or new runs */
  readonly canStartRuns: boolean
  listDatasets(): Promise<DatasetOut[]>
  getDataset(id: string): Promise<DatasetDetail>
  getHours(datasetId: string): Promise<HourIndex>
  listRuns(): Promise<RunOut[]>
  getRun(id: string): Promise<RunOut>
  createRun(req: RunCreate): Promise<RunOut>
  /** Uint8 action codes in grid order */
  getGrid(runId: string): Promise<Uint8Array>
  getClusters(runId: string, kind?: ClusterOut['kind']): Promise<ClusterOut[]>
  /** `sample`: how many member reviews to include with text (0 = ids only) */
  getCluster(runId: string, cid: number, sample?: number): Promise<ClusterDetail>
  getReview(runId: string, reviewId: number): Promise<ReviewDetail>
  listReviews(runId: string, filter?: ReviewFilter): Promise<ReviewPage>
  /** per-review arrays of a finished run, for the results-page sliders and waterfall */
  getScores(runId: string): Promise<RunScores>
  /** download link for a run's decisions; null where export is not offered */
  exportUrl(runId: string, fmt: 'csv' | 'json'): string | null
  /** cost and time estimate for a run before it starts */
  preflight(req: RunCreate): Promise<PreflightOut>
  /** size and row caps for CSV / XLSX uploads */
  getUploadLimits(): Promise<UploadLimits>
  /** Phase 7: recorded benchmark results */
  listBenchmarks(): Promise<BenchmarkOut[]>
  /** blind human labelling (local only) */
  listLabelSets(): Promise<LabelSetSummary[]>
  getLabelSet(name: string, rater: string): Promise<LabelSet>
  putLabel(name: string, reviewId: number, rater: string, label: Record<string, string>): Promise<void>
  previewCsv(file: File): Promise<CsvPreview>
  uploadCsv(file: File, name: string, mapping: ColumnMapping, ratingScale?: string): Promise<DatasetOut>
  /** the recorded event stream of a finished run */
  getReplay(runId: string): Promise<ReplayLine[]>
  /** live events (history first); returns an unsubscribe function */
  subscribe(runId: string, handlers: RunStreamHandlers): () => void
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}
