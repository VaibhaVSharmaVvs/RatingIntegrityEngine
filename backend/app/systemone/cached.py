"""Replay System One answers from a finished run: $0, no network.

Used to re-run S3/S4 with different settings (sensitivity analysis, ablations,
Phase 6 sliders) without paying for the same Jev calls again. The source run must be
on the same dataset and question set.
"""

import json

from app.core.db import Database


class CachedBackend:
    cost_usd = 0.0
    tokens_in = 0

    def __init__(
        self, db: Database, source_run_id: str, dataset_id: str, question_set: str
    ) -> None:
        with db.cursor() as cur:
            run = cur.execute(
                "SELECT dataset_id, model_version, config, status FROM runs WHERE id = ?",
                [source_run_id],
            ).fetchone()
            if run is None:
                raise ValueError(f"source run {source_run_id} not found")
            src_dataset, version, config, status = run
            if status != "done":
                raise ValueError(f"source run {source_run_id} is {status}, not done")
            if src_dataset != dataset_id:
                raise ValueError("source run is on a different dataset")
            src_qs = json.loads(config).get("question_set")
            if src_qs != question_set:
                raise ValueError(f"source run used question set {src_qs}, not {question_set}")
            rows = cur.execute(
                "SELECT review_id, question_id, type, value, choice, probabilities, confidence "
                "FROM judgments WHERE run_id = ?",
                [source_run_id],
            ).fetchall()
        if not rows:
            raise ValueError("source run has no System One judgments (mock/heuristic?)")
        self.answers: dict[int, dict[str, dict]] = {}
        for rid, qid, kind, value, choice, probs, conf in rows:
            a: dict = {"type": kind}
            if kind == "noul":
                a["noul"] = value
            elif kind == "score":
                a["score"] = value
            else:
                a["choice"] = choice
            if probs:
                a["probabilities"] = json.loads(probs)
            if conf is not None:
                a["confidence"] = conf
            self.answers.setdefault(rid, {})[qid] = a
        self.model_version = f"cached:{version}"
        self.source_run_id = source_run_id

    async def judge_batch(self, review_ids: list[int], states: list[dict]) -> list[dict]:
        try:
            return [self.answers[rid] for rid in review_ids]
        except KeyError as exc:
            raise ValueError(
                f"review {exc} has no cached judgment in {self.source_run_id}"
            ) from exc
