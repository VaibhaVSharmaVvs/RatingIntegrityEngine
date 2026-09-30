"""Run orchestrator: S0 Ingest → S1 Features → S2 System One → S3 Corpus → S4 Decide.

One asyncio task per run (MVP_SPEC §3). Phase 1 status per stage:
- S0: real (loads the dataset).
- S1: placeholder, real features land in Phase 2.
- S2: real streaming loop and per-review policy; backend is `mock` until Phase 3.
- S3: busiest-hour stub, real clustering and bursts land in Phase 4.
- S4: real weights, adjusted rating, bootstrap CI, n_eff, Steam labels.
"""

import asyncio
import base64
import json
import logging
import time
from datetime import UTC, datetime

import numpy as np
import polars as pl

from app.core.db import Database
from app.core.events import RunEventBus
from app.decide.policy import Decision, decide
from app.decide.rating import bootstrap_ci, n_eff, steam_label, weighted_mean
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
from app.systemone.mock import MockBackend
from app.systemone.questions_v1 import QUESTIONS, build_state

log = logging.getLogger("pipeline")

BATCH_SIZE = 50
EMIT_EVERY_N = 250
EMIT_EVERY_S = 0.2
SCORE_LEVELS = {q: len(s["criteria"]) for q, s in QUESTIONS.items() if s["type"] == "score"}
ACTION_NAMES = {c: c.name for c in ActionCode if c is not ActionCode.PENDING}


class Pipeline:
    def __init__(self, db: Database, run_id: str, config: RunCreate, bus: RunEventBus) -> None:
        self.db = db
        self.run_id = run_id
        self.config = config
        self.bus = bus
        self.backend = self._make_backend()
        self.grid = np.zeros(0, dtype=np.uint8)
        self.reviews = pl.DataFrame()
        self.dataset: dict = {}
        self.decisions: dict[int, Decision] = {}
        self.answers: dict[int, dict] = {}
        self.cost_usd = 0.0
        self.tokens_in = 0
        self._t0 = 0.0

    def _make_backend(self) -> MockBackend:
        if self.config.backend != "mock":
            raise ValueError(f"backend '{self.config.backend}' is not implemented yet (Phase 3)")
        return MockBackend(seed=self.config.seed, latency_ms=self.config.mock_latency_ms)

    # --- lifecycle ------------------------------------------------------------------

    async def run(self) -> None:
        self._t0 = time.monotonic()
        self._set_run(status="running", started_at=datetime.now(UTC))
        try:
            await self.ingest()
            await self.features()
            await self.systemone()
            await self.corpus()
            summary = await self.decide()
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
                "SELECT name, source, rating_scale FROM datasets WHERE id = ?",
                [self.config.dataset_id],
            ).fetchone()
            if row is None:
                raise ValueError(f"dataset {self.config.dataset_id} not found")
            self.dataset = dict(zip(("name", "source", "rating_scale"), row, strict=True))
            self.reviews = cur.execute(
                "SELECT id, text, rating_norm, created_at FROM reviews "
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
        self.bus.publish(FeaturesDoneEvent(counts={"reviews": self.reviews.height}))
        self.bus.publish(StageEvent(name="features", status="done"))

    # --- S2 -------------------------------------------------------------------------

    async def systemone(self) -> None:
        self.bus.publish(StageEvent(name="systemone", status="started"))
        ids = self.reviews["id"].to_list()
        texts = self.reviews["text"].to_list()
        verdicts = self.reviews["rating_norm"].to_list()
        game = self.dataset["name"]
        batches = [(ids[i : i + BATCH_SIZE], i) for i in range(0, len(ids), BATCH_SIZE)]
        sem = asyncio.Semaphore(self.config.concurrency)
        pending_idx: list[int] = []
        pending_act: list[int] = []
        last_emit = time.monotonic()

        async def judge(batch_ids: list[int], offset: int) -> tuple[list[int], list[dict]]:
            states = [
                build_state(game, (verdicts[offset + k] or 0) >= 0.5, texts[offset + k])
                for k in range(len(batch_ids))
            ]
            async with sem:
                return batch_ids, await self.backend.judge_batch(batch_ids, states)

        tasks = [asyncio.create_task(judge(b, off)) for b, off in batches]
        for fut in asyncio.as_completed(tasks):
            batch_ids, answers = await fut
            for rid, ans in zip(batch_ids, answers, strict=True):
                d = decide(ans, self.config.thresholds, score_levels=SCORE_LEVELS)
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
        self._store_judgments()
        self.bus.publish(StageEvent(name="systemone", status="done"))

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
        """Phase 1 stub: report the busiest UTC hour. Not a suspicion judgment."""
        self.bus.publish(StageEvent(name="corpus", status="started"))
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
        )
        self.bus.publish(StageEvent(name="decide", status="done"))
        return summary

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
