"""Control games (MVP_SPEC §10): genuine reception that the engine must not "correct".

- Cities: Skylines II: an organic, on-topic negative burst. Must not be suppressed.
- Gollum: a genuinely bad game. The adjusted rating must not inflate (target < 5 pp).
- Football Manager 26: a genuine launch backlash.

For each run: raw, adjusted and platform-policy ratings, the move, and the false-positive
rate that matters here: the share of *on-topic* negative reviews (System One says they are
about the game) that lost weight anyway, overall and inside detected bursts, with the
reasons that did it.

Usage (from backend/, API on :8001):
    uv run python ../tools/bench_controls.py --runs run_a run_b ... [--record]
"""

import argparse
import json
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))
from _api import client  # noqa: E402

from app.core.config import settings  # noqa: E402

API = "http://localhost:8001"
DISCOUNTED = {2, 4}  # DOWNWEIGHT, EXCLUDE


def control(c: httpx.Client, run_id: str) -> dict:
    run = c.get(f"/runs/{run_id}").json()
    ds = c.get(f"/datasets/{run['dataset_id']}").json()
    s = c.get(f"/runs/{run_id}/scores").json()
    summary = run["summary"]
    bursts = c.get(f"/runs/{run_id}/clusters", params={"kind": "burst", "limit": 1000}).json()
    in_burst: set[int] = set()
    for b in bursts:
        in_burst |= set(
            c.get(f"/runs/{run_id}/clusters/{b['cluster_id']}", params={"sample": 0}).json()[
                "member_ids"
            ]
        )
    negatives = [i for i, r in enumerate(s["rating_norm"]) if r is not None and r < 0.5]

    def about(i: int) -> tuple[int, float | None]:
        a = c.get(f"/runs/{run_id}/reviews/{i}").json()["answers"].get("about_game") or {}
        return i, a.get("noul")

    with ThreadPoolExecutor(4) as pool:
        about_game = dict(pool.map(about, negatives))
    on_topic = [i for i in negatives if (about_game[i] or 0) >= 0.5]
    hit = [i for i in on_topic if s["action"][i] in DISCOUNTED]
    hit_burst = [i for i in on_topic if i in in_burst and s["action"][i] in DISCOUNTED]
    reasons = Counter(
        s["reason_codes"][s["primary_reason"][i]] if s["primary_reason"][i] >= 0 else "OTHER"
        for i in hit
    )
    p = summary.get("platform") or {}
    return {
        "run": run_id,
        "dataset": ds["name"],
        "question_set": run["config"]["question_set"],
        "n_reviews": summary["n_reviews"],
        "raw": summary["raw"],
        "adjusted": summary["adjusted"],
        "ci": summary["ci"],
        "platform": p.get("rating"),
        "move_pp": 100 * (summary["adjusted"] - summary["raw"]),
        "platform_move_pp": 100 * (p["rating"] - summary["raw"])
        if p.get("rating") is not None
        else None,
        "raw_inside_ci": summary["ci"][0] <= summary["raw"] <= summary["ci"][1],
        "negatives": len(negatives),
        "on_topic_negatives": len(on_topic),
        "on_topic_negatives_discounted": len(hit),
        "fp_rate_on_topic_negatives": len(hit) / len(on_topic) if on_topic else None,
        "on_topic_negatives_in_bursts": sum(1 for i in on_topic if i in in_burst),
        "fp_in_bursts": len(hit_burst),
        "fp_reasons": dict(reasons.most_common()),
        "bursts_detected": len(bursts),
        "platform_windows_removed": len(p.get("windows") or []),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--runs", nargs="+", required=True)
    p.add_argument("--record", action="store_true")
    args = p.parse_args()
    out = []
    with client(60) as c:
        for rid in args.runs:
            r = control(c, rid)
            out.append(r)
            print(
                f"{r['dataset'][:40]:40s} raw {100 * r['raw']:5.1f} adj {100 * r['adjusted']:5.1f} "
                f"({r['move_pp']:+.1f} pp, raw in CI: {r['raw_inside_ci']}) platform "
                f"{100 * (r['platform'] or 0):5.1f}  on-topic negatives discounted "
                f"{r['on_topic_negatives_discounted']}/{r['on_topic_negatives']} "
                f"({100 * (r['fp_rate_on_topic_negatives'] or 0):.1f}%), in bursts {r['fp_in_bursts']}/"
                f"{r['on_topic_negatives_in_bursts']}  {r['fp_reasons']}"
            )
            if args.record:
                body = {
                    "kind": "control",
                    "name": f"Control · {r['dataset']}",
                    "backend": c.get(f"/runs/{rid}").json()["backend"],
                    "question_set": r["question_set"],
                    "run_ids": [rid],
                    "metrics": r,
                    "cost_usd": c.get(f"/runs/{rid}").json()["cost_usd"],
                }
                c.post("/benchmarks", json=body).raise_for_status()
    (settings.data_dir / "bench" / "controls.json").write_text(
        json.dumps(out, indent=1), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
