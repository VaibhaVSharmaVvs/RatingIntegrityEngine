import type { DatasetDetail, ReplayLine, RunOut } from '@/data/api'
import type { DataSource, RunStreamHandlers, TimedRunEvent } from '@/data/DataSource'
import { hourIndex, recordedRun } from './fixtures'

/** In-memory DataSource: one dataset, one finished run whose stream is the recorded fixture. */
export class FakeSource implements DataSource {
  readonly mode = 'live' as const
  readonly canStartRuns = true
  readonly lines: ReplayLine[]
  handlers: RunStreamHandlers | null = null
  unsubscribed = 0

  readonly n: number
  readonly runId: string
  readonly datasetId: string

  constructor(n = 1000, runId = 'run_fixture', datasetId = 'ds_fixture') {
    this.n = n
    this.runId = runId
    this.datasetId = datasetId
    this.lines = recordedRun(n)
  }

  dataset(): DatasetDetail {
    return {
      id: this.datasetId,
      name: 'Fixture game, May 2024',
      source: 'steam',
      rating_scale: 'binary',
      status: 'ready',
      error: null,
      n_reviews: this.n,
      created_at: '2024-06-01T00:00:00Z',
      source_params: {},
      histogram: [],
      timeline: [],
    }
  }

  run(): RunOut {
    const done = this.lines[this.lines.length - 1].event
    return {
      id: this.runId,
      dataset_id: this.datasetId,
      backend: 'mock',
      model_version: 'mock-1',
      status: 'done',
      error: null,
      config: { question_set: 'v2', thresholds: { cluster_penalty_threshold: 0.5, min_penalty_cluster_size: 10 } } as RunOut['config'],
      started_at: '2024-06-01T00:00:00Z',
      finished_at: '2024-06-01T00:00:02Z',
      summary: done.type === 'done' ? done.summary : null,
      cost_usd: 0,
      tokens_in: 0,
    }
  }

  listDatasets = async () => [this.dataset()]
  getDataset = async () => this.dataset()
  getHours = async () => hourIndex(this.n, 25)
  listRuns = async () => [this.run()]
  getRun = async () => this.run()
  createRun = async () => this.run()
  getGrid = async () => new Uint8Array(this.n)
  getClusters = async () => []
  getCluster = async (_runId: string, cid: number) => ({
    cluster_id: cid,
    kind: 'burst' as const,
    size: 2,
    t_start: null,
    t_end: null,
    suspicion: 0.8,
    factors: {},
    caption: '',
    top_phrases: [],
    window: {},
    hourly: [],
    actions: {},
    sample: [],
    member_ids: [1, 2],
  })
  getReview = async (_runId: string, reviewId: number) => ({
    review_id: reviewId,
    text: `Review ${reviewId}: the matchmaking is broken after the patch and support never answered.`,
    rating_raw: 0,
    rating_norm: 0,
    created_at: '2024-05-01T03:00:00Z',
    action: 'DOWNWEIGHT',
    weight: 0.4,
    integrity_score: 0.31,
    reasons: ['LOW_INFORMATIVENESS'],
  })
  getReplay = async () => this.lines

  subscribe(_runId: string, h: RunStreamHandlers) {
    this.handlers = h
    return () => {
      this.unsubscribed++
    }
  }

  /** Push the whole recording through the live stream, as the backend does for a finished run. */
  emitAll() {
    for (const l of this.lines) this.handlers?.onEvent({ ...l.event, t: l.t } as TimedRunEvent)
  }
}
