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


class RunCreate(Contract):
    dataset_id: str
    backend: Backend = "mock"
    model: str | None = None
    pack_size: int = Field(1, ge=1, le=20)
    question_set: Literal["v1"] = "v1"
    concurrency: int = Field(8, ge=1, le=64)
    weights: ActionWeights = ActionWeights()
    thresholds: PolicyThresholds = PolicyThresholds()
    bootstrap_resamples: int = Field(1000, ge=100, le=10_000)
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
