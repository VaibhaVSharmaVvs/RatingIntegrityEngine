"""Export the showcase runs as static files for the public demo (Phase 8, MVP_SPEC §9).

The static build (`npm run build:static`) reads these instead of the API: no backend,
no database, no API key. One folder per run with the same JSON the API would return:

    bundle/index.json                         games, run ids, export time
    bundle/benchmarks.json                    GET /benchmarks
    bundle/datasets/<id>.json, <id>.hours.json
    bundle/runs/<id>/run.json                 GET /runs/{id}
    bundle/runs/<id>/replay.jsonl.gz          the recorded event stream
    bundle/runs/<id>/clusters.json            every cluster (GET /runs/{id}/clusters)
    bundle/runs/<id>/clusters/<cid>.json      cluster detail with a 40-review sample
    bundle/runs/<id>/scores.json              GET /runs/{id}/scores
    bundle/runs/<id>/rows.json                the reviews table index (one row per review)
    bundle/runs/<id>/reviews/<k>.json         review details, ids 1000k .. 1000k+999

Privacy: the API never returns author hashes or Steam ids. Review text is public Steam
content, but before it leaves this machine every text field is scrubbed of e-mail
addresses, links, phone numbers and @handles (`scrub`). Names written in free text
cannot be found reliably by pattern and are not removed; see docs/PLAN.md Phase 8.

Usage (from backend/, API on :8001):
    uv run python ../tools/export_bundle.py [--out ../frontend/public/bundle]
"""

import argparse
import gzip
import json
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from _api import client  # noqa: E402

CHUNK = 1000

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(
    r"(?:https?://|www\.)\S+|\b[\w-]+\.(?:com|net|org|gg|io|me|tv|ly|co|de|ru|uk)/\S*", re.I
)
_PHONE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{8,}\d(?!\w)")
_HANDLE = re.compile(r"(?<![\w@])@[A-Za-z0-9_]{2,}")


def scrub(text: str | None) -> str | None:
    """Remove contact details and handles from review text before publishing it."""
    if not text:
        return text
    t = _EMAIL.sub("[email]", text)
    t = _URL.sub("[link]", t)
    t = _PHONE.sub("[number]", t)
    return _HANDLE.sub("@[user]", t)


def _write(path: Path, data) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.write_text(body, encoding="utf-8")
    return len(body.encode())


def showcase_runs() -> list[dict]:
    """The games the home page lists (frontend/src/data/showcase.ts is the source)."""
    ts = (ROOT / "frontend" / "src" / "data" / "showcase.ts").read_text(encoding="utf-8")
    games = []
    for block in re.findall(r"\{\s*key: '(.*?)'.*?runId: '(.*?)',?\s*\}", ts, re.S):
        games.append({"key": block[0], "runId": block[1]})
    if not games:
        sys.exit("no games found in showcase.ts")
    return games


def export_run(c, run_id: str, out: Path, with_text: bool = True) -> int:
    base = out / "runs" / run_id
    total = 0
    run = c.get(f"/runs/{run_id}").json()
    total += _write(base / "run.json", run)
    ds_id = run["dataset_id"]
    ds = c.get(f"/datasets/{ds_id}").json()
    total += _write(out / "datasets" / f"{ds_id}.json", ds)
    total += _write(
        out / "datasets" / f"{ds_id}.hours.json", c.get(f"/datasets/{ds_id}/hours").json()
    )

    replay = c.get(f"/runs/{run_id}/replay").content
    (base / "replay.jsonl.gz").write_bytes(replay)
    total += len(replay)

    clusters = c.get(f"/runs/{run_id}/clusters", params={"limit": 1000}).json()
    for cl in clusters:
        cl["caption"] = scrub(cl["caption"])
        cl["top_phrases"] = [scrub(p) for p in cl["top_phrases"]]
    total += _write(base / "clusters.json", clusters)

    def detail(cid: int) -> int:
        d = c.get(f"/runs/{run_id}/clusters/{cid}", params={"sample": 40}).json()
        d["caption"] = scrub(d["caption"])
        d["top_phrases"] = [scrub(p) for p in d["top_phrases"]]
        for m in d["sample"]:
            m["text"] = scrub(m["text"]) if with_text else ""
        return _write(base / "clusters" / f"{cid}.json", d)

    with ThreadPoolExecutor(4) as pool:
        total += sum(pool.map(detail, [cl["cluster_id"] for cl in clusters]))

    total += _write(base / "scores.json", c.get(f"/runs/{run_id}/scores").json())

    rows, offset = [], 0
    while True:
        page = c.get(f"/runs/{run_id}/reviews", params={"limit": 500, "offset": offset}).json()
        rows += page["items"]
        offset += 500
        if offset >= page["total"]:
            break
    for r in rows:
        r["snippet"] = scrub(r["snippet"]) if with_text else ""
    total += _write(base / "rows.json", rows)

    n = ds["n_reviews"]
    for k in range(0, n, CHUNK):
        details = c.get(
            f"/runs/{run_id}/review-details", params={"offset": k, "limit": CHUNK}
        ).json()
        for d in details:
            d["text"] = scrub(d["text"]) if with_text else ""
            d["cluster_caption"] = scrub(d["cluster_caption"])
        total += _write(base / "reviews" / f"{k // CHUNK}.json", details)

    # a cached run replays another run's answers: the UI shows that run's pace and cost
    src = run["config"].get("reuse_judgments_from")
    if src:
        total += _write(out / "runs" / src / "run.json", c.get(f"/runs/{src}").json())
    return total


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--out", default=str(ROOT / "frontend" / "public" / "bundle"))
    p.add_argument(
        "--text",
        choices=["full", "none"],
        default="full",
        help="'none' publishes ratings, decisions and clusters without any review text",
    )
    args = p.parse_args()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    games = showcase_runs()
    with client(120) as c:
        sizes = {}
        for g in games:
            sizes[g["key"]] = export_run(c, g["runId"], out, with_text=args.text == "full")
            print(f"{g['key']:8s} {g['runId']}  {sizes[g['key']] / 2**20:6.1f} MB", flush=True)
        benches = c.get("/benchmarks").json()
        _write(out / "benchmarks.json", benches)
    _write(
        out / "index.json",
        {
            "exported_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "texts": args.text == "full",
            "games": games,
        },
    )
    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    gz = sum(len(gzip.compress(f.read_bytes())) for f in out.rglob("*.json"))
    print(f"bundle: {total / 2**20:.1f} MB on disk, JSON ~{gz / 2**20:.1f} MB gzipped -> {out}")


if __name__ == "__main__":
    main()
