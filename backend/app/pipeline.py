"""Run orchestrator: S0 Ingest → S1 Features → S2 System One → S3 Corpus → S4 Decide.

One asyncio task per run (MVP_SPEC §3). Status per stage:
- S0: real (loads the dataset).
- S1: real. Deterministic features first (seconds), which mark later copies.
  Embeddings start in a background thread here and overlap S2; S3 waits for them.
- S2: real streaming loop and per-review policy, with the later-copy rule as a floor.
  Every review is judged; byte-identical inputs share one call. Backends: `mock`,
  `heuristic` (no model, ablation a); Jev/Laya land in Phase 3.
- S3: real. Bursts (trailing-baseline robust z), duplicate clusters (S1 groups),
  semantic clusters (UMAP -> HDBSCAN), suspicion factors, c-TF-IDF phrases.
- S4: real. Cluster penalty + in-burst copy escalation, then weights, adjusted
  rating, bootstrap CI, n_eff, Steam labels.
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
from app.corpus.bursts import change_points, detect_bursts
from app.corpus.clusters import duplicate_clusters, semantic_clusters, top_phrases
from app.corpus.suspicion import ClusterStats, NullModel, score_cluster
from app.decide.policy import (
    Decision,
    apply_cluster_rules,
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
    CorpusSummary,
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
        self.clusters: list[ClusterStats] = []
        self.corpus_info: dict = {}
        self.base_integrity: dict[int, float] = {}
        self.cluster_of = np.zeros(0, dtype=int)
        self.cluster_suspicion = np.zeros(0)
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
            idx.append(rid)
            act.append(int(d.action))
        # Fill the grid chunk by chunk as it is emitted, so each live rating covers only
        # the reviews decided so far (as with System One), not the final answer up front.
        for start in range(0, len(idx), EMIT_EVERY_N):
            chunk_idx, chunk_act = (
                idx[start : start + EMIT_EVERY_N],
                act[start : start + EMIT_EVERY_N],
            )
            self.grid[chunk_idx] = chunk_act
            self._emit_progress(chunk_idx, chunk_act)

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
        """S3: bursts, duplicate + semantic clusters, suspicion (MVP_SPEC §6.4)."""
        self.bus.publish(StageEvent(name="corpus", status="started"))
        if self._semantic_task is not None:
            self.semantic = await self._semantic_task
            self.timings.update({f"semantic_{k}": v for k, v in self.semantic.timings_s.items()})
            self._store_semantic(self.semantic)
        stats, extra = await asyncio.to_thread(self._analyse_corpus)
        self.clusters = stats
        self.corpus_info = extra
        self._store_clusters(stats)
        ranked = sorted(range(len(stats)), key=lambda i: -stats[i].suspicion)
        for cid in ranked[: self.config.suspicion.max_cluster_events]:
            c = stats[cid]
            self.bus.publish(
                ClusterEvent(
                    cid=cid, kind=c.kind, size=c.size, suspicion=c.suspicion, caption=c.caption
                )
            )
        self.bus.publish(StageEvent(name="corpus", status="done"))

    def _analyse_corpus(self) -> tuple[list[ClusterStats], dict]:
        cfg = self.config
        t0 = time.perf_counter()
        n = self.reviews.height
        created = (
            self.reviews["created_at"]
            .dt.replace_time_zone(None)
            .to_numpy()
            .astype("datetime64[us]")
        )
        corpus_times = np.sort(created[~np.isnat(created)])
        rating = self.reviews["rating_norm"].fill_null(np.nan).to_numpy().astype(float)
        f = self.features_frame
        has_accounts = f["single_review_account"].null_count() < f.height
        new_account = (
            (
                f["single_review_account"].fill_null(False) | f["low_playtime"].fill_null(False)
            ).to_numpy()
            if has_accounts
            else None
        )
        offtopic = None
        if self.answers:
            topics = set(cfg.suspicion.offtopic_topics)
            offtopic = np.zeros(n)
            for rid, ans in self.answers.items():
                probs = ans.get("topic", {}).get("probabilities", {})
                offtopic[rid] = sum(v for k, v in probs.items() if k in topics)
        emb = self.semantic.embeddings if self.semantic else None
        common = dict(
            created_at=created,
            null=NullModel(corpus_times, cfg.suspicion.null_samples, cfg.seed),
            rating_norm=rating,
            embeddings=emb,
            new_account=new_account,
            offtopic_prob=offtopic,
            cfg=cfg.suspicion,
        )
        timings: dict[str, float] = {}
        stats: list[ClusterStats] = []

        t = time.perf_counter()
        bursts = detect_bursts(self.reviews.select("id", "created_at", "rating_norm"), cfg.bursts)
        cps = change_points(self.reviews.select("created_at", "rating_norm"), cfg.bursts)
        for b in bursts:
            s = score_cluster(
                "burst",
                np.asarray(b.member_ids),
                burst_rate=(b.size / b.hours, b.baseline_per_hour),
                **common,
            )
            s.window.update({"verdict": b.verdict, "peak_z": b.peak_z, "hours": b.hours})
            s.caption = f"{b.verdict.capitalize()} burst · " + s.caption
            stats.append(s)
        timings["bursts"] = time.perf_counter() - t

        t = time.perf_counter()
        for members in duplicate_clusters(f, cfg.clusters):
            stats.append(score_cluster("duplicate", members, **common))
        timings["duplicate_clusters"] = time.perf_counter() - t

        if emb is not None:
            groups, sem_t = semantic_clusters(emb, cfg.clusters, self.cache_dir, cfg.dataset_id)
            timings.update(sem_t)
            t = time.perf_counter()
            for members in groups:
                stats.append(score_cluster("semantic", members, **common))
            timings["semantic_scoring"] = time.perf_counter() - t

        t = time.perf_counter()
        texts = self.reviews["text"].fill_null("").to_list()
        for s, phrases in zip(
            stats,
            top_phrases(texts, [s.members for s in stats], cfg.clusters.top_phrases),
            strict=True,
        ):
            s.top_phrases = phrases
        timings["top_phrases"] = time.perf_counter() - t
        timings["total"] = time.perf_counter() - t0
        self.timings.update({f"corpus_{k}": round(v, 3) for k, v in timings.items()})
        return stats, {"change_points": cps}

    def _store_clusters(self, stats: list[ClusterStats]) -> None:
        if not stats:
            return
        rows = [
            [
                self.run_id,
                cid,
                s.kind,
                s.size,
                s.t_start,
                s.t_end,
                s.factors["time_concentration"],
                s.factors["similarity"],
                s.factors["rating_homogeneity"],
                s.factors["new_account_share"],
                s.factors["offtopic_mean"],
                s.suspicion,
                s.caption,
                json.dumps(s.top_phrases),
                json.dumps(s.window, default=str),
            ]
            for cid, s in enumerate(stats)
        ]
        members = pl.DataFrame(  # noqa: F841 (referenced by name in SQL)
            {
                "run_id": self.run_id,
                "cluster_id": np.concatenate(
                    [np.full(s.size, cid) for cid, s in enumerate(stats)]
                ).astype(np.int32),
                "review_id": np.concatenate([s.members for s in stats]).astype(np.int32),
            }
        ).to_arrow()
        with self.db.cursor() as cur:
            cur.executemany(
                "INSERT INTO clusters (run_id, cluster_id, kind, size, t_start, t_end, "
                "time_concentration, mean_similarity, rating_homogeneity, new_account_share, "
                "offtopic_mean, suspicion, caption, top_phrases, window_info) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            cur.execute(
                "INSERT INTO cluster_members SELECT run_id, cluster_id, review_id FROM members"
            )

    def _cluster_membership(self) -> tuple[np.ndarray, np.ndarray, list[str | None]]:
        """Per review: highest suspicion of any cluster it belongs to, that cluster id/kind."""
        n = self.reviews.height
        best = np.zeros(n)
        best_id = np.full(n, -1)
        min_size = self.config.thresholds.min_penalty_cluster_size
        for cid, s in enumerate(self.clusters):
            if s.size < min_size:
                continue
            better = s.suspicion > best[s.members]
            idx = s.members[better]
            best[idx] = s.suspicion
            best_id[idx] = cid
        kinds = [self.clusters[c].kind if c >= 0 else None for c in best_id]
        return best, best_id, kinds

    def _apply_cluster_rules(self) -> None:
        """S4 cluster step; emits `judged` updates for reviews whose action changed."""
        best, best_id, kinds = self._cluster_membership()
        self.cluster_of = best_id
        self.cluster_suspicion = best
        changed_idx, changed_act = [], []
        penalised = 0
        for rid, d in list(self.decisions.items()):
            self.base_integrity[rid] = d.integrity_score
            new = apply_cluster_rules(
                d,
                suspicion=float(best[rid]),
                cluster_kind=kinds[rid],
                later_copy=rid in self.later_copy,
                thresholds=self.config.thresholds,
            )
            if new is not d:
                penalised += 1
            if new.action != d.action:
                changed_idx.append(rid)
                changed_act.append(int(new.action))
                self.grid[rid] = new.action
            self.decisions[rid] = new
        self.corpus_info["penalised_reviews"] = penalised
        self.corpus_info["actions_changed_by_clusters"] = len(changed_idx)
        for start in range(0, len(changed_idx), EMIT_EVERY_N):
            self._emit_progress(
                changed_idx[start : start + EMIT_EVERY_N], changed_act[start : start + EMIT_EVERY_N]
            )

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
        self._apply_cluster_rules()
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
            corpus=CorpusSummary(
                clusters={
                    k: sum(c.kind == k for c in self.clusters)
                    for k in ("burst", "duplicate", "semantic")
                },
                suspicious_clusters=sum(
                    c.suspicion > self.config.thresholds.cluster_penalty_threshold
                    for c in self.clusters
                ),
                change_points=self.corpus_info.get("change_points", []),
                penalised_reviews=self.corpus_info.get("penalised_reviews", 0),
                actions_changed_by_clusters=self.corpus_info.get("actions_changed_by_clusters", 0),
            ),
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
                "base_integrity": [
                    round(self.base_integrity.get(rid, d.integrity_score), 4)
                    for rid, d in self.decisions.items()
                ],
                "cluster_id": [int(self.cluster_of[rid]) for rid in self.decisions],
                "cluster_suspicion": [
                    round(float(self.cluster_suspicion[rid]), 4) for rid in self.decisions
                ],
                "reasons": [json.dumps(d.reasons) for d in self.decisions.values()],
            }
        ).to_arrow()
        cols = (
            "run_id, review_id, action, weight, integrity_score, base_integrity, cluster_id, "
            "cluster_suspicion, reasons"
        )
        with self.db.cursor() as cur:
            cur.execute(f"INSERT INTO decisions ({cols}) SELECT {cols} FROM frame")
