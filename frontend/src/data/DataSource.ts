// One interface, two implementations (MVP_SPEC §9):
// LiveApi for local development, StaticBundle for the replay-only public build.
import type {
  ClusterDetail,
  ClusterOut,
  DatasetDetail,
  DatasetOut,
  HourIndex,
  ReplayLine,
  ReviewDetail,
  RunCreate,
  RunOut,
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
  getCluster(runId: string, cid: number): Promise<ClusterDetail>
  getReview(runId: string, reviewId: number): Promise<ReviewDetail>
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
