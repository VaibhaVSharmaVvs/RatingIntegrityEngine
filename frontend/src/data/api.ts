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
  ClusterEvent?: ClusterEvent;
  CountersEvent?: CountersEvent;
  CsvPreview?: CsvPreview;
  DatasetDetail?: DatasetDetail;
  DatasetOut?: DatasetOut;
  DoneEvent?: DoneEvent;
  ErrorEvent?: ErrorEvent;
  "FeatureConfig-Input"?: FeatureConfig;
  "FeatureConfig-Output"?: FeatureConfig1;
  FeaturesDoneEvent?: FeaturesDoneEvent;
  HistogramBin?: HistogramBin;
  JudgedEvent?: JudgedEvent;
  "PolicyThresholds-Input"?: PolicyThresholds;
  "PolicyThresholds-Output"?: PolicyThresholds1;
  RatingEvent?: RatingEvent;
  ReplayLine?: ReplayLine;
  "RunCreate-Input"?: RunCreate;
  "RunCreate-Output"?: RunCreate1;
  RunOut?: RunOut;
  RunSummary?: RunSummary;
  StageEvent?: StageEvent;
  SteamFetchRequest?: SteamFetchRequest;
  TimelineBucket?: TimelineBucket;
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
  embedding_cache_hit: boolean | null;
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
 * Provisional per-review actions. Decoding: indices = Uint32Array (little-endian)
 * from base64 `indices_b64`; actions = Uint8Array from `actions_b64`; same length.
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
  reason_min_contribution?: number;
  duplicate_action?: "EXCLUDE" | "DOWNWEIGHT";
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
  reason_min_contribution: number;
  duplicate_action: "EXCLUDE" | "DOWNWEIGHT";
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
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "RunCreate-Input".
 */
export interface RunCreate {
  dataset_id: string;
  backend?: "jev" | "laya" | "laya-ft" | "heuristic" | "mock";
  model?: string | null;
  pack_size?: number;
  question_set?: "v1";
  concurrency?: number;
  weights?: ActionWeights2;
  thresholds?: PolicyThresholds2;
  features?: FeatureConfig2;
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
  reason_min_contribution?: number;
  duplicate_action?: "EXCLUDE" | "DOWNWEIGHT";
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
}
/**
 * This interface was referenced by `RIEAPI`'s JSON-Schema
 * via the `definition` "RunCreate-Output".
 */
export interface RunCreate1 {
  dataset_id: string;
  backend: "jev" | "laya" | "laya-ft" | "heuristic" | "mock";
  model: string | null;
  pack_size: number;
  question_set: "v1";
  concurrency: number;
  weights: ActionWeights3;
  thresholds: PolicyThresholds3;
  features: FeatureConfig3;
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
  reason_min_contribution: number;
  duplicate_action: "EXCLUDE" | "DOWNWEIGHT";
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
}
