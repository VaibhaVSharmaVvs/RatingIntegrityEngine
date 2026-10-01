"""Phase 6 drill-down endpoints: review detail and list, per-review scores for the
client-side sliders and waterfall, and export.

Privacy: nothing here returns `ext_id` (a Steam recommendation id links back to a
person) or `author_hash`. Export carries review text, verdicts and decisions only.
"""

import csv
import io
import json
from datetime import datetime

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.api.datasets import fetch_dataset
from app.api.deps import AppState, get_state
from app.api.runs import _fetch_run
from app.models import (
    ReviewDetail,
    ReviewMeta,
    ReviewPage,
    ReviewRow,
    ReviewSignals,
    RunOut,
    RunScores,
)

router = APIRouter(prefix="/runs", tags=["inspect"])

REASON_CODES = [
    "OFF_TOPIC",
    "CONTRADICTS_VERDICT",
    "SPAM",
    "TEMPLATED",
    "NEAR_DUPLICATE",
    "COORDINATED_CLUSTER",
    "BURST_WINDOW",
    "LOW_CONFIDENCE",
    "LOW_EXPERIENCE",
    "LOW_INFO",
    "UNSUPPORTED_VERDICT",
]
ACTIONS = {"KEEP": 1, "DOWNWEIGHT": 2, "FLAG": 3, "EXCLUDE": 4}


def _windows(run: RunOut) -> list[tuple[np.datetime64, np.datetime64]]:
    p = run.summary.platform if run.summary else None
    out = []
    for w in p.windows if p else []:
        start = np.datetime64(w.start.replace(tzinfo=None), "us")
        out.append(
            (start, np.datetime64(w.end.replace(tzinfo=None), "us") + np.timedelta64(1, "h"))
        )
    return out


def _platform_counts(
    created: datetime | None, steam_purchase: bool | None, windows, purchasers_only: bool
) -> bool:
    if purchasers_only and steam_purchase is False:
        return False
    if created is None:
        return True
    t = np.datetime64(created.replace(tzinfo=None), "us")
    return not any(a <= t < b for a, b in windows)


@router.get("/{run_id}/reviews/{review_id}", response_model=ReviewDetail)
def get_review(run_id: str, review_id: int, state: AppState = Depends(get_state)) -> ReviewDetail:
    run = _fetch_run(state, run_id)
    with state.db.cursor() as cur:
        row = cur.execute(
            "SELECT r.text, r.rating_raw, r.rating_norm, r.created_at, r.updated_at, r.meta, "
            "d.action, d.weight, d.integrity_score, d.reasons, d.base_integrity, d.cluster_id, "
            "d.cluster_suspicion FROM reviews r LEFT JOIN decisions d "
            "ON d.run_id = ? AND d.review_id = r.id WHERE r.dataset_id = ? AND r.id = ?",
            [run_id, run.dataset_id, review_id],
        ).fetchone()
        if row is None:
            raise HTTPException(404, f"review {review_id} not found")
        answers = {
            qid: _answer(kind, value, choice, probs, conf)
            for qid, kind, value, choice, probs, conf in cur.execute(
                "SELECT question_id, type, value, choice, probabilities, confidence FROM judgments "
                "WHERE run_id = ? AND review_id = ?",
                [run_id, review_id],
            ).fetchall()
        }
        f = cur.execute(
            "SELECT n_tokens, has_url, has_promo, promo_hits, dup_of, dup_score, nn_review_id, "
            "nn_cosine_max, low_playtime, single_review_account, received_for_free, not_purchased "
            "FROM features WHERE run_id = ? AND review_id = ?",
            [run_id, review_id],
        ).fetchone()
        cluster = None
        if row[11] is not None and row[11] >= 0:
            cluster = cur.execute(
                "SELECT kind, caption FROM clusters WHERE run_id = ? AND cluster_id = ?",
                [run_id, row[11]],
            ).fetchone()
    (
        text,
        raw,
        norm,
        created,
        updated,
        meta_json,
        action,
        weight,
        score,
        reasons,
        base,
        cid,
        susp,
    ) = row
    meta = json.loads(meta_json or "{}")
    playtime = meta.get("author_playtime_at_review")
    signals = None
    if f is not None:
        (
            n_tok,
            has_url,
            has_promo,
            hits,
            dup_of,
            dup_score,
            nn_id,
            nn_cos,
            low_play,
            single,
            free,
            not_pur,
        ) = f
        signals = ReviewSignals(
            n_tokens=n_tok,
            has_url=bool(has_url),
            has_promo=bool(has_promo),
            promo_hits=json.loads(hits or "[]"),
            duplicate_of=dup_of
            if dup_of is not None and dup_of >= 0 and dup_of != review_id
            else None,
            duplicate_score=dup_score,
            nearest_review_id=nn_id,
            nearest_cosine=nn_cos,
            low_playtime=low_play,
            single_review_account=single,
            received_for_free=free,
            key_activation=not_pur,
        )
    cfg = run.config.platform
    return ReviewDetail(
        review_id=review_id,
        text=text,
        rating_raw=raw,
        rating_norm=norm,
        created_at=created,
        action=action,
        weight=weight,
        integrity_score=score,
        reasons=json.loads(reasons or "[]"),
        base_integrity=base,
        cluster_id=cid if cid is not None and cid >= 0 else None,
        cluster_suspicion=susp,
        cluster_kind=cluster[0] if cluster else None,
        cluster_caption=cluster[1] if cluster else None,
        answers=answers,
        signals=signals,
        meta=ReviewMeta(
            playtime_hours=round(playtime / 60, 1) if playtime is not None else None,
            author_num_reviews=meta.get("author_num_reviews"),
            steam_purchase=meta.get("steam_purchase"),
            received_for_free=meta.get("received_for_free"),
            votes_up=meta.get("votes_up"),
            edited=bool(updated and created and (updated - created).total_seconds() > 3600),
            updated_at=updated,
        ),
        counts_in_platform_rating=_platform_counts(
            created, meta.get("steam_purchase"), _windows(run), cfg.purchasers_only
        ),
    )


def _answer(kind, value, choice, probs, conf) -> dict:
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
    return a


@router.get("/{run_id}/reviews", response_model=ReviewPage)
def list_reviews(
    run_id: str,
    action: str | None = Query(None, description="KEEP | DOWNWEIGHT | FLAG | EXCLUDE"),
    reason: str | None = None,
    cluster: int | None = None,
    verdict: str | None = Query(None, description="positive | negative"),
    q: str | None = Query(None, description="text contains (case-insensitive)"),
    sort: str = Query("time", description="time | integrity"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    state: AppState = Depends(get_state),
) -> ReviewPage:
    run = _fetch_run(state, run_id)
    where = ["r.dataset_id = ?"]
    params: list = [run_id, run.dataset_id]
    if action:
        where.append("d.action = ?")
        params.append(action.upper())
    if reason:
        where.append("list_contains(CAST(d.reasons AS VARCHAR[]), ?)")
        params.append(reason.upper())
    if verdict in ("positive", "negative"):
        where.append("r.rating_norm >= 0.5" if verdict == "positive" else "r.rating_norm < 0.5")
    if q:
        where.append("r.text ILIKE ?")
        params.append(f"%{q}%")
    join_cluster = ""
    if cluster is not None:
        join_cluster = "JOIN cluster_members m ON m.run_id = d.run_id AND m.review_id = r.id AND m.cluster_id = ?"
        params.insert(1, cluster)
    order = "d.integrity_score ASC NULLS LAST, r.id" if sort == "integrity" else "r.id"
    base = (
        f"FROM reviews r JOIN decisions d ON d.run_id = ? AND d.review_id = r.id {join_cluster} "
        f"WHERE {' AND '.join(where)}"
    )
    with state.db.cursor() as cur:
        total = cur.execute(f"SELECT count(*) {base}", params).fetchone()[0]
        rows = cur.execute(
            f"SELECT r.id, r.created_at, r.rating_norm, d.action, d.weight, d.integrity_score, "
            f"d.reasons, left(r.text, 220) {base} ORDER BY {order} LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return ReviewPage(
        total=total,
        offset=offset,
        items=[
            ReviewRow(
                review_id=i,
                created_at=c,
                rating_norm=rn,
                action=a,
                weight=w,
                integrity_score=s,
                reasons=json.loads(rs or "[]"),
                snippet=t,
            )
            for i, c, rn, a, w, s, rs, t in rows
        ],
    )


@router.get("/{run_id}/scores", response_model=RunScores)
def run_scores(run_id: str, state: AppState = Depends(get_state)) -> RunScores:
    """Per-review arrays (grid order) for client-side sensitivity and the waterfall."""
    run = _fetch_run(state, run_id)
    if run.status != "done":
        raise HTTPException(409, "scores are available when the run is done")
    with state.db.cursor() as cur:
        rows = cur.execute(
            "SELECT r.id, r.rating_norm, r.created_at, r.meta, d.action, d.integrity_score, "
            "d.base_integrity, d.reasons FROM reviews r LEFT JOIN decisions d "
            "ON d.run_id = ? AND d.review_id = r.id WHERE r.dataset_id = ? ORDER BY r.id",
            [run_id, run.dataset_id],
        ).fetchall()
    windows = _windows(run)
    purchasers_only = run.config.platform.purchasers_only
    reason_idx = {c: i for i, c in enumerate(REASON_CODES)}
    rating, integ, base, act, reason, plat = [], [], [], [], [], []
    for _id, rn, created, meta, a, s, b, rs in rows:
        rating.append(rn)
        integ.append(s)
        base.append(b if b is not None else s)
        act.append(ACTIONS.get(a or "", 0))
        codes = json.loads(rs or "[]")
        reason.append(reason_idx.get(codes[0], -1) if codes else -1)
        m = json.loads(meta or "{}")
        plat.append(_platform_counts(created, m.get("steam_purchase"), windows, purchasers_only))
    t = run.config.thresholds
    return RunScores(
        rating_norm=rating,
        integrity=integ,
        base_integrity=base,
        action=act,
        primary_reason=reason,
        reason_codes=REASON_CODES,
        counts_in_platform=plat,
        weights=run.config.weights,
        downweight_below=t.downweight_below,
    )


@router.get("/{run_id}/export")
def export_run(
    run_id: str,
    fmt: str = Query("csv", pattern="^(csv|json)$"),
    state: AppState = Depends(get_state),
) -> Response:
    run = _fetch_run(state, run_id)
    ds = fetch_dataset(state, run.dataset_id)
    with state.db.cursor() as cur:
        rows = cur.execute(
            "SELECT r.id, r.created_at, r.rating_raw, r.rating_norm, d.action, d.weight, "
            "d.integrity_score, d.base_integrity, d.reasons, r.text FROM reviews r "
            "LEFT JOIN decisions d ON d.run_id = ? AND d.review_id = r.id "
            "WHERE r.dataset_id = ? ORDER BY r.id",
            [run_id, run.dataset_id],
        ).fetchall()
    cols = [
        "review_id",
        "created_at",
        "rating_raw",
        "rating_norm",
        "action",
        "weight",
        "integrity_score",
        "base_integrity",
        "reasons",
        "text",
    ]
    name = f"{run_id}_decisions"
    if fmt == "json":
        body = {
            "run": run.model_dump(mode="json"),
            "dataset": {
                "id": ds.id,
                "name": ds.name,
                "source": ds.source,
                "rating_scale": ds.rating_scale,
            },
            "methodology_note": (
                "Not the 'true' rating: the ratings under this documented method. English "
                "reviews only; Steam reviews as they stand today (verdicts can be edited)."
            ),
            "decisions": [
                dict(zip(cols, [*r[:8], json.loads(r[8] or "[]"), r[9]], strict=True))
                | {"created_at": r[1].isoformat() if r[1] else None}
                for r in rows
            ],
        }
        return Response(
            json.dumps(body, default=str),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{name}.json"'},
        )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in rows:
        w.writerow([*r[:8], ";".join(json.loads(r[8] or "[]")), r[9]])
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )
