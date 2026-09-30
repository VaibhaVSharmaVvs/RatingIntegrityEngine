"""API and SSE contract (MVP_SPEC §7). The frontend's types are generated from these.

Regenerate after any change:  uv run python ../tools/export_types.py
"""

from datetime import datetime
from enum import IntEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Backend = Literal["jev", "laya", "laya-ft", "heuristic", "mock"]
StageName = Literal["ingest", "features", "systemone", "corpus", "decide"]
ActionName = Literal["KEEP", "DOWNWEIGHT", "FLAG", "EXCLUDE"]


class Contract(BaseModel):
    # Serialized responses always include defaulted fields (e.g. `type`), so the
    # generated TS marks them required and the event union can discriminate on `type`.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class ActionCode(IntEnum):
    """One byte per review in the grid (`/runs/{id}/grid` and `judged` events)."""

    PENDING = 0
    KEEP = 1
    DOWNWEIGHT = 2
    FLAG = 3
    EXCLUDE = 4


# --- run configuration --------------------------------------------------------------


class ActionWeights(Contract):
    KEEP: float = 1.0
    DOWNWEIGHT: float = 0.25
    FLAG: float = 1.0  # counted as KEEP in the rating, shown separately
    EXCLUDE: float = 0.0


class PolicyThresholds(Contract):
    """Every number the decision policy uses (MVP_SPEC §6.5). Nothing is hard-coded."""

    downweight_below: float = 0.55
    low_confidence: float = 0.5
    low_confidence_min_questions: int = 2
    spam_exclude: float = 0.9
    w_informativeness: float = 0.30
    w_rating_support: float = 0.25
    w_spam: float = 0.20
    w_templated: float = 0.15
    w_offtopic: float = 0.10
    reason_min_contribution: float = 0.05
    # Later copies of an earlier review (>= dup_min_tokens). Owner decision 2026-09-30:
    # DOWNWEIGHT by default (independent reviewers do repeat generic sentences); the
    # spec's EXCLUDE stays available. In-burst escalation is Phase 4.
    duplicate_action: Literal["EXCLUDE", "DOWNWEIGHT"] = "DOWNWEIGHT"


class FeatureConfig(Contract):
    """S1 deterministic features (MVP_SPEC §6.2)."""

    # Character 5-shingles, not word 3-shingles: two small edits to a 27-word review
    # drop word-3 Jaccard to ~0.69 (below the bar), char-5 stays ~0.84. Measured on
    # injected near-copies vs all real Gollum review pairs (MEASUREMENTS M5).
    shingle_unit: Literal["char", "word"] = "char"
    shingle_size: int = Field(5, ge=1, le=12)
    minhash_perm: int = Field(128, ge=16, le=512)
    near_dup_jaccard: float = Field(0.7, ge=0.3, le=1.0)
    # LSH only proposes candidates; each is then verified with the *exact* Jaccard of
    # its shingle sets. A looser candidate bar buys recall at no precision cost
    # (MEASUREMENTS M5d: review recall 0.76 -> 0.89 on real Helldivers 2 reviews).
    lsh_candidate_jaccard: float = Field(0.4, ge=0.2, le=1.0)
    # Short generic texts ("good game") repeat across independent reviewers. Below this
    # length a duplicate is not evidence of copying, so it is never excluded as one.
    dup_min_tokens: int = Field(8, ge=1)
    low_info_max_tokens: int = Field(3, ge=0)
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    # MiniLM-L6's native training length. 128 truncated 7% of HD2 and 31% of Gollum
    # reviews; 256 truncates 2.4% / 12% (MEASUREMENTS M6).
    embedding_max_seq_len: int = Field(256, ge=16, le=512)
    low_playtime_minutes: int = Field(120, ge=0)


class RunCreate(Contract):
    dataset_id: str
    backend: Backend = "mock"
    model: str | None = None
    pack_size: int = Field(1, ge=1, le=20)
    # Jev is not deterministic (MEASUREMENTS M7): k calls per review, averaged, halve
    # decision flips at k=2 (2.6% -> 1.0%) for k times the cost.
    samples_per_review: int = Field(1, ge=1, le=5)
    # Off by default: reuse gives every identical copy the *same* noise draw, so a
    # borderline answer flips all copies together (M7c). On = cheaper, less accurate.
    reuse_identical_inputs: bool = False
    # Required when the pre-flight estimate exceeds MAX_RUN_COST_USD.
    confirm_cost: bool = False
    # v2 is the default after dev-set review (MEASUREMENTS M8); v1 stays for comparison.
    question_set: Literal["v1", "v2"] = "v2"
    concurrency: int = Field(8, ge=1, le=64)
    weights: ActionWeights = ActionWeights()
    thresholds: PolicyThresholds = PolicyThresholds()
    features: FeatureConfig = FeatureConfig()
    bootstrap_resamples: int = Field(2000, ge=100, le=10_000)
    seed: int = 7
    mock_latency_ms: float = Field(
        0, ge=0, le=1000, description="mock backend only: delay per batch"
    )


# --- SSE events ---------------------------------------------------------------------


class StageEvent(Contract):
    type: Literal["stage"] = "stage"
    name: StageName
    status: Literal["started", "done", "skipped"]


class FeaturesDoneEvent(Contract):
    type: Literal["features_done"] = "features_done"
    counts: dict[str, int]
    timings_s: dict[str, float] = {}


class JudgedEvent(Contract):
    """Provisional per-review actions. Decoding: indices = Uint32Array (little-endian)
    from base64 `indices_b64`; actions = Uint8Array from `actions_b64`; same length."""

    type: Literal["judged"] = "judged"
    indices_b64: str
    actions_b64: str


class CountersEvent(Contract):
    type: Literal["counters"] = "counters"
    keep: int
    down: int
    flag: int
    exclude: int
    processed: int
    total: int
    rps: float
    cost_usd: float
    elapsed_s: float


class RatingEvent(Contract):
    type: Literal["rating"] = "rating"
    raw: float
    adjusted: float
    ci: tuple[float, float] | None = None  # 95% bootstrap CI; null on live updates
    n_eff: float
    final: bool = False


class ClusterEvent(Contract):
    type: Literal["cluster"] = "cluster"
    cid: int
    kind: Literal["semantic", "duplicate", "burst"]
    size: int
    suspicion: float
    caption: str


class RunSummary(Contract):
    n_reviews: int
    counts: dict[ActionName, int]
    raw: float
    adjusted: float
    ci: tuple[float, float]
    n_eff: float
    rating_scale: str
    steam_label_raw: str | None = None
    steam_label_adjusted: str | None = None
    cost_usd: float
    tokens_in: int
    elapsed_s: float
    reviews_per_s: float
    model_version: str | None = None
    timings_s: dict[str, float] = {}  # per stage, plus semantic_* sub-steps
    reused_judgments: int = 0  # reviews whose model input was byte-identical to another's
    requests: int = 0  # System One HTTP requests (0 for mock/heuristic)
    retries: int = 0
    latency_p50_ms: float | None = None
    latency_p95_ms: float | None = None
    embedding_cache_hit: bool | None = None


class DoneEvent(Contract):
    type: Literal["done"] = "done"
    summary: RunSummary


class ErrorEvent(Contract):
    type: Literal["error"] = "error"
    message: str
    retryable: bool = False


RunEvent = Annotated[
    StageEvent
    | FeaturesDoneEvent
    | JudgedEvent
    | CountersEvent
    | RatingEvent
    | ClusterEvent
    | DoneEvent
    | ErrorEvent,
    Field(discriminator="type"),
]


class ReplayLine(Contract):
    """One line of `replay.jsonl.gz`: seconds since run start + the event."""

    t: float
    event: RunEvent


# --- REST responses -----------------------------------------------------------------


class DatasetOut(Contract):
    id: str
    name: str
    source: str
    rating_scale: str
    status: str
    error: str | None
    n_reviews: int
    created_at: datetime
    source_params: dict[str, Any]


class HistogramBin(Contract):
    rating: float
    count: int


class TimelineBucket(Contract):
    day: str  # ISO date, UTC
    count: int
    mean_rating: float


class DatasetDetail(DatasetOut):
    histogram: list[HistogramBin]
    timeline: list[TimelineBucket]


class RunOut(Contract):
    id: str
    dataset_id: str
    backend: str
    model_version: str | None
    status: str
    error: str | None
    config: RunCreate
    started_at: datetime | None
    finished_at: datetime | None
    summary: RunSummary | None
    cost_usd: float
    tokens_in: int


class PreflightOut(Contract):
    backend: str
    reviews: int
    calls: int
    est_input_tokens: int
    est_cost_usd: float
    est_seconds: float
    limit_usd: float
    needs_confirmation: bool


class CsvPreview(Contract):
    columns: list[str]
    n_rows: int
    rows: list[dict[str, Any]]
    rating_scale_guesses: dict[str, str]


class SteamFetchRequest(Contract):
    appid: int
    from_: str = Field(alias="from", description="YYYY-MM-DD, UTC inclusive")
    to: str
    language: str = "english"
    sample_n: int | None = None
    name: str | None = None
