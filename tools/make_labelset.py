"""Draw the human-label set (MVP_SPEC §10): 300 Helldivers 2 reviews for two raters.

Sampled from the HD2 5K showcase dataset, whose v4 Jev answers already exist, so
human-Jev agreement costs nothing. Two strata, recorded per review so agreement can be
reported for each: 200 uniform over the whole window, 100 from the bomb window
(2024-05-03 08:00 → 05-06 08:00 UTC), where off-topic reviews concentrate. Fixed seed.

Usage (from backend/, API on :8001):
    uv run python ../tools/make_labelset.py
"""

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))
from _api import client  # noqa: E402

from app.core.config import settings  # noqa: E402

API = "http://localhost:8001"
HD2_RUN = "run_32a69a6357c9"  # HD2 5K, question set v4 (docs/RUNS.md)
BOMB = ("2024-05-03T08:00:00", "2024-05-06T08:00:00")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--name", default="hd2-300")
    p.add_argument("--uniform", type=int, default=200)
    p.add_argument("--bomb", type=int, default=100)
    p.add_argument("--seed", type=int, default=11)
    args = p.parse_args()

    with client(60) as c:
        run = c.get(f"/runs/{HD2_RUN}").json()
        rows, offset = [], 0
        while True:
            page = c.get(f"/runs/{HD2_RUN}/reviews", params={"limit": 500, "offset": offset}).json()
            rows += page["items"]
            offset += 500
            if offset >= page["total"]:
                break
    rng = random.Random(args.seed)
    in_bomb = [
        r["review_id"]
        for r in rows
        if r["created_at"] and BOMB[0] <= r["created_at"][:19] < BOMB[1]
    ]
    bomb = rng.sample(in_bomb, args.bomb)
    rest = [r["review_id"] for r in rows if r["review_id"] not in set(bomb)]
    uniform = rng.sample(rest, args.uniform)
    items = [{"review_id": i, "stratum": "uniform"} for i in uniform] + [
        {"review_id": i, "stratum": "bomb"} for i in bomb
    ]
    rng.shuffle(items)  # raters see the strata mixed
    out = settings.data_dir / "bench" / "labelsets" / f"{args.name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "name": args.name,
                "dataset_id": run["dataset_id"],
                "reference_run": HD2_RUN,
                "subject": "Helldivers 2",
                "seed": args.seed,
                "items": items,
            },
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"{len(items)} reviews ({args.uniform} uniform, {args.bomb} bomb window) -> {out}")


if __name__ == "__main__":
    main()
