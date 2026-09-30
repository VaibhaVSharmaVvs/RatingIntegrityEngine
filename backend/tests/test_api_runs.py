import base64
import gzip
import json
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.systemone.mock import MockBackend

N = 600


def csv_bytes(n: int = N) -> bytes:
    lines = ["text,stars,when,user"]
    for i in range(n):
        day, minute = 1 + i // 200, i % 60
        hour = 12 if i % 200 < 120 else (i % 24)  # a busy hour each day
        lines.append(
            f"review number {i} the combat is fun,{1 + i % 5},2024-05-{day:02d}T{hour:02d}:{minute:02d}:00Z,user{i}"
        )
    return ("\n".join(lines) + "\n").encode()


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(data_dir=tmp_path, author_hash_salt="s" * 64)
    with TestClient(create_app(settings)) as c:
        yield c


def upload(client: TestClient) -> str:
    mapping = {"text": "text", "rating": "stars", "timestamp": "when", "author": "user"}
    r = client.post(
        "/datasets/csv",
        files={"file": ("r.csv", csv_bytes(), "text/csv")},
        data={"name": "test", "mapping": json.dumps(mapping)},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def read_sse(client: TestClient, run_id: str) -> list[tuple[str, dict]]:
    events, name = [], None
    with client.stream("GET", f"/runs/{run_id}/events") as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and name:
                events.append((name, json.loads(line.split(":", 1)[1])))
                name = None
    return events


def test_dataset_upload_detail_and_privacy(client: TestClient) -> None:
    ds = upload(client)
    detail = client.get(f"/datasets/{ds}").json()
    assert detail["n_reviews"] == N
    assert detail["rating_scale"] == "1-5"
    assert sum(b["count"] for b in detail["histogram"]) == N
    assert [t["day"] for t in detail["timeline"]] == ["2024-05-01", "2024-05-02", "2024-05-03"]
    assert [d["id"] for d in client.get("/datasets").json()] == [ds]

    db = client.app.state.rie.db
    with db.cursor() as cur:
        dump = json.dumps(cur.execute("SELECT * FROM reviews").fetchall(), default=str)
    assert "user1" not in dump  # raw author IDs are never stored


def test_full_mock_run_streams_every_event_and_replays(client: TestClient) -> None:
    ds = upload(client)
    r = client.post("/runs", json={"dataset_id": ds, "backend": "mock", "bootstrap_resamples": 200})
    assert r.status_code == 201, r.text
    run_id = r.json()["id"]

    events = read_sse(client, run_id)
    kinds = {k for k, _ in events}
    assert {"stage", "features_done", "judged", "counters", "rating", "cluster", "done"} <= kinds
    assert "error" not in kinds
    assert events[-1][0] == "done"

    # Every review is judged exactly once across the judged events.
    seen = np.concatenate(
        [
            np.frombuffer(base64.b64decode(e["indices_b64"]), dtype="<u4")
            for k, e in events
            if k == "judged"
        ]
    )
    assert sorted(seen.tolist()) == list(range(N))

    stages = [(e["name"], e["status"]) for k, e in events if k == "stage"]
    assert [s for s, st in stages if st == "done"] == [
        "ingest",
        "features",
        "systemone",
        "corpus",
        "decide",
    ]

    final = next(e for k, e in events if k == "rating" and e["final"])
    assert final["ci"][0] <= final["adjusted"] <= final["ci"][1]

    run = client.get(f"/runs/{run_id}").json()
    assert run["status"] == "done"
    assert sum(run["summary"]["counts"].values()) == N
    assert run["summary"]["model_version"] == "mock-1"

    grid = np.frombuffer(client.get(f"/runs/{run_id}/grid").content, dtype=np.uint8)
    assert len(grid) == N and (grid > 0).all()

    # The replay holds the same events, in the same order, with rising timestamps.
    replay = client.get(f"/runs/{run_id}/replay")
    lines = [json.loads(x) for x in gzip.decompress(replay.content).decode().splitlines()]
    assert [ln["event"]["type"] for ln in lines] == [k for k, _ in events]
    ts = [ln["t"] for ln in lines]
    assert ts == sorted(ts)

    # A late subscriber (after the run) still gets the full stream.
    assert [k for k, _ in read_sse(client, run_id)] == [k for k, _ in events]


def test_mock_runs_are_reproducible(client: TestClient) -> None:
    ds = upload(client)
    grids = []
    for _ in range(2):
        run_id = client.post("/runs", json={"dataset_id": ds, "bootstrap_resamples": 100}).json()[
            "id"
        ]
        read_sse(client, run_id)
        grids.append(client.get(f"/runs/{run_id}/grid").content)
    assert grids[0] == grids[1]


def test_backend_failure_emits_error_event(client: TestClient, monkeypatch) -> None:
    async def boom(self, ids, states):
        raise RuntimeError("backend exploded")

    monkeypatch.setattr(MockBackend, "judge_batch", boom)
    ds = upload(client)
    run_id = client.post("/runs", json={"dataset_id": ds}).json()["id"]
    events = read_sse(client, run_id)
    assert events[-1] == (
        "error",
        {
            "t": events[-1][1]["t"],
            "type": "error",
            "message": "backend exploded",
            "retryable": False,
        },
    )
    run = client.get(f"/runs/{run_id}").json()
    assert run["status"] == "failed" and run["error"] == "backend exploded"


def test_unimplemented_backend_is_rejected(client: TestClient) -> None:
    ds = upload(client)
    r = client.post("/runs", json={"dataset_id": ds, "backend": "jev"})
    assert r.status_code == 422


def test_unknown_ids_404(client: TestClient) -> None:
    assert client.get("/datasets/nope").status_code == 404
    assert client.get("/runs/nope").status_code == 404
    assert client.get("/runs/nope/events").status_code == 404


def test_csv_preview_endpoint(client: TestClient) -> None:
    r = client.post("/datasets/csv/preview", files={"file": ("r.csv", csv_bytes(20), "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["n_rows"] == 20 and len(body["rows"]) == 10
    assert body["rating_scale_guesses"]["stars"] == "1-5"
