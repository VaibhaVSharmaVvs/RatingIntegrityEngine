import type { DatasetDetail, ReplayLine, ReviewDetail, ReviewPage, RunOut, RunScores } from '@/data/api'
import type { DataSource, ReviewFilter, RunStreamHandlers, TimedRunEvent } from '@/data/DataSource'
import { fixtureAction, hourIndex, recordedRun } from './fixtures'

const ACTIONS = ['PENDING', 'KEEP', 'DOWNWEIGHT', 'FLAG', 'EXCLUDE']

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
      config: {
        question_set: 'v4',
        samples_per_review: 1,
        bootstrap_resamples: 2000,
        weights: { KEEP: 1, DOWNWEIGHT: 0.25, FLAG: 1, EXCLUDE: 0 },
        thresholds: {
          downweight_below: 0.55,
          low_confidence: 0.5,
          w_informativeness: 0,
          w_rating_support: 0,
          w_spam: 0.2,
          w_templated: 0.15,
          w_offtopic: 0.1,
          w_offgame: 0.6,
          w_contradiction: 0.5,
          w_low_experience: 0.2,
          duplicate_action: 'DOWNWEIGHT',
          duplicate_in_burst_action: 'EXCLUDE',
          cluster_penalty_threshold: 0.5,
          cluster_penalty_strength: 0.5,
          min_penalty_cluster_size: 10,
        },
        suspicion: { factor_floor: 0.02 },
      } as unknown as RunOut['config'],
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
  getReview = async (_runId: string, reviewId: number): Promise<ReviewDetail> => ({
    review_id: reviewId,
    text: `Review ${reviewId}: the matchmaking is broken after the patch and support never answered.`,
    rating_raw: 0,
    rating_norm: 0,
    created_at: '2024-05-01T03:00:00Z',
    action: 'DOWNWEIGHT',
    weight: 0.25,
    integrity_score: 0.31,
    reasons: ['OFF_TOPIC', 'BURST_WINDOW'],
    base_integrity: 0.42,
    cluster_id: 7,
    cluster_suspicion: 0.82,
    cluster_kind: 'burst',
    cluster_caption: '100 reviews · 91% within 3 h',
    answers: {
      about_game: { type: 'noul', noul: 0.12, confidence: 0.9 },
      verdict_basis: { type: 'noul', noul: 0.08, confidence: 0.85 },
      rating_support: { type: 'score', score: 2, probabilities: { '0': 0.05, '1': 0.2, '2': 0.6, '3': 0.15 }, confidence: 0.6 },
      spam_promo: { type: 'noul', noul: 0.02 },
      templated: { type: 'noul', noul: 0.04 },
      informativeness: { type: 'score', score: 2, probabilities: { '0': 0.05, '1': 0.25, '2': 0.6, '3': 0.1 } },
    },
    signals: {
      n_tokens: 14,
      has_url: false,
      has_promo: false,
      promo_hits: [],
      duplicate_of: 3,
      duplicate_score: 0.91,
      nearest_review_id: 3,
      nearest_cosine: 0.97,
      low_playtime: true,
      single_review_account: false,
      received_for_free: false,
      key_activation: false,
    },
    meta: {
      playtime_hours: 0.4,
      author_num_reviews: 3,
      steam_purchase: true,
      received_for_free: false,
      votes_up: 12,
      edited: true,
      updated_at: '2024-05-09T10:00:00Z',
    },
    counts_in_platform_rating: false,
  })
  listReviews = async (_runId: string, f: ReviewFilter = {}): Promise<ReviewPage> => {
    const all = Array.from({ length: this.n }, (_, i) => i).filter(
      (i) => !f.action || ACTIONS[fixtureAction(i, this.n)] === f.action,
    )
    const offset = f.offset ?? 0
    return {
      total: all.length,
      offset,
      items: all.slice(offset, offset + (f.limit ?? 50)).map((i) => ({
        review_id: i,
        created_at: '2024-05-01T03:00:00Z',
        rating_norm: i % 3 ? 1 : 0,
        action: ACTIONS[fixtureAction(i, this.n)],
        weight: fixtureAction(i, this.n) === 2 ? 0.25 : 1,
        integrity_score: fixtureAction(i, this.n) === 2 ? 0.4 : 0.9,
        reasons: fixtureAction(i, this.n) === 2 ? ['OFF_TOPIC'] : [],
        snippet: `Review ${i} snippet`,
      })),
    }
  }
  getScores = async (): Promise<RunScores> => {
    const action = Array.from({ length: this.n }, (_, i) => fixtureAction(i, this.n))
    return {
      rating_norm: action.map((a, i) => (a === 2 ? 0 : i % 3 ? 1 : 0)),
      integrity: action.map((a) => (a === 2 ? 0.4 : 0.9)),
      base_integrity: action.map((a) => (a === 2 ? 0.5 : 0.9)),
      action,
      primary_reason: action.map((a) => (a === 2 ? 0 : a === 4 ? 2 : -1)),
      reason_codes: ['OFF_TOPIC', 'NEAR_DUPLICATE', 'SPAM'],
      counts_in_platform: action.map((a) => a !== 2),
      weights: { KEEP: 1, DOWNWEIGHT: 0.25, FLAG: 1, EXCLUDE: 0 },
      downweight_below: 0.55,
    }
  }
  exportUrl = (runId: string, fmt: 'csv' | 'json') => `/api/runs/${runId}/export?fmt=${fmt}`
  preflight = async () => ({
    backend: 'jev',
    reviews: this.n,
    calls: this.n,
    est_input_tokens: this.n * 1528,
    est_cost_usd: 0.064,
    est_seconds: 25,
    limit_usd: 2,
    needs_confirmation: false,
  })
  getUploadLimits = async () => ({ max_mb: 50, max_rows: 200_000 })
  previewCsv = async () => ({
    columns: ['body', 'stars', 'date'],
    n_rows: 3,
    rows: [{ body: 'Great', stars: 5, date: '2024-01-01' }],
    rating_scale_guesses: { stars: '1-5' },
  })
  uploadCsv = async () => this.dataset()
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
