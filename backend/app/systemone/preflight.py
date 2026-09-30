"""Pre-flight estimate and spend guard (MVP_SPEC §6.3, §9).

Token model, fitted on 60 real reviews against Jev with question set v1 (MEASUREMENTS
M7b):  input_tokens ~= 893.1 + 0.2445 * len(state JSON), residual SD 43 tokens.
The intercept is the six questions' own text, which dominates short reviews.
"""

import json
from dataclasses import dataclass

from app.models import RunCreate
from app.systemone import questions as question_sets

TOKENS_INTERCEPT = 893.1  # fitted for question set v1
TOKENS_PER_STATE_CHAR = 0.2445
# Measured Jev throughput was 64 reviews/s at concurrency 32 (M4c); the client limiter
# caps requests at the documented 40/s, so ETA uses whichever is lower.
JEV_MEASURED_RPS = 64.0
LAYA_CPU_REVIEWS_PER_S = 0.08  # M1, dev laptop
PACKED_TOKEN_FACTOR = 0.59  # pack=5 used 59% of single-request tokens (M4b, 5 reviews)


# Measured per question set: same 200 dev states, v1 1,018.1 vs v2 1,264.1 tokens per
# review (M8), so v2's question text costs 246 tokens more than v1's.
MEASURED_INTERCEPTS = {"v1": TOKENS_INTERCEPT, "v2": TOKENS_INTERCEPT + 246.0}


def question_tokens(version: str) -> float:
    """Measured intercept, else v1's scaled by question-text length (overestimated v2
    by ~110 tokens, so it errs towards a higher cost estimate)."""
    if version in MEASURED_INTERCEPTS:
        return MEASURED_INTERCEPTS[version]
    size = len(json.dumps(question_sets.get(version), ensure_ascii=False))
    return TOKENS_INTERCEPT * size / len(json.dumps(question_sets.get("v1"), ensure_ascii=False))


@dataclass
class Preflight:
    backend: str
    reviews: int
    calls: int
    est_input_tokens: int
    est_cost_usd: float
    est_seconds: float
    limit_usd: float
    needs_confirmation: bool

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def estimate(
    states: list[dict],
    req: RunCreate,
    *,
    price_per_mtok: float,
    requests_per_second: float,
    limit_usd: float,
    distinct_inputs: int | None = None,
) -> Preflight:
    n = len(states)
    judged = distinct_inputs if (req.reuse_identical_inputs and distinct_inputs) else n
    calls = judged * req.samples_per_review
    chars = sum(len(json.dumps(s, ensure_ascii=False)) for s in states) / max(n, 1)
    per_call = question_tokens(req.question_set) + TOKENS_PER_STATE_CHAR * chars
    if req.pack_size > 1:
        per_call *= PACKED_TOKEN_FACTOR
    tokens = int(calls * per_call)
    cost = tokens * price_per_mtok / 1_000_000
    if req.backend == "laya":
        seconds = calls / LAYA_CPU_REVIEWS_PER_S
    elif req.backend == "jev":
        requests = calls / req.pack_size
        seconds = requests / min(requests_per_second, JEV_MEASURED_RPS)
    else:
        seconds = 0.0
    return Preflight(
        backend=req.backend,
        reviews=n,
        calls=calls,
        est_input_tokens=tokens,
        est_cost_usd=round(cost, 4),
        est_seconds=round(seconds, 1),
        limit_usd=limit_usd,
        needs_confirmation=cost > limit_usd,
    )
