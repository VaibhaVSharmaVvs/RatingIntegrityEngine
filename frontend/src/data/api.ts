/* Generated from backend/app/models.py by tools/export_types.py. Do not edit. */

/**
 * Grid byte per review: 0=PENDING, 1=KEEP, 2=DOWNWEIGHT, 3=FLAG, 4=EXCLUDE
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ActionCode".
 */
export type ActionCode = 0 | 1 | 2 | 3 | 4;

export interface RIEAPI {
  "ActionWeights-Input"?: ActionWeights;
  "ActionWeights-Output"?: ActionWeights1;
  BenchmarkOut?: BenchmarkOut;
  "BurstConfig-Input"?: BurstConfig;
  "BurstConfig-Output"?: BurstConfig1;
  "ClusterConfig-Input"?: ClusterConfig;
  "ClusterConfig-Output"?: ClusterConfig1;
  ClusterDetail?: ClusterDetail;
  ClusterEvent?: ClusterEvent;
  ClusterOut?: ClusterOut;
  ClusterReview?: ClusterReview;
  CorpusSummary?: CorpusSummary;
  CountersEvent?: CountersEvent;
  CsvPreview?: CsvPreview;
  DatasetDetail?: DatasetDetail;
  DatasetOut?: DatasetOut;
  DoneEvent?: DoneEvent;
  ErrorEvent?: ErrorEvent;
  ExcludedWindowOut?: ExcludedWindowOut;
  "FeatureConfig-Input"?: FeatureConfig;
  "FeatureConfig-Output"?: FeatureConfig1;
  FeaturesDoneEvent?: FeaturesDoneEvent;
  HistogramBin?: HistogramBin;
  HourIndex?: HourIndex;
  JudgedEvent?: JudgedEvent;
  LabelIn?: LabelIn;
  LabelItem?: LabelItem;
  LabelSet?: LabelSet;
  LabelSetSummary?: LabelSetSummary;
  "PlatformPolicyConfig-Input"?: PlatformPolicyConfig;
  "PlatformPolicyConfig-Output"?: PlatformPolicyConfig1;
  PlatformSummary?: PlatformSummary;
  "PolicyThresholds-Input"?: PolicyThresholds;
  "PolicyThresholds-Output"?: PolicyThresholds1;
  PreflightOut?: PreflightOut;
  RatingEvent?: RatingEvent;
  ReplayLine?: ReplayLine;
  ReviewDetail?: ReviewDetail;
  ReviewMeta?: ReviewMeta;
  ReviewPage?: ReviewPage;
  ReviewRow?: ReviewRow;
  ReviewSignals?: ReviewSignals;
  "RunCreate-Input"?: RunCreate;
  "RunCreate-Output"?: RunCreate1;
  RunOut?: RunOut;
  RunScores?: RunScores;
  RunSummary?: RunSummary;
  StageEvent?: StageEvent;
  SteamFetchRequest?: SteamFetchRequest;
  "SuspicionConfig-Input"?: SuspicionConfig2;
  "SuspicionConfig-Output"?: SuspicionConfig3;
  TimelineBucket?: TimelineBucket;
  UploadLimits?: UploadLimits;
  ActionCode?: ActionCode;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ActionWeights-Input".
 */
export interface ActionWeights {
  KEEP?: number;
  DOWNWEIGHT?: number;
  FLAG?: number;
  EXCLUDE?: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ActionWeights-Output".
 */
export interface ActionWeights1 {
  KEEP: number;
  DOWNWEIGHT: number;
  FLAG: number;
  EXCLUDE: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "BenchmarkOut".
 */
export interface BenchmarkOut {
  kind: "attack" | "control" | "agreement" | "adversarial" | "ablation";
  name: string;
  backend: string | null;
  question_set: string | null;
  run_ids: string[];
  metrics: {
    [k: string]: unknown;
  };
  cost_usd: number;
  notes: string | null;
  id: string;
  created_at: string;
}
/**
 * S3 burst detection (MVP_SPEC §6.4). Calibrated on HD2 / CS2 (MEASUREMENTS M9).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "BurstConfig-Input".
 */
export interface BurstConfig {
  baseline_hours?: number;
  min_history_hours?: number;
  z_threshold?: number;
  min_scale?: number;
  min_hour_count?: number;
  merge_gap_hours?: number;
  min_burst_reviews?: number;
  min_daily_reviews?: number;
  min_segment_days?: number;
  change_point_penalty?: number;
}
/**
 * S3 burst detection (MVP_SPEC §6.4). Calibrated on HD2 / CS2 (MEASUREMENTS M9).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "BurstConfig-Output".
 */
export interface BurstConfig1 {
  baseline_hours: number;
  min_history_hours: number;
  z_threshold: number;
  min_scale: number;
  min_hour_count: number;
  merge_gap_hours: number;
  min_burst_reviews: number;
  min_daily_reviews: number;
  min_segment_days: number;
  change_point_penalty: number;
}
/**
 * S3 clusters (MVP_SPEC §6.4).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ClusterConfig-Input".
 */
export interface ClusterConfig {
  umap_min_reviews?: number;
  umap_neighbors?: number;
  umap_components?: number;
  umap_min_dist?: number;
  hdbscan_min_cluster_size?: number;
  hdbscan_min_samples?: number | null;
  dup_min_size?: number;
  top_phrases?: number;
  seed?: number;
}
/**
 * S3 clusters (MVP_SPEC §6.4).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ClusterConfig-Output".
 */
export interface ClusterConfig1 {
  umap_min_reviews: number;
  umap_neighbors: number;
  umap_components: number;
  umap_min_dist: number;
  hdbscan_min_cluster_size: number;
  hdbscan_min_samples: number | null;
  dup_min_size: number;
  top_phrases: number;
  seed: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ClusterDetail".
 */
export interface ClusterDetail {
  cluster_id: number;
  kind: "semantic" | "duplicate" | "burst";
  size: number;
  t_start: string | null;
  t_end: string | null;
  suspicion: number;
  factors: {
    [k: string]: number | null;
  };
  caption: string;
  top_phrases: string[];
  window: {
    [k: string]: unknown;
  };
  hourly: {
    [k: string]: unknown;
  }[];
  actions: {
    [k: string]: number;
  };
  sample: ClusterReview[];
  member_ids: number[];
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ClusterReview".
 */
export interface ClusterReview {
  review_id: number;
  text: string;
  rating_norm: number | null;
  created_at: string | null;
  action: string | null;
  reasons: string[];
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ClusterEvent".
 */
export interface ClusterEvent {
  type: "cluster";
  cid: number;
  kind: "semantic" | "duplicate" | "burst";
  size: number;
  suspicion: number;
  caption: string;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ClusterOut".
 */
export interface ClusterOut {
  cluster_id: number;
  kind: "semantic" | "duplicate" | "burst";
  size: number;
  t_start: string | null;
  t_end: string | null;
  suspicion: number;
  factors: {
    [k: string]: number | null;
  };
  caption: string;
  top_phrases: string[];
  window: {
    [k: string]: unknown;
  };
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "CorpusSummary".
 */
export interface CorpusSummary {
  clusters: {
    [k: string]: number;
  };
  suspicious_clusters: number;
  change_points: string[];
  penalised_reviews: number;
  actions_changed_by_clusters: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "CountersEvent".
 */
export interface CountersEvent {
  type: "counters";
  keep: number;
  down: number;
  flag: number;
  exclude: number;
  processed: number;
  total: number;
  rps: number;
  cost_usd: number;
  elapsed_s: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "CsvPreview".
 */
export interface CsvPreview {
  columns: string[];
  n_rows: number;
  rows: {
    [k: string]: unknown;
  }[];
  rating_scale_guesses: {
    [k: string]: string;
  };
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "DatasetDetail".
 */
export interface DatasetDetail {
  id: string;
  name: string;
  source: string;
  rating_scale: string;
  status: string;
  error: string | null;
  n_reviews: number;
  created_at: string;
  source_params: {
    [k: string]: unknown;
  };
  histogram: HistogramBin[];
  timeline: TimelineBucket[];
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "HistogramBin".
 */
export interface HistogramBin {
  rating: number;
  count: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "TimelineBucket".
 */
export interface TimelineBucket {
  day: string;
  count: number;
  mean_rating: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "DatasetOut".
 */
export interface DatasetOut {
  id: string;
  name: string;
  source: string;
  rating_scale: string;
  status: string;
  error: string | null;
  n_reviews: number;
  created_at: string;
  source_params: {
    [k: string]: unknown;
  };
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "DoneEvent".
 */
export interface DoneEvent {
  type: "done";
  summary: RunSummary;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "RunSummary".
 */
export interface RunSummary {
  n_reviews: number;
  counts: {
    [k: string]: number;
  };
  raw: number;
  adjusted: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  ci: [number, number];
  n_eff: number;
  rating_scale: string;
  steam_label_raw: string | null;
  steam_label_adjusted: string | null;
  cost_usd: number;
  tokens_in: number;
  elapsed_s: number;
  reviews_per_s: number;
  model_version: string | null;
  timings_s: {
    [k: string]: number;
  };
  reused_judgments: number;
  requests: number;
  retries: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  embedding_cache_hit: boolean | null;
  corpus: CorpusSummary1;
  platform: PlatformSummary | null;
}
export interface CorpusSummary1 {
  clusters: {
    [k: string]: number;
  };
  suspicious_clusters: number;
  change_points: string[];
  penalised_reviews: number;
  actions_changed_by_clusters: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "PlatformSummary".
 */
export interface PlatformSummary {
  rating: number | null;
  ci: [number, number] | null;
  counted: number;
  key_activations_removed: number;
  windows: ExcludedWindowOut[];
  basis: string;
  steam_label: string | null;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ExcludedWindowOut".
 */
export interface ExcludedWindowOut {
  start: string;
  end: string;
  negatives: number;
  offtopic_share: number;
  reviews_removed: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ErrorEvent".
 */
export interface ErrorEvent {
  type: "error";
  message: string;
  retryable: boolean;
}
/**
 * S1 deterministic features (MVP_SPEC §6.2).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "FeatureConfig-Input".
 */
export interface FeatureConfig {
  shingle_unit?: "char" | "word";
  shingle_size?: number;
  minhash_perm?: number;
  near_dup_jaccard?: number;
  lsh_candidate_jaccard?: number;
  dup_min_tokens?: number;
  low_info_max_tokens?: number;
  embedding_model?: string;
  embedding_max_seq_len?: number;
  low_playtime_minutes?: number;
  strip_influence?: boolean;
}
/**
 * S1 deterministic features (MVP_SPEC §6.2).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "FeatureConfig-Output".
 */
export interface FeatureConfig1 {
  shingle_unit: "char" | "word";
  shingle_size: number;
  minhash_perm: number;
  near_dup_jaccard: number;
  lsh_candidate_jaccard: number;
  dup_min_tokens: number;
  low_info_max_tokens: number;
  embedding_model: string;
  embedding_max_seq_len: number;
  low_playtime_minutes: number;
  strip_influence: boolean;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "FeaturesDoneEvent".
 */
export interface FeaturesDoneEvent {
  type: "features_done";
  counts: {
    [k: string]: number;
  };
  timings_s: {
    [k: string]: number;
  };
}
/**
 * Hourly buckets in grid order: reviews `starts[i] .. starts[i] + counts[i] - 1` fall in
 * `hours[i]`. Grid indices are chronological, so each bucket is one contiguous run.
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "HourIndex".
 */
export interface HourIndex {
  hours: (string | null)[];
  starts: number[];
  counts: number[];
}
/**
 * Per-review actions. Decoding: indices = Uint32Array (little-endian) from base64
 * `indices_b64`; actions = Uint8Array from `actions_b64`; same length. A review can
 * appear again later (S4 cluster rules update it): the last update wins.
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "JudgedEvent".
 */
export interface JudgedEvent {
  type: "judged";
  indices_b64: string;
  actions_b64: string;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "LabelIn".
 */
export interface LabelIn {
  rater: string;
  label: {
    [k: string]: string;
  };
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "LabelItem".
 */
export interface LabelItem {
  review_id: number;
  text: string;
  recommended: boolean;
  label: {
    [k: string]: string;
  } | null;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "LabelSet".
 */
export interface LabelSet {
  name: string;
  subject: string;
  items: LabelItem[];
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "LabelSetSummary".
 */
export interface LabelSetSummary {
  name: string;
  size: number;
  labelled: {
    [k: string]: number;
  };
}
/**
 * Steam's review-score rules, emulated (app/decide/platform.py).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "PlatformPolicyConfig-Input".
 */
export interface PlatformPolicyConfig {
  purchasers_only?: boolean;
  offtopic_window_share?: number;
  min_judged_negatives?: number;
  extend_windows?: boolean;
  extend_min_daily_negatives?: number;
  extend_max_days?: number;
}
/**
 * Steam's review-score rules, emulated (app/decide/platform.py).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "PlatformPolicyConfig-Output".
 */
export interface PlatformPolicyConfig1 {
  purchasers_only: boolean;
  offtopic_window_share: number;
  min_judged_negatives: number;
  extend_windows: boolean;
  extend_min_daily_negatives: number;
  extend_max_days: number;
}
/**
 * Every number the decision policy uses (MVP_SPEC §6.5). Nothing is hard-coded.
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "PolicyThresholds-Input".
 */
export interface PolicyThresholds {
  downweight_below?: number;
  low_confidence?: number;
  low_confidence_min_questions?: number;
  spam_exclude?: number;
  w_informativeness?: number;
  w_rating_support?: number;
  w_spam?: number;
  w_templated?: number;
  w_offtopic?: number;
  w_offgame?: number;
  w_contradiction?: number;
  w_low_experience?: number;
  w_influence?: number;
  influence_floor?: number;
  model_note_action?: "EXCLUDE" | "FLAG" | "DOWNWEIGHT";
  reason_min_contribution?: number;
  duplicate_action?: "EXCLUDE" | "DOWNWEIGHT";
  cluster_penalty_threshold?: number;
  cluster_penalty_strength?: number;
  min_penalty_cluster_size?: number;
  cluster_penalty_kinds?: ("burst" | "duplicate" | "semantic")[];
  semantic_penalty_scope?: "all" | "bursts";
  grey_zone_width?: number;
  grey_zone_side?: "both" | "above";
  duplicate_in_burst_action?: "EXCLUDE" | "FLAG" | "DOWNWEIGHT";
}
/**
 * Every number the decision policy uses (MVP_SPEC §6.5). Nothing is hard-coded.
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "PolicyThresholds-Output".
 */
export interface PolicyThresholds1 {
  downweight_below: number;
  low_confidence: number;
  low_confidence_min_questions: number;
  spam_exclude: number;
  w_informativeness: number;
  w_rating_support: number;
  w_spam: number;
  w_templated: number;
  w_offtopic: number;
  w_offgame: number;
  w_contradiction: number;
  w_low_experience: number;
  w_influence: number;
  influence_floor: number;
  model_note_action: "EXCLUDE" | "FLAG" | "DOWNWEIGHT";
  reason_min_contribution: number;
  duplicate_action: "EXCLUDE" | "DOWNWEIGHT";
  cluster_penalty_threshold: number;
  cluster_penalty_strength: number;
  min_penalty_cluster_size: number;
  cluster_penalty_kinds: ("burst" | "duplicate" | "semantic")[];
  semantic_penalty_scope: "all" | "bursts";
  grey_zone_width: number;
  grey_zone_side: "both" | "above";
  duplicate_in_burst_action: "EXCLUDE" | "FLAG" | "DOWNWEIGHT";
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "PreflightOut".
 */
export interface PreflightOut {
  backend: string;
  reviews: number;
  calls: number;
  est_input_tokens: number;
  est_cost_usd: number;
  est_seconds: number;
  limit_usd: number;
  needs_confirmation: boolean;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "RatingEvent".
 */
export interface RatingEvent {
  type: "rating";
  raw: number;
  adjusted: number;
  ci: [number, number] | null;
  n_eff: number;
  final: boolean;
  platform: number | null;
  platform_ci: [number, number] | null;
}
/**
 * One line of `replay.jsonl.gz`: seconds since run start + the event.
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ReplayLine".
 */
export interface ReplayLine {
  t: number;
  event:
    StageEvent | FeaturesDoneEvent | JudgedEvent | CountersEvent | RatingEvent | ClusterEvent | DoneEvent | ErrorEvent;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "StageEvent".
 */
export interface StageEvent {
  type: "stage";
  name: "ingest" | "features" | "systemone" | "corpus" | "decide";
  status: "started" | "done" | "skipped";
}
/**
 * `GET /runs/{id}/reviews/{rid}`. Decision fields are None while the run is still deciding.
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ReviewDetail".
 */
export interface ReviewDetail {
  review_id: number;
  text: string;
  rating_raw: number | null;
  rating_norm: number | null;
  created_at: string | null;
  action: string | null;
  weight: number | null;
  integrity_score: number | null;
  reasons: string[];
  base_integrity: number | null;
  cluster_id: number | null;
  cluster_suspicion: number | null;
  cluster_kind: string | null;
  cluster_caption: string | null;
  answers: {
    [k: string]: {
      [k: string]: unknown;
    };
  };
  signals: ReviewSignals | null;
  meta: ReviewMeta | null;
  counts_in_platform_rating: boolean | null;
}
/**
 * Deterministic S1 signals for one review.
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ReviewSignals".
 */
export interface ReviewSignals {
  n_tokens: number | null;
  has_url: boolean;
  has_promo: boolean;
  promo_hits: string[];
  duplicate_of: number | null;
  duplicate_score: number | null;
  nearest_review_id: number | null;
  nearest_cosine: number | null;
  low_playtime: boolean | null;
  single_review_account: boolean | null;
  received_for_free: boolean | null;
  key_activation: boolean | null;
  model_note: boolean;
  influence_hits: string[];
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ReviewMeta".
 */
export interface ReviewMeta {
  playtime_hours: number | null;
  author_num_reviews: number | null;
  steam_purchase: boolean | null;
  received_for_free: boolean | null;
  votes_up: number | null;
  edited: boolean;
  updated_at: string | null;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ReviewPage".
 */
export interface ReviewPage {
  total: number;
  offset: number;
  items: ReviewRow[];
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "ReviewRow".
 */
export interface ReviewRow {
  review_id: number;
  created_at: string | null;
  rating_norm: number | null;
  action: string | null;
  weight: number | null;
  integrity_score: number | null;
  reasons: string[];
  snippet: string;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "RunCreate-Input".
 */
export interface RunCreate {
  dataset_id: string;
  backend?: "jev" | "laya" | "laya-ft" | "heuristic" | "mock" | "cached";
  model?: string | null;
  pack_size?: number;
  samples_per_review?: number;
  reuse_identical_inputs?: boolean;
  reuse_judgments_from?: string | null;
  confirm_cost?: boolean;
  question_set?: "v1" | "v2" | "v3" | "v4" | "v5";
  concurrency?: number;
  weights?: ActionWeights2;
  thresholds?: PolicyThresholds2;
  features?: FeatureConfig2;
  bursts?: BurstConfig2;
  clusters?: ClusterConfig2;
  suspicion?: SuspicionConfig;
  platform?: PlatformPolicyConfig2;
  bootstrap_resamples?: number;
  seed?: number;
  /**
   * mock backend only: delay per batch
   */
  mock_latency_ms?: number;
}
export interface ActionWeights2 {
  KEEP?: number;
  DOWNWEIGHT?: number;
  FLAG?: number;
  EXCLUDE?: number;
}
/**
 * Every number the decision policy uses (MVP_SPEC §6.5). Nothing is hard-coded.
 */
export interface PolicyThresholds2 {
  downweight_below?: number;
  low_confidence?: number;
  low_confidence_min_questions?: number;
  spam_exclude?: number;
  w_informativeness?: number;
  w_rating_support?: number;
  w_spam?: number;
  w_templated?: number;
  w_offtopic?: number;
  w_offgame?: number;
  w_contradiction?: number;
  w_low_experience?: number;
  w_influence?: number;
  influence_floor?: number;
  model_note_action?: "EXCLUDE" | "FLAG" | "DOWNWEIGHT";
  reason_min_contribution?: number;
  duplicate_action?: "EXCLUDE" | "DOWNWEIGHT";
  cluster_penalty_threshold?: number;
  cluster_penalty_strength?: number;
  min_penalty_cluster_size?: number;
  cluster_penalty_kinds?: ("burst" | "duplicate" | "semantic")[];
  semantic_penalty_scope?: "all" | "bursts";
  grey_zone_width?: number;
  grey_zone_side?: "both" | "above";
  duplicate_in_burst_action?: "EXCLUDE" | "FLAG" | "DOWNWEIGHT";
}
/**
 * S1 deterministic features (MVP_SPEC §6.2).
 */
export interface FeatureConfig2 {
  shingle_unit?: "char" | "word";
  shingle_size?: number;
  minhash_perm?: number;
  near_dup_jaccard?: number;
  lsh_candidate_jaccard?: number;
  dup_min_tokens?: number;
  low_info_max_tokens?: number;
  embedding_model?: string;
  embedding_max_seq_len?: number;
  low_playtime_minutes?: number;
  strip_influence?: boolean;
}
/**
 * S3 burst detection (MVP_SPEC §6.4). Calibrated on HD2 / CS2 (MEASUREMENTS M9).
 */
export interface BurstConfig2 {
  baseline_hours?: number;
  min_history_hours?: number;
  z_threshold?: number;
  min_scale?: number;
  min_hour_count?: number;
  merge_gap_hours?: number;
  min_burst_reviews?: number;
  min_daily_reviews?: number;
  min_segment_days?: number;
  change_point_penalty?: number;
}
/**
 * S3 clusters (MVP_SPEC §6.4).
 */
export interface ClusterConfig2 {
  umap_min_reviews?: number;
  umap_neighbors?: number;
  umap_components?: number;
  umap_min_dist?: number;
  hdbscan_min_cluster_size?: number;
  hdbscan_min_samples?: number | null;
  dup_min_size?: number;
  top_phrases?: number;
  seed?: number;
}
/**
 * Cluster suspicion factors (app/corpus/suspicion.py).
 */
export interface SuspicionConfig {
  time_scales_hours?: number[];
  similar_cosine?: number;
  offtopic_topics?: string[];
  factor_floor?: number;
  factor_weights?: {
    [k: string]: number;
  };
  null_samples?: number;
  null_floor?: number;
  max_cluster_events?: number;
}
/**
 * Steam's review-score rules, emulated (app/decide/platform.py).
 */
export interface PlatformPolicyConfig2 {
  purchasers_only?: boolean;
  offtopic_window_share?: number;
  min_judged_negatives?: number;
  extend_windows?: boolean;
  extend_min_daily_negatives?: number;
  extend_max_days?: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "RunCreate-Output".
 */
export interface RunCreate1 {
  dataset_id: string;
  backend: "jev" | "laya" | "laya-ft" | "heuristic" | "mock" | "cached";
  model: string | null;
  pack_size: number;
  samples_per_review: number;
  reuse_identical_inputs: boolean;
  reuse_judgments_from: string | null;
  confirm_cost: boolean;
  question_set: "v1" | "v2" | "v3" | "v4" | "v5";
  concurrency: number;
  weights: ActionWeights3;
  thresholds: PolicyThresholds3;
  features: FeatureConfig3;
  bursts: BurstConfig3;
  clusters: ClusterConfig3;
  suspicion: SuspicionConfig1;
  platform: PlatformPolicyConfig3;
  bootstrap_resamples: number;
  seed: number;
  /**
   * mock backend only: delay per batch
   */
  mock_latency_ms: number;
}
export interface ActionWeights3 {
  KEEP: number;
  DOWNWEIGHT: number;
  FLAG: number;
  EXCLUDE: number;
}
/**
 * Every number the decision policy uses (MVP_SPEC §6.5). Nothing is hard-coded.
 */
export interface PolicyThresholds3 {
  downweight_below: number;
  low_confidence: number;
  low_confidence_min_questions: number;
  spam_exclude: number;
  w_informativeness: number;
  w_rating_support: number;
  w_spam: number;
  w_templated: number;
  w_offtopic: number;
  w_offgame: number;
  w_contradiction: number;
  w_low_experience: number;
  w_influence: number;
  influence_floor: number;
  model_note_action: "EXCLUDE" | "FLAG" | "DOWNWEIGHT";
  reason_min_contribution: number;
  duplicate_action: "EXCLUDE" | "DOWNWEIGHT";
  cluster_penalty_threshold: number;
  cluster_penalty_strength: number;
  min_penalty_cluster_size: number;
  cluster_penalty_kinds: ("burst" | "duplicate" | "semantic")[];
  semantic_penalty_scope: "all" | "bursts";
  grey_zone_width: number;
  grey_zone_side: "both" | "above";
  duplicate_in_burst_action: "EXCLUDE" | "FLAG" | "DOWNWEIGHT";
}
/**
 * S1 deterministic features (MVP_SPEC §6.2).
 */
export interface FeatureConfig3 {
  shingle_unit: "char" | "word";
  shingle_size: number;
  minhash_perm: number;
  near_dup_jaccard: number;
  lsh_candidate_jaccard: number;
  dup_min_tokens: number;
  low_info_max_tokens: number;
  embedding_model: string;
  embedding_max_seq_len: number;
  low_playtime_minutes: number;
  strip_influence: boolean;
}
/**
 * S3 burst detection (MVP_SPEC §6.4). Calibrated on HD2 / CS2 (MEASUREMENTS M9).
 */
export interface BurstConfig3 {
  baseline_hours: number;
  min_history_hours: number;
  z_threshold: number;
  min_scale: number;
  min_hour_count: number;
  merge_gap_hours: number;
  min_burst_reviews: number;
  min_daily_reviews: number;
  min_segment_days: number;
  change_point_penalty: number;
}
/**
 * S3 clusters (MVP_SPEC §6.4).
 */
export interface ClusterConfig3 {
  umap_min_reviews: number;
  umap_neighbors: number;
  umap_components: number;
  umap_min_dist: number;
  hdbscan_min_cluster_size: number;
  hdbscan_min_samples: number | null;
  dup_min_size: number;
  top_phrases: number;
  seed: number;
}
/**
 * Cluster suspicion factors (app/corpus/suspicion.py).
 */
export interface SuspicionConfig1 {
  time_scales_hours: number[];
  similar_cosine: number;
  offtopic_topics: string[];
  factor_floor: number;
  factor_weights: {
    [k: string]: number;
  };
  null_samples: number;
  null_floor: number;
  max_cluster_events: number;
}
/**
 * Steam's review-score rules, emulated (app/decide/platform.py).
 */
export interface PlatformPolicyConfig3 {
  purchasers_only: boolean;
  offtopic_window_share: number;
  min_judged_negatives: number;
  extend_windows: boolean;
  extend_min_daily_negatives: number;
  extend_max_days: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "RunOut".
 */
export interface RunOut {
  id: string;
  dataset_id: string;
  backend: string;
  model_version: string | null;
  status: string;
  error: string | null;
  config: RunCreate1;
  started_at: string | null;
  finished_at: string | null;
  summary: RunSummary | null;
  cost_usd: number;
  tokens_in: number;
}
/**
 * Per-review arrays in grid order, for client-side sliders and the waterfall.
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "RunScores".
 */
export interface RunScores {
  rating_norm: (number | null)[];
  integrity: (number | null)[];
  base_integrity: (number | null)[];
  action: number[];
  primary_reason: number[];
  reason_codes: string[];
  counts_in_platform: boolean[];
  platform_key_activation: boolean[];
  weights: ActionWeights1;
  downweight_below: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "SteamFetchRequest".
 */
export interface SteamFetchRequest {
  appid: number;
  /**
   * YYYY-MM-DD, UTC inclusive
   */
  from: string;
  to: string;
  language?: string;
  sample_n?: number | null;
  name?: string | null;
  /**
   * game title used in the model context line
   */
  subject?: string | null;
}
/**
 * Cluster suspicion factors (app/corpus/suspicion.py).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "SuspicionConfig-Input".
 */
export interface SuspicionConfig2 {
  time_scales_hours?: number[];
  similar_cosine?: number;
  offtopic_topics?: string[];
  factor_floor?: number;
  factor_weights?: {
    [k: string]: number;
  };
  null_samples?: number;
  null_floor?: number;
  max_cluster_events?: number;
}
/**
 * Cluster suspicion factors (app/corpus/suspicion.py).
 *
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "SuspicionConfig-Output".
 */
export interface SuspicionConfig3 {
  time_scales_hours: number[];
  similar_cosine: number;
  offtopic_topics: string[];
  factor_floor: number;
  factor_weights: {
    [k: string]: number;
  };
  null_samples: number;
  null_floor: number;
  max_cluster_events: number;
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "UploadLimits".
 */
export interface UploadLimits {
  max_mb: number;
  max_rows: number;
}
