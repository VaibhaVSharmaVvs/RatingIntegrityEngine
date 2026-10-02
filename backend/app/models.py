"""API and SSE contract (MVP_SPEC §7). The frontend's types are generated from these.

Regenerate after any change:  uv run python ../tools/export_types.py
"""

from datetime import datetime
from enum import IntEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Backend = Literal["jev", "laya", "laya-ft", "heuristic", "mock", "cached"]
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
    # Option B (owner decision 2026-10-01): brevity is not an integrity problem.
    # Informativeness and rating support are shown as evidence quality but carry no
    # weight: with the spec's 0.30 / 0.25, positive reviews (shorter) were
    # downweighted ~2x as often as negative ones on every corpus (MEASUREMENTS M10).
    w_informativeness: float = 0.0
    w_rating_support: float = 0.0
    w_spam: float = 0.20
    w_templated: float = 0.15
    # Legacy off-topic signal from `topic` (off_topic / joke_meme), used only when the
    # question set has no `about_game` answer (v1, v2).
    w_offtopic: float = 0.10
    # Not about the game (v3 `about_game`): reviews aimed only at the company,
    # politics or other products. Heavy, per owner; Steam excludes such bombs.
    w_offgame: float = 0.60
    # The text contradicts its own verdict (P of the lowest rating_support level).
    w_contradiction: float = 0.50
    # Experience floor: low playtime only counts together with an off-game verdict
    # (low playtime alone is often a valid early-quit / won't-launch review).
    w_low_experience: float = 0.20
    # Question set v5 `influence_attempt`: the review tries to influence how it is judged.
    # Heavy, per owner (2026-10-02): such text is written to fool the judge.
    w_influence: float = 0.60
    # ...counted only above this probability, rescaled to [0, 1]: a "no" (< 0.5) costs
    # nothing, a confident "yes" costs nearly the full weight. Without it, the answer's
    # noise on genuine reviews pushed borderline ones under the line (M13).
    influence_floor: float = Field(0.5, ge=0, lt=1)
    # A deterministic note addressed to the model judging the review (features/influence.py):
    # absent from genuine reviews (1 in 420,582, M13), so it may exclude.
    model_note_action: Literal["EXCLUDE", "FLAG", "DOWNWEIGHT"] = "EXCLUDE"
    reason_min_contribution: float = 0.05
    # Later copies of an earlier review (>= dup_min_tokens). Owner decision 2026-09-30:
    # DOWNWEIGHT by default (independent reviewers do repeat generic sentences); the
    # spec's EXCLUDE stays available. In-burst escalation is Phase 4.
    duplicate_action: Literal["EXCLUDE", "DOWNWEIGHT"] = "DOWNWEIGHT"
    # S4 cluster rules (MVP_SPEC §6.5). A review in a cluster with suspicion above
    # `cluster_penalty_threshold` has its integrity multiplied by
    # (1 - cluster_penalty_strength * suspicion).
    cluster_penalty_threshold: float = 0.5
    cluster_penalty_strength: float = 0.5
    # Clusters smaller than this are shown but never penalise: "coordination" among 3
    # reviews is not evidence worth moving a rating for.
    min_penalty_cluster_size: int = 10
    # Which cluster kinds may penalise their members. Semantic clusters are global
    # (UMAP + HDBSCAN) and shift whenever the corpus changes (MEASUREMENTS M12a).
    cluster_penalty_kinds: list[Literal["burst", "duplicate", "semantic"]] = [
        "burst",
        "duplicate",
        "semantic",
    ]
    # Where a semantic cluster may penalise (owner decision 2026-10-02, M13). In normal
    # periods its "suspicious" clusters were organic fan memes ("For Democracy!") with no
    # time concentration: similar and one-sided, not coordinated. "bursts" keeps the
    # penalty for members inside a detected burst only.
    semantic_penalty_scope: Literal["all", "bursts"] = "bursts"
    # FLAG a clustered review whose penalised integrity lands within this distance of
    # `downweight_below` (the spec's grey zone). Measured cost: +32 FLAGs on HD2 5K
    # (+0.6%); FLAG counts as KEEP in the rating (MEASUREMENTS M9d). 0 disables it.
    grey_zone_width: float = 0.1
    # A later copy inside a suspicious burst or cluster (owner decision 2026-09-30).
    duplicate_in_burst_action: Literal["EXCLUDE", "FLAG", "DOWNWEIGHT"] = "EXCLUDE"


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
    # Remove model notes and self-legitimising claims from the text System One judges
    # (features/influence.py). The stored review is never changed.
    strip_influence: bool = True


class BurstConfig(Contract):
    """S3 burst detection (MVP_SPEC §6.4). Calibrated on HD2 / CS2 (MEASUREMENTS M9)."""

    baseline_hours: int = Field(168, ge=24)  # trailing 7-day baseline
    min_history_hours: int = Field(72, ge=6)  # no z-score until 3 days of history
    z_threshold: float = Field(6.0, gt=0)
    min_scale: float = Field(1.0, gt=0)  # floor on MAD*1.4826 for sparse series
    min_hour_count: int = Field(5, ge=1)
    merge_gap_hours: int = Field(2, ge=0)
    min_burst_reviews: int = Field(30, ge=1)
    min_daily_reviews: int = Field(20, ge=1)  # days with fewer are left out of PELT
    min_segment_days: int = Field(3, ge=1)
    change_point_penalty: float = Field(3.0, gt=0)


class ClusterConfig(Contract):
    """S3 clusters (MVP_SPEC §6.4)."""

    # Below this many reviews HDBSCAN runs on the unit-normalised embeddings directly
    # (euclidean on unit vectors ranks like cosine); UMAP only pays off at scale.
    umap_min_reviews: int = Field(2000, ge=0)
    umap_neighbors: int = Field(15, ge=2)
    umap_components: int = Field(10, ge=2)
    umap_min_dist: float = Field(0.0, ge=0)
    hdbscan_min_cluster_size: int = Field(15, ge=2)
    hdbscan_min_samples: int | None = None  # None = min_cluster_size (sklearn default)
    dup_min_size: int = Field(3, ge=2)
    top_phrases: int = Field(6, ge=1)
    seed: int = 7


class SuspicionConfig(Contract):
    """Cluster suspicion factors (app/corpus/suspicion.py)."""

    time_scales_hours: list[float] = [0.25, 1, 6, 24, 72]
    similar_cosine: float = Field(0.8, ge=0, le=1)
    # Topics that count as "not about the game" for coordination. The spec includes
    # platform/account policy (as Steam's off-topic review-bomb filter does); that is
    # a methodology choice, reported with sensitivity (MEASUREMENTS M9).
    offtopic_topics: list[str] = ["off_topic", "joke_meme", "platform_policy"]
    factor_floor: float = Field(0.02, gt=0, lt=1)
    # Supporting factors at half weight (owner decision 2026-10-02, MEASUREMENTS M12a):
    # at full weight a near-zero off-topic or similarity factor vetoed on-topic copy floods
    # and varied bursts. Halving both: attack pull removed 45% -> 55%, cluster collateral
    # 127 -> 74, controls and the six showcase games within 0.1 pp.
    factor_weights: dict[str, float] = {
        "new_account_share": 0.5,
        "offtopic_mean": 0.5,
        "similarity": 0.5,
    }
    null_samples: int = Field(24, ge=4)  # random subsets per (size, scale) for the time null
    # Minimum expected "other reviews" in the densest window: 2 of 3 reviews within
    # 15 min is unusual but a single coincidence, so it scores at most 0.5.
    null_floor: float = Field(0.5, gt=0)
    max_cluster_events: int = Field(25, ge=0)


class PlatformPolicyConfig(Contract):
    """Steam's review-score rules, emulated (app/decide/platform.py)."""

    purchasers_only: bool = True  # Valve 2016: key activations don't count
    # Valve 2019: a negative spike whose reviews are mostly off-topic is removed whole.
    offtopic_window_share: float = Field(0.5, ge=0, le=1)
    min_judged_negatives: int = Field(20, ge=1)
    # Extend a removed window in 24 h steps, back and forward, while each step still has
    # at least `extend_min_daily_negatives` judged negatives and more than
    # `offtopic_window_share` of them are off-topic. Valve removed ROME II's whole
    # 3.5-week bomb period, not only its peak (MEASUREMENTS M14/M15).
    extend_windows: bool = False
    extend_min_daily_negatives: int = Field(5, ge=1)
    extend_max_days: int = Field(45, ge=0)


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
    # backend="cached": replay this finished run's System One answers ($0).
    reuse_judgments_from: str | None = None
    # Required when the pre-flight estimate exceeds MAX_RUN_COST_USD.
    confirm_cost: bool = False
    # v5 is the default (owner decision 2026-10-02, M13): v4 + influence_attempt.
    question_set: Literal["v1", "v2", "v3", "v4", "v5"] = "v5"
    concurrency: int = Field(8, ge=1, le=64)
    weights: ActionWeights = ActionWeights()
    thresholds: PolicyThresholds = PolicyThresholds()
    features: FeatureConfig = FeatureConfig()
    bursts: BurstConfig = BurstConfig()
    clusters: ClusterConfig = ClusterConfig()
    suspicion: SuspicionConfig = SuspicionConfig()
    platform: PlatformPolicyConfig = PlatformPolicyConfig()
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
    """Per-review actions. Decoding: indices = Uint32Array (little-endian) from base64
    `indices_b64`; actions = Uint8Array from `actions_b64`; same length. A review can
    appear again later (S4 cluster rules update it): the last update wins."""

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
    # Platform-policy rating (Steam's rules emulated); null when not computable.
    platform: float | None = None
    platform_ci: tuple[float, float] | None = None


class ClusterEvent(Contract):
    type: Literal["cluster"] = "cluster"
    cid: int
    kind: Literal["semantic", "duplicate", "burst"]
    size: int
    suspicion: float
    caption: str


class CorpusSummary(Contract):
    clusters: dict[str, int] = {}  # count per kind: burst / duplicate / semantic
    suspicious_clusters: int = 0  # suspicion above the penalty threshold
    change_points: list[str] = []  # ISO dates where daily % positive shifts
    penalised_reviews: int = 0
    actions_changed_by_clusters: int = 0


class ExcludedWindowOut(Contract):
    start: datetime
    end: datetime
    negatives: int  # judged negative reviews in the window
    offtopic_share: float  # of those, share with a verdict not based on playing
    reviews_removed: int  # all reviews (both verdicts) removed, as Steam does


class PlatformSummary(Contract):
    rating: float | None
    ci: tuple[float, float] | None
    counted: int
    key_activations_removed: int
    windows: list[ExcludedWindowOut] = []
    basis: str  # verdict_basis | topic_proxy | none
    steam_label: str | None = None


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
    corpus: CorpusSummary = CorpusSummary()
    platform: PlatformSummary | None = None


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


class HourIndex(Contract):
    """Hourly buckets in grid order: reviews `starts[i] .. starts[i] + counts[i] - 1` fall in
    `hours[i]`. Grid indices are chronological, so each bucket is one contiguous run."""

    hours: list[str | None]  # ISO hour, UTC; None for reviews without a timestamp
    starts: list[int]
    counts: list[int]


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


class ClusterOut(Contract):
    cluster_id: int
    kind: Literal["semantic", "duplicate", "burst"]
    size: int
    t_start: datetime | None
    t_end: datetime | None
    suspicion: float
    factors: dict[str, float | None]
    caption: str
    top_phrases: list[str]
    window: dict[str, Any]


class ClusterReview(Contract):
    review_id: int
    text: str
    rating_norm: float | None
    created_at: datetime | None
    action: str | None
    reasons: list[str]


class ReviewSignals(Contract):
    """Deterministic S1 signals for one review."""

    n_tokens: int | None
    has_url: bool
    has_promo: bool
    promo_hits: list[str]
    duplicate_of: int | None  # earlier review this is a copy of (None if first / no copy)
    duplicate_score: float | None
    nearest_review_id: int | None
    nearest_cosine: float | None
    low_playtime: bool | None
    single_review_account: bool | None
    received_for_free: bool | None
    key_activation: bool | None
    # text written to influence the judgment (features/influence.py)
    model_note: bool = False
    influence_hits: list[str] = []  # not bought on Steam (Steam's score leaves these out)


class ReviewMeta(Contract):
    playtime_hours: float | None
    author_num_reviews: int | None
    steam_purchase: bool | None
    received_for_free: bool | None
    votes_up: int | None
    edited: bool  # updated more than 1 h after posting (verdicts can change, C13)
    updated_at: datetime | None


class ReviewDetail(Contract):
    """`GET /runs/{id}/reviews/{rid}`. Decision fields are None while the run is still deciding."""

    review_id: int
    text: str
    rating_raw: float | None
    rating_norm: float | None
    created_at: datetime | None
    action: str | None
    weight: float | None
    integrity_score: float | None
    reasons: list[str]
    base_integrity: float | None = None  # before the S4 cluster penalty
    cluster_id: int | None = None  # most suspicious cluster it belongs to
    cluster_suspicion: float | None = None
    cluster_kind: str | None = None
    cluster_caption: str | None = None
    answers: dict[str, dict[str, Any]] = {}  # System One answers by question id
    signals: ReviewSignals | None = None
    meta: ReviewMeta | None = None
    counts_in_platform_rating: bool | None = None  # False: key activation or off-topic window


class ReviewRow(Contract):
    review_id: int
    created_at: datetime | None
    rating_norm: float | None
    action: str | None
    weight: float | None
    integrity_score: float | None
    reasons: list[str]
    snippet: str


class ReviewPage(Contract):
    total: int
    offset: int
    items: list[ReviewRow]


class RunScores(Contract):
    """Per-review arrays in grid order, for client-side sliders and the waterfall."""

    rating_norm: list[float | None]
    integrity: list[float | None]  # final, after the cluster penalty
    base_integrity: list[float | None]  # before it
    action: list[int]  # ActionCode
    primary_reason: list[int]  # index into reason_codes, -1 = none
    reason_codes: list[str]
    counts_in_platform: list[bool]
    weights: ActionWeights
    downweight_below: float


class ClusterDetail(ClusterOut):
    hourly: list[dict[str, Any]]  # {hour, count} for the cluster's span
    actions: dict[str, int]  # action counts among members
    sample: list[ClusterReview]
    member_ids: list[int]


BenchmarkKind = Literal["attack", "control", "agreement", "adversarial", "ablation"]


class BenchmarkIn(Contract):
    kind: BenchmarkKind
    name: str
    backend: str | None = None
    question_set: str | None = None
    run_ids: list[str] = []
    metrics: dict[str, Any]
    cost_usd: float = 0.0
    notes: str | None = None


class BenchmarkOut(BenchmarkIn):
    id: str
    created_at: datetime


# Human labels for the agreement benchmark. Each key mirrors a System One question or the
# engine's decision, so Cohen's kappa can be computed per question (tools/bench_agreement.py).
HUMAN_LABELS: dict[str, list[str]] = {
    "about_game": ["yes", "no"],  # ~ about_game
    "verdict_basis": ["playing", "other"],  # ~ verdict_basis
    "contradicts": ["no", "yes"],  # ~ rating_support level 0
    "spam": ["no", "yes"],  # ~ spam_promo
    "copied": ["no", "yes"],  # ~ templated
    "overall": ["keep", "downweight", "exclude"],  # ~ the engine's action
}
HUMAN_LABEL_KEYS = list(HUMAN_LABELS)


class LabelIn(Contract):
    rater: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    label: dict[str, str]

    @model_validator(mode="after")
    def _values(self) -> "LabelIn":
        bad = {k: v for k, v in self.label.items() if v not in HUMAN_LABELS.get(k, [])}
        if bad:
            raise ValueError(f"unknown label values: {bad}")
        return self


class LabelItem(Contract):
    review_id: int
    text: str
    recommended: bool
    label: dict[str, str] | None


class LabelSet(Contract):
    name: str
    subject: str
    items: list[LabelItem]


class LabelSetSummary(Contract):
    name: str
    size: int
    labelled: dict[str, int]  # rater -> reviews labelled


class UploadLimits(Contract):
    max_mb: float
    max_rows: int


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
    subject: str | None = Field(None, description="game title used in the model context line")
