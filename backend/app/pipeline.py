"""Run orchestrator: S0 Ingest → S1 Features → S2 System One → S3 Corpus → S4 Decide.

One asyncio task per run (MVP_SPEC §3). Status per stage:
- S0: real (loads the dataset).
- S1: real. Deterministic features first (seconds), which mark later copies.
  Embeddings start in a background thread here and overlap S2; S3 waits for them.
- S2: real streaming loop and per-review policy, with the later-copy rule as a floor.
  Every review is judged; byte-identical inputs share one call. Backends: `mock`,
  `heuristic` (no model, ablation a); Jev/Laya land in Phase 3.
- S3: busiest-hour stub; real clustering and bursts land in Phase 4.
- S4: real weights, adjusted rating, bootstrap CI, n_eff, Steam labels.
"""

import asyncio
import base64
import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import polars as pl

from app.core.db import Database
from app.core.events import RunEventBus
from app.decide.policy import (
    Decision,
    apply_duplicate_rule,
    decide,
    decide_heuristic,
    is_later_copy,
)
from app.decide.rating import bootstrap_ci, n_eff, steam_label, weighted_mean
from app.features.embeddings import Embedder, SentenceTransformerEmbedder
from app.features.extract import (
    SemanticResult,
    deterministic_features,
    feature_counts,
    semantic_features,
)
from app.models import (
    ActionCode,
    ClusterEvent,
    CountersEvent,
    DoneEvent,
    ErrorEvent,
    FeaturesDoneEvent,
    JudgedEvent,
    RatingEvent,
    RunCreate,
    RunSummary,
    StageEvent,
)
from app.systemone import questions as question_sets
from app.systemone.mock import MockBackend
from app.systemone.questions_v1 import build_state, verdict_words

if TYPE_CHECKING:
    from app.systemone.backend import SystemOneBackend

log = logging.getLogger("pipeline")

BATCH_SIZE = 50
EMIT_EVERY_N = 250
EMIT_EVERY_S = 0.2
# A run is stopped if actual spend exceeds the approved amount by this factor
# (token model residual SD is ~4%, so 1.25 only trips on a real mis-estimate).
COST_CAP_SLACK = 1.25


class SpendLimitExceeded(RuntimeError):
    pass


ACTION_NAMES = {c: c.name for c in ActionCode if c is not ActionCode.PENDING}
FEATURE_COLUMNS = [
    "review_id",
    "n_tokens",
    "type_token_ratio",
    "has_url",
    "has_promo",
    "emoji_ratio",
    "max_char_run",
    "promo_hits",
    "exact_group_id",
    "dup_group_id",
    "dup_of",
    "dup_score",
    "low_playtime",
    "single_review_account",
    "received_for_free",
    "not_purchased",
]


class HeuristicBackend:
    """No model: S2 is skipped and decisions come from S1 features only."""

    model_version = "heuristics-v1"


class Pipeline:
    def __init__(
        self,
        db: Database,
        run_id: str,
        config: RunCreate,
        bus: RunEventBus,
        *,
        cache_dir: Path,
        embedder: Embedder | None = None,
        backend: "SystemOneBackend | None" = None,
    ) -> None:
        self.db = db
        self.run_id = run_id
        self.config = config
        self.bus = bus
        self.cache_dir = cache_dir
        fc = config.features
        self.embedder = embedder or SentenceTransformerEmbedder(
            fc.embedding_model, fc.embedding_max_seq_len
        )
        self.backend = backend or self._make_backend()
        self.features_frame = pl.DataFrame()
        self.semantic: SemanticResult | None = None
        self._semantic_task: asyncio.Task | None = None
        self.timings: dict[str, float] = {}
        self.later_copy: set[int] = set()
        self.questions = question_sets.get(config.question_set)
        self.score_levels = question_sets.score_levels(config.question_set)
        self.cost_cap_usd: float | None = None  # set by the API from the pre-flight
        self.reused_judgments = 0
        self.grid = np.zeros(0, dtype=np.uint8)
        self.reviews = pl.DataFrame()
        self.dataset: dict = {}
        self.decisions: dict[int, Decision] = {}
        self.answers: dict[int, dict] = {}
        self._t0 = 0.0

    @property
    def cost_usd(self) -> float:
        return float(getattr(self.backend, "cost_usd", 0.0))

    @property
    def tokens_in(self) -> int:
        return int(getattr(self.backend, "tokens_in", 0))

    def _make_backend(self) -> MockBackend | HeuristicBackend:
        if self.config.backend == "mock":
            return MockBackend(
                seed=self.config.seed,
                latency_ms=self.config.mock_latency_ms,
                questions=question_sets.get(self.config.question_set),
            )
        if self.config.backend == "heuristic":
            return HeuristicBackend()
        raise ValueError(f"backend '{self.config.backend}' must be passed in (it needs settings)")

    # --- lifecycle ------------------------------------------------------------------

    async def run(self) -> None:
        self._t0 = time.monotonic()
        self._set_run(status="running", started_at=datetime.now(UTC))
        try:
            for name, stage in (
                ("ingest", self.ingest),
                ("features", self.features),
                ("systemone", self.systemone),
                ("corpus", self.corpus),
            ):
                t = time.monotonic()
                await stage()
                self.timings[name] = round(time.monotonic() - t, 3)
            t = time.monotonic()
            summary = await self.decide()
            summary.timings_s["decide"] = round(time.monotonic() - t, 3)
            self._set_run(
                status="done",
                finished_at=datetime.now(UTC),
                stats=summary.model_dump_json(),
                model_version=self.backend.model_version,
                cost_usd=self.cost_usd,
                tokens_in=self.tokens_in,
            )
            self.bus.publish(DoneEvent(summary=summary))
        except Exception as exc:
            log.exception("run %s failed", self.run_id)
            self._set_run(status="failed", error=str(exc), finished_at=datetime.now(UTC))
            self.bus.publish(ErrorEvent(message=str(exc), retryable=False))
        finally:
            closer = getattr(self.backend, "aclose", None)
            if closer is not None:
                await closer()
            task = self._semantic_task
            if task is not None and not task.done():
                # A thread can't be cancelled; let it finish and drop its result.
                task.add_done_callback(lambda t: t.cancelled() or t.exception())
            self.bus.close()

    def _set_run(self, **fields) -> None:
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self.db.cursor() as cur:
            cur.execute(f"UPDATE runs SET {cols} WHERE id = ?", [*fields.values(), self.run_id])

    def _elapsed(self) -> float:
        return time.monotonic() - self._t0

    # --- S0 -------------------------------------------------------------------------

    async def ingest(self) -> None:
        self.bus.publish(StageEvent(name="ingest", status="started"))
        with self.db.cursor() as cur:
            row = cur.execute(
                "SELECT name, source, rating_scale, source_params FROM datasets WHERE id = ?",
                [self.config.dataset_id],
            ).fetchone()
            if row is None:
                raise ValueError(f"dataset {self.config.dataset_id} not found")
            self.dataset = dict(
                zip(("name", "source", "rating_scale", "source_params"), row, strict=True)
            )
            self.dataset["source_params"] = json.loads(self.dataset["source_params"] or "{}")
            self.reviews = cur.execute(
                "SELECT id, text, rating_raw, rating_norm, created_at, meta FROM reviews "
                "WHERE dataset_id = ? ORDER BY id",
                [self.config.dataset_id],
            ).pl()
        if self.reviews.is_empty():
            raise ValueError("dataset has no reviews")
        self.grid = np.zeros(self.reviews.height, dtype=np.uint8)
        self.bus.publish(StageEvent(name="ingest", status="done"))

    # --- S1 -------------------------------------------------------------------------

    async def features(self) -> None:
        self.bus.publish(StageEvent(name="features", status="started"))
        cfg = self.config.features
        frame, timings = await asyncio.to_thread(deterministic_features, self.reviews, cfg)
        self.features_frame = frame
        self._store_features(frame)

        # Later copies are marked here but still judged in S2 (accuracy over cost);
        # the copy rule is applied as a floor when each review is decided.
        self.later_copy = {
            rid
            for rid, dup_of, n_tok in frame.select("review_id", "dup_of", "n_tokens").iter_rows()
            if is_later_copy(rid, dup_of, n_tok, cfg.dup_min_tokens)
        }
        self.bus.publish(FeaturesDoneEvent(counts=feature_counts(frame, cfg), timings_s=timings))

        # Embeddings overlap S2; S3 awaits them.
        texts = self.reviews["text"].fill_null("").to_list()
        self._semantic_task = asyncio.create_task(
            asyncio.to_thread(
                semantic_features, texts, self.embedder, self.cache_dir, self.config.dataset_id
            )
        )
        self.bus.publish(StageEvent(name="features", status="done"))

    def _store_features(self, frame: pl.DataFrame) -> None:
        arrow = (  # noqa: F841 (referenced by name in SQL)
            frame.select(FEATURE_COLUMNS)
            .with_columns(pl.lit(self.run_id).alias("run_id"))
            .to_arrow()
        )
        cols = ", ".join(["run_id", *FEATURE_COLUMNS])
        with self.db.cursor() as cur:
            cur.execute(f"INSERT INTO features ({cols}) SELECT {cols} FROM arrow")

    # --- S2 -------------------------------------------------------------------------

    async def systemone(self) -> None:
        if isinstance(self.backend, HeuristicBackend):
            self._decide_heuristic()
            self.bus.publish(StageEvent(name="systemone", status="skipped"))
            return
        self.bus.publish(StageEvent(name="systemone", status="started"))
        promo = self.features_frame["has_promo"].to_list()
        texts = self.reviews["text"].to_list()
        verdicts = self.reviews["rating_norm"].to_list()
        raw_ratings = self.reviews["rating_raw"].to_list()
        metas = self.reviews["meta"].to_list()
        default_subject = self.dataset["source_params"].get("subject") or self.dataset["name"]
        scale, source = self.dataset["rating_scale"], self.dataset["source"]

        # By default every review gets its own call: Jev is not deterministic, and
        # sharing one draw across identical copies would flip them all together near
        # a threshold (MEASUREMENTS M7). `reuse_identical_inputs` trades that for cost.
        states: dict[str, dict] = {}
        members: dict[str, list[int]] = {}
        for rid in self.reviews["id"].to_list():
            subject = json.loads(metas[rid] or "{}").get("subject") or default_subject
            verdict = verdict_words(raw_ratings[rid], verdicts[rid], scale)
            state = build_state(subject, source, verdict, texts[rid])
            key = json.dumps(state, sort_keys=True, ensure_ascii=False)
            if not self.config.reuse_identical_inputs:
                key = f"{key}#{rid}"  # every review gets its own, independent call
            states.setdefault(key, state)
            members.setdefault(key, []).append(rid)
        self.reused_judgments = self.reviews.height - len(states)
        keys = list(states)
        batches = [keys[i : i + BATCH_SIZE] for i in range(0, len(keys), BATCH_SIZE)]
        sem = asyncio.Semaphore(self.config.concurrency)
        pending_idx: list[int] = []
        pending_act: list[int] = []
        last_emit = time.monotonic()

        async def judge(batch_keys: list[str]) -> tuple[list[str], list[dict]]:
            first_ids = [members[k][0] for k in batch_keys]
            async with sem:
                answers = await self.backend.judge_batch(first_ids, [states[k] for k in batch_keys])
            return batch_keys, answers

        tasks = [asyncio.create_task(judge(b)) for b in batches]
        for fut in asyncio.as_completed(tasks):
            batch_keys, answers = await fut
            if self.cost_cap_usd is not None and self.cost_usd > self.cost_cap_usd:
                for t in tasks:
                    t.cancel()
                raise SpendLimitExceeded(
                    f"stopped: spent ${self.cost_usd:.4f}, over the cap of "
                    f"${self.cost_cap_usd:.4f} (estimate x {COST_CAP_SLACK})"
                )
            for key, ans in zip(batch_keys, answers, strict=True):
                for rid in members[key]:
                    d = decide(
                        ans,
                        self.config.thresholds,
                        score_levels=self.score_levels,
                        has_promo=promo[rid],
                    )
                    d = self._with_copy_rule(rid, d)
                    self.answers[rid] = ans
                    self.decisions[rid] = d
                    self.grid[rid] = d.action
                    pending_idx.append(rid)
                    pending_act.append(int(d.action))
            now = time.monotonic()
            if len(pending_idx) >= EMIT_EVERY_N or now - last_emit >= EMIT_EVERY_S:
                self._emit_progress(pending_idx, pending_act)
                pending_idx, pending_act, last_emit = [], [], now
        if pending_idx:
            self._emit_progress(pending_idx, pending_act)
        if self.answers:
            self._store_judgments()
        self.bus.publish(StageEvent(name="systemone", status="done"))

    def _decide_heuristic(self) -> None:
        cfg = self.config.features
        idx, act = [], []
        for rid, n_tok, emoji, promo in self.features_frame.select(
            "review_id", "n_tokens", "emoji_ratio", "has_promo"
        ).iter_rows():
            d = decide_heuristic(
                n_tokens=n_tok,
                emoji_ratio=emoji,
                has_promo=promo,
                low_info_max_tokens=cfg.low_info_max_tokens,
            )
            d = self._with_copy_rule(rid, d)
            self.decisions[rid] = d
            self.grid[rid] = d.action
            idx.append(rid)
            act.append(int(d.action))
        for start in range(0, len(idx), EMIT_EVERY_N):
            self._emit_progress(
                idx[start : start + EMIT_EVERY_N], act[start : start + EMIT_EVERY_N]
            )

    def _with_copy_rule(self, rid: int, d: Decision) -> Decision:
        if rid in self.later_copy:
            return apply_duplicate_rule(d, self.config.thresholds.duplicate_action)
        return d

    def _emit_progress(self, idx: list[int], act: list[int]) -> None:
        self.bus.publish(
            JudgedEvent(
                indices_b64=base64.b64encode(np.asarray(idx, dtype="<u4").tobytes()).decode(),
                actions_b64=base64.b64encode(np.asarray(act, dtype=np.uint8).tobytes()).decode(),
            )
        )
        counts = np.bincount(self.grid, minlength=len(ActionCode))
        processed = int(counts[1:].sum())
        elapsed = self._elapsed()
        self.bus.publish(
            CountersEvent(
                keep=int(counts[ActionCode.KEEP]),
                down=int(counts[ActionCode.DOWNWEIGHT]),
                flag=int(counts[ActionCode.FLAG]),
                exclude=int(counts[ActionCode.EXCLUDE]),
                processed=processed,
                total=len(self.grid),
                rps=round(processed / elapsed, 2) if elapsed else 0.0,
                cost_usd=round(self.cost_usd, 6),
                elapsed_s=round(elapsed, 3),
            )
        )
        r, w = self._ratings_and_weights(pending_weight=1.0)
        self.bus.publish(
            RatingEvent(raw=float(r.mean()), adjusted=weighted_mean(r, w), n_eff=n_eff(w))
        )

    def _ratings_and_weights(self, pending_weight: float) -> tuple[np.ndarray, np.ndarray]:
        weights = self.config.weights
        lut = np.array(
            [
                pending_weight,
                weights.KEEP,
                weights.DOWNWEIGHT,
                weights.FLAG,
                weights.EXCLUDE,
            ]
        )
        r = self.reviews["rating_norm"].fill_null(np.nan).to_numpy().astype(float)
        w = lut[self.grid]
        valid = ~np.isnan(r)
        return r[valid], w[valid]

    def _store_judgments(self) -> None:
        rows = []
        for rid, ans in self.answers.items():
            for qid, a in ans.items():
                rows.append(
                    {
                        "run_id": self.run_id,
                        "review_id": rid,
                        "question_id": qid,
                        "type": a["type"],
                        "value": a.get("noul", a.get("score")),
                        "choice": a.get("choice"),
                        "probabilities": json.dumps(a["probabilities"])
                        if "probabilities" in a
                        else None,
                        "confidence": a.get("confidence"),
                    }
                )
        frame = pl.DataFrame(rows, infer_schema_length=None).to_arrow()  # noqa: F841
        with self.db.cursor() as cur:
            cur.execute(
                "INSERT INTO judgments (run_id, review_id, question_id, type, value, choice, "
                "probabilities, confidence) SELECT run_id, review_id, question_id, type, value, "
                "choice, probabilities, confidence FROM frame"
            )

    # --- S3 -------------------------------------------------------------------------

    async def corpus(self) -> None:
        """Waits for S1 embeddings, then (Phase 1 stub) reports the busiest UTC hour."""
        self.bus.publish(StageEvent(name="corpus", status="started"))
        if self._semantic_task is not None:
            self.semantic = await self._semantic_task
            self.timings.update({f"semantic_{k}": v for k, v in self.semantic.timings_s.items()})
            self._store_semantic(self.semantic)
        ts = self.reviews.filter(pl.col("created_at").is_not_null())
        if ts.is_empty():
            self.bus.publish(StageEvent(name="corpus", status="skipped"))
            return
        hourly = (
            ts.with_columns(hour=pl.col("created_at").dt.truncate("1h"))
            .group_by("hour")
            .agg(pl.col("id"), pl.len().alias("n"))
            .sort(["n", "hour"], descending=[True, False])
        )
        top = hourly.row(0, named=True)
        share = top["n"] / self.reviews.height
        caption = (
            f"Busiest hour {top['hour']:%Y-%m-%d %H:00} UTC: {top['n']} reviews "
            f"({share:.1%} of corpus). Placeholder; burst detection lands in Phase 4."
        )
        with self.db.cursor() as cur:
            cur.execute(
                "INSERT INTO clusters (run_id, cluster_id, kind, size, t_start, t_end, "
                "time_concentration, suspicion, caption) VALUES (?, 0, 'burst', ?, ?, ?, ?, 0, ?)",
                [self.run_id, top["n"], top["hour"], top["hour"], share, caption],
            )
            members = pl.DataFrame(  # noqa: F841
                {"run_id": self.run_id, "cluster_id": 0, "review_id": top["id"]}
            ).to_arrow()
            cur.execute(
                "INSERT INTO cluster_members SELECT run_id, cluster_id, review_id FROM members"
            )
        self.bus.publish(
            ClusterEvent(cid=0, kind="burst", size=top["n"], suspicion=0.0, caption=caption)
        )
        self.bus.publish(StageEvent(name="corpus", status="done"))

    def _store_semantic(self, sem: SemanticResult) -> None:
        arrow = pl.DataFrame(  # noqa: F841 (referenced by name in SQL)
            {
                "review_id": self.reviews["id"].cast(pl.Int32),
                "nn_review_id": sem.nn_review_id.astype(np.int32),
                "nn_cosine_max": sem.nn_cosine_max.astype(np.float64),
            }
        ).to_arrow()
        with self.db.cursor() as cur:
            cur.execute(
                "UPDATE features SET nn_review_id = a.nn_review_id, "
                "nn_cosine_max = a.nn_cosine_max, embedding_idx = a.review_id FROM arrow a "
                "WHERE features.run_id = ? AND features.review_id = a.review_id",
                [self.run_id],
            )

    # --- S4 -------------------------------------------------------------------------

    async def decide(self) -> RunSummary:
        self.bus.publish(StageEvent(name="decide", status="started"))
        r, w = self._ratings_and_weights(pending_weight=self.config.weights.KEEP)
        raw, adjusted, neff = float(r.mean()), weighted_mean(r, w), n_eff(w)
        ci = await asyncio.to_thread(
            bootstrap_ci, r, w, self.config.bootstrap_resamples, self.config.seed
        )
        self.bus.publish(RatingEvent(raw=raw, adjusted=adjusted, ci=ci, n_eff=neff, final=True))
        self._store_decisions()

        counts = np.bincount(self.grid, minlength=len(ActionCode))
        elapsed = self._elapsed()
        is_steam = self.dataset["source"] == "steam"
        summary = RunSummary(
            n_reviews=len(self.grid),
            counts={name: int(counts[code]) for code, name in ACTION_NAMES.items()},
            raw=raw,
            adjusted=adjusted,
            ci=ci,
            n_eff=neff,
            rating_scale=self.dataset["rating_scale"],
            steam_label_raw=steam_label(raw, len(r)) if is_steam else None,
            steam_label_adjusted=steam_label(adjusted, neff) if is_steam else None,
            cost_usd=self.cost_usd,
            tokens_in=self.tokens_in,
            elapsed_s=round(elapsed, 3),
            reviews_per_s=round(len(self.grid) / elapsed, 2) if elapsed else 0.0,
            model_version=self.backend.model_version,
            timings_s=dict(self.timings),
            reused_judgments=self.reused_judgments,
            **self._client_stats(),
            embedding_cache_hit=self.semantic.cache_hit if self.semantic else None,
        )
        self.bus.publish(StageEvent(name="decide", status="done"))
        return summary

    def _client_stats(self) -> dict:
        client = getattr(self.backend, "client", None)
        if client is None:
            return {}
        lat = np.asarray(client.usage.latency_ms)
        return {
            "requests": client.usage.requests,
            "retries": client.usage.retries,
            "latency_p50_ms": round(float(np.percentile(lat, 50)), 1) if lat.size else None,
            "latency_p95_ms": round(float(np.percentile(lat, 95)), 1) if lat.size else None,
        }

    def _store_decisions(self) -> None:
        weights = self.config.weights.model_dump()
        frame = pl.DataFrame(  # noqa: F841
            {
                "run_id": self.run_id,
                "review_id": list(self.decisions),
                "action": [d.action.name for d in self.decisions.values()],
                "weight": [weights[d.action.name] for d in self.decisions.values()],
                "integrity_score": [round(d.integrity_score, 4) for d in self.decisions.values()],
                "reasons": [json.dumps(d.reasons) for d in self.decisions.values()],
            }
        ).to_arrow()
        with self.db.cursor() as cur:
            cur.execute(
                "INSERT INTO decisions (run_id, review_id, action, weight, integrity_score, reasons) "
                "SELECT run_id, review_id, action, weight, integrity_score, reasons FROM frame"
            )
