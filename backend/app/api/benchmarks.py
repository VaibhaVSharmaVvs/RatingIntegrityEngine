"""Phase 7 benchmark results: written by the tools/bench_*.py scripts, read by the
benchmarks page. Metrics are stored as the scripts computed them; nothing here derives
numbers."""

import json

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import AppState, get_state
from app.ingest.store import new_id
from app.models import BenchmarkIn, BenchmarkOut

router = APIRouter(prefix="/benchmarks", tags=["benchmarks"])

_COLS = "id, kind, name, backend, question_set, run_ids, metrics, cost_usd, notes, created_at"


def _row(row: tuple) -> BenchmarkOut:
    f = dict(zip(_COLS.split(", "), row, strict=True))
    f["run_ids"] = json.loads(f["run_ids"])
    f["metrics"] = json.loads(f["metrics"])
    return BenchmarkOut(**f)


@router.get("", response_model=list[BenchmarkOut])
def list_benchmarks(state: AppState = Depends(get_state)) -> list[BenchmarkOut]:
    with state.db.cursor() as cur:
        rows = cur.execute(f"SELECT {_COLS} FROM benchmarks ORDER BY created_at").fetchall()
    return [_row(r) for r in rows]


@router.post("", response_model=BenchmarkOut, status_code=201)
def record_benchmark(b: BenchmarkIn, state: AppState = Depends(get_state)) -> BenchmarkOut:
    bid = new_id("bench")
    with state.db.cursor() as cur:
        cur.execute(
            "INSERT INTO benchmarks (id, kind, name, backend, question_set, run_ids, metrics, "
            "cost_usd, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                bid,
                b.kind,
                b.name,
                b.backend,
                b.question_set,
                json.dumps(b.run_ids),
                json.dumps(b.metrics),
                b.cost_usd,
                b.notes,
            ],
        )
        row = cur.execute(f"SELECT {_COLS} FROM benchmarks WHERE id = ?", [bid]).fetchone()
    return _row(row)


@router.delete("/{bench_id}", status_code=204)
def delete_benchmark(bench_id: str, state: AppState = Depends(get_state)) -> None:
    """Remove a superseded result (the runs it points to are kept)."""
    with state.db.cursor() as cur:
        if not cur.execute("SELECT 1 FROM benchmarks WHERE id = ?", [bench_id]).fetchone():
            raise HTTPException(404, f"benchmark {bench_id} not found")
        cur.execute("DELETE FROM benchmarks WHERE id = ?", [bench_id])
