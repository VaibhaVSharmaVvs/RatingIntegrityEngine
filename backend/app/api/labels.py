"""Blind human labelling for the agreement benchmark (MVP_SPEC §10).

A label set is a fixed list of reviews (tools/make_labelset.py writes it under
data/bench/labelsets/). Raters see the text and the verdict only, never System One's
answers or the engine's decision. One label per (set, review, rater); saving again
replaces it. Rater names are free text: use initials or a handle, not a full name.
"""

import json

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import AppState, get_state
from app.models import HUMAN_LABEL_KEYS, LabelIn, LabelItem, LabelSet, LabelSetSummary

router = APIRouter(prefix="/labelsets", tags=["labels"])


def _load(state: AppState, name: str) -> dict:
    path = state.settings.data_dir / "bench" / "labelsets" / f"{name}.json"
    if not name.replace("-", "").replace("_", "").isalnum() or not path.exists():
        raise HTTPException(404, f"label set {name} not found")
    return json.loads(path.read_text(encoding="utf-8"))


def _labels(state: AppState, s: dict, rater: str | None = None) -> list[tuple[int, str, dict]]:
    ids = [i["review_id"] for i in s["items"]]
    sql = (
        "SELECT review_id, rater, label FROM labels WHERE dataset_id = ? "
        "AND list_contains(?, review_id)"
    )
    params: list = [s["dataset_id"], ids]
    if rater:
        sql += " AND rater = ?"
        params.append(rater)
    with state.db.cursor() as cur:
        rows = cur.execute(sql, params).fetchall()
    return [(r, who, json.loads(lab)) for r, who, lab in rows]


@router.get("", response_model=list[LabelSetSummary])
def list_sets(state: AppState = Depends(get_state)) -> list[LabelSetSummary]:
    folder = state.settings.data_dir / "bench" / "labelsets"
    out = []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        s = json.loads(path.read_text(encoding="utf-8"))
        done: dict[str, int] = {}
        for _, who, _ in _labels(state, s):
            done[who] = done.get(who, 0) + 1
        out.append(LabelSetSummary(name=s["name"], size=len(s["items"]), labelled=done))
    return out


@router.get("/{name}", response_model=LabelSet)
def get_set(name: str, rater: str, state: AppState = Depends(get_state)) -> LabelSet:
    s = _load(state, name)
    ids = [i["review_id"] for i in s["items"]]
    with state.db.cursor() as cur:
        rows = cur.execute(
            "SELECT id, text, rating_norm FROM reviews WHERE dataset_id = ? AND list_contains(?, id)",
            [s["dataset_id"], ids],
        ).fetchall()
    text = {i: (t, rn) for i, t, rn in rows}
    mine = {r: lab for r, _, lab in _labels(state, s, rater)}
    return LabelSet(
        name=s["name"],
        subject=s.get("subject", ""),
        items=[
            LabelItem(
                review_id=i,
                text=text[i][0],
                recommended=text[i][1] is not None and text[i][1] >= 0.5,
                label=mine.get(i),
            )
            for i in ids
        ],
    )


@router.put("/{name}/{review_id}", status_code=204)
def put_label(
    name: str, review_id: int, body: LabelIn, state: AppState = Depends(get_state)
) -> None:
    s = _load(state, name)
    if review_id not in {i["review_id"] for i in s["items"]}:
        raise HTTPException(404, f"review {review_id} is not in label set {name}")
    missing = set(HUMAN_LABEL_KEYS) - set(body.label)
    if missing:
        raise HTTPException(422, f"label is missing {sorted(missing)}")
    with state.db.cursor() as cur:
        cur.execute("BEGIN")
        cur.execute(
            "DELETE FROM labels WHERE dataset_id = ? AND review_id = ? AND rater = ?",
            [s["dataset_id"], review_id, body.rater],
        )
        cur.execute(
            "INSERT INTO labels (dataset_id, review_id, rater, label) VALUES (?, ?, ?, ?)",
            [s["dataset_id"], review_id, body.rater, json.dumps(body.label)],
        )
        cur.execute("COMMIT")
