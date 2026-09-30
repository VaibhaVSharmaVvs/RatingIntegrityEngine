"""One HTTP client for every System One backend (MVP_SPEC §6.3, CLAUDE.md).

Jev (api.typesafe.ai) and laya-serve speak the same wire protocol:
`POST /v1/systemone {model, state, questions}` -> `{model, answers, usage}`.
Switching backend means changing `base_url`, `model` and the price; no code fork.

- Rate limit: `aiolimiter` (requests/s) plus a concurrency semaphore.
- Retries: 429 / 529 / 5xx / transport errors, exponential backoff with jitter.
  401 and 422 are caller errors and fail at once.
- Parsing: answers are normalised to plain dicts with `type` plus `noul` | `score` |
  `choice`, `probabilities` and `confidence` where the backend provides them. Unknown
  extra fields (Laya adds `answer_confidence`, `action`) are ignored.
- Accounting: input tokens, cost, latency and the *resolved* model version reported by
  the response (e.g. `jev-latest` -> `jev-1.13.0`; PLAN C3).
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

import httpx
from aiolimiter import AsyncLimiter
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_random_exponential,
)

log = logging.getLogger("systemone")

RETRYABLE_STATUS = {429, 500, 502, 503, 504, 529}


class SystemOneError(Exception):
    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, SystemOneError):
        return exc.retryable
    return isinstance(exc, httpx.TransportError)


@dataclass
class BackendSpec:
    name: str  # 'jev' | 'laya'
    base_url: str
    model: str
    api_key: str = ""
    price_per_mtok: float = 0.0  # input tokens; output is free on Jev
    requests_per_second: float = 40.0
    concurrency: int = 32
    timeout_s: float = 60.0
    max_attempts: int = 6


@dataclass
class Usage:
    requests: int = 0
    input_tokens: int = 0
    retries: int = 0
    latency_ms: list[float] = field(default_factory=list)
    model_versions: set[str] = field(default_factory=set)


@dataclass
class Result:
    answers: dict[str, dict]
    input_tokens: int
    latency_ms: float
    model_version: str | None


def normalise_answer(raw: dict) -> dict:
    kind = raw.get("type")
    out: dict = {"type": kind}
    if kind == "noul":
        out["noul"] = float(raw["noul"])
    elif kind == "score":
        out["score"] = float(raw["score"])
    elif kind == "choice":
        out["choice"] = raw["choice"]
    else:
        raise SystemOneError(f"unknown answer type {kind!r}")
    if "probabilities" in raw:
        out["probabilities"] = {str(k): float(v) for k, v in raw["probabilities"].items()}
    # Jev documents confidence for choice/score only; Laya also sends one for noul.
    # Keep it for choice/score so both backends feed the policy the same signal.
    if kind != "noul" and raw.get("confidence") is not None:
        out["confidence"] = float(raw["confidence"])
    return out


class SystemOneClient:
    def __init__(self, spec: BackendSpec, transport: httpx.AsyncBaseTransport | None = None):
        self.spec = spec
        headers = {"Authorization": f"Bearer {spec.api_key}"} if spec.api_key else {}
        self._http = httpx.AsyncClient(
            base_url=spec.base_url,
            headers=headers,
            timeout=spec.timeout_s,
            transport=transport,
        )
        self._limiter = AsyncLimiter(spec.requests_per_second, 1)
        self._sem = asyncio.Semaphore(spec.concurrency)
        self.usage = Usage()

    @property
    def cost_usd(self) -> float:
        return self.usage.input_tokens * self.spec.price_per_mtok / 1_000_000

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "SystemOneClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self.aclose()

    async def ask(self, state: dict | str | list, questions: dict[str, dict]) -> Result:
        payload = {"model": self.spec.model, "state": state, "questions": questions}
        async for attempt in AsyncRetrying(
            retry=retry_if_exception(_is_retryable),
            wait=wait_random_exponential(multiplier=0.5, max=30),
            stop=stop_after_attempt(self.spec.max_attempts),
            reraise=True,
        ):
            with attempt:
                if attempt.retry_state.attempt_number > 1:
                    self.usage.retries += 1
                return await self._post(payload, questions)
        raise AssertionError("unreachable")  # pragma: no cover

    async def _post(self, payload: dict, questions: dict[str, dict]) -> Result:
        async with self._sem, self._limiter:
            t0 = time.perf_counter()
            try:
                r = await self._http.post("/v1/systemone", json=payload)
            except httpx.TransportError:
                log.warning("%s transport error; will retry", self.spec.name)
                raise
            latency = (time.perf_counter() - t0) * 1000
        if r.status_code != 200:
            detail = r.text[:300]
            raise SystemOneError(
                f"{self.spec.name} HTTP {r.status_code}: {detail}",
                status=r.status_code,
                retryable=r.status_code in RETRYABLE_STATUS,
            )
        body = r.json()
        raw_answers = body.get("answers", {})
        missing = set(questions) - set(raw_answers)
        if missing:
            raise SystemOneError(f"{self.spec.name} omitted answers for {sorted(missing)}")
        answers = {qid: normalise_answer(raw_answers[qid]) for qid in questions}
        tokens = int(body.get("usage", {}).get("input_tokens", 0))
        version = body.get("model")
        self.usage.requests += 1
        self.usage.input_tokens += tokens
        self.usage.latency_ms.append(latency)
        if version:
            self.usage.model_versions.add(version)
        return Result(answers, tokens, latency, version)
