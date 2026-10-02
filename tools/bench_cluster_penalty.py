"""The cluster penalty in normal periods (owner request 2026-10-02): compare two runs on the
same dataset, one penalising semantic clusters and one not (`cluster_penalty_kinds`).

"Normal period" = a review outside every detected burst. For each run pair: how many
reviews in normal periods and inside bursts change action, from what to what, under which
reason, and the effect on the adjusted rating; plus a few examples of normal-period
reviews the semantic penalty touches, so a person can judge whether it is right.

Usage (from backend/, API on :8001):
    uv run python ../tools/bench_cluster_penalty.py --pairs <with> <without> [<with> <without> ...] [--record]
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))
from _api import client  # noqa: E402

from app.core.config import settings  # noqa: E402

NAMES = {1: "KEEP", 2: "DOWNWEIGHT", 3: "FLAG", 4: "EXCLUDE"}


def weights(s: dict) -> list[float]:
    w = s["weights"]
    table = [0.0, w["KEEP"], w["DOWNWEIGHT"], w["FLAG"], w["EXCLUDE"]]
    return [table[a] for a in s["action"]]


def rating(s: dict, w: list[float]) -> float:
    pairs = [(r, x) for r, x in zip(s["rating_norm"], w, strict=True) if r is not None]
    return sum(r * x for r, x in pairs) / sum(x for _, x in pairs)


def compare(c, with_id: str, without_id: str) -> dict:
    runs = [c.get(f"/runs/{r}").json() for r in (with_id, without_id)]
    if runs[0]["dataset_id"] != runs[1]["dataset_id"]:
        sys.exit(f"{with_id} and {without_id} are on different datasets")
    ds = c.get(f"/datasets/{runs[0]['dataset_id']}").json()
    sa, sb = (c.get(f"/runs/{r}/scores").json() for r in (with_id, without_id))
    in_burst: set[int] = set()
    for b in c.get(f"/runs/{with_id}/clusters", params={"kind": "burst", "limit": 1000}).json():
        in_burst |= set(
            c.get(f"/runs/{with_id}/clusters/{b['cluster_id']}", params={"sample": 0}).json()[
                "member_ids"
            ]
        )
    codes = sa["reason_codes"]
    out = {}
    for period, keep in (
        ("normal", lambda i: i not in in_burst),
        ("bursts", lambda i: i in in_burst),
    ):
        ids = [i for i in range(len(sa["action"])) if keep(i)]
        changed = [i for i in ids if sa["action"][i] != sb["action"][i]]
        out[period] = {
            "reviews": len(ids),
            "changed": len(changed),
            "changed_share": len(changed) / len(ids) if ids else None,
            "transitions": dict(
                Counter(f"{NAMES[sa['action'][i]]}->{NAMES[sb['action'][i]]}" for i in changed)
            ),
            "reasons_with_penalty": dict(
                Counter(
                    codes[sa["primary_reason"][i]] if sa["primary_reason"][i] >= 0 else "-"
                    for i in changed
                )
            ),
        }
    examples = []
    for i in range(len(sa["action"])):
        if i in in_burst or sa["action"][i] == sb["action"][i]:
            continue
        d = c.get(f"/runs/{with_id}/reviews/{i}").json()
        examples.append(
            {
                "review_id": i,
                "with": NAMES[sa["action"][i]],
                "without": NAMES[sb["action"][i]],
                "cluster": d["cluster_caption"],
                "text": d["text"][:200],
            }
        )
        if len(examples) == 8:
            break
    wa, wb = weights(sa), weights(sb)
    return {
        "dataset": ds["name"],
        "runs": {"with_semantic_penalty": with_id, "without": without_id},
        "n_reviews": len(sa["action"]),
        "reviews_in_bursts": len(in_burst),
        "adjusted_with": rating(sa, wa),
        "adjusted_without": rating(sb, wb),
        "move_pp": 100 * (rating(sb, wb) - rating(sa, wa)),
        **out,
        "examples_normal_period": examples,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--pairs", nargs="+", required=True, help="with-run without-run, repeated")
    p.add_argument("--record", action="store_true")
    p.add_argument("--name", default="Semantic-cluster penalty in normal periods")
    args = p.parse_args()
    if len(args.pairs) % 2:
        sys.exit("--pairs needs an even number of run ids")
    results = []
    with client(120) as c:
        for a, b in zip(args.pairs[::2], args.pairs[1::2], strict=True):
            r = compare(c, a, b)
            results.append(r)
            print(
                f"{r['dataset'][:42]:42s} adj {100 * r['adjusted_with']:.2f} -> {100 * r['adjusted_without']:.2f} "
                f"({r['move_pp']:+.2f} pp)  normal: {r['normal']['changed']}/{r['normal']['reviews']} changed "
                f"{r['normal']['transitions']}  bursts: {r['bursts']['changed']}/{r['bursts']['reviews']}"
            )
        if args.record:
            c.post(
                "/benchmarks",
                json={
                    "kind": "ablation",
                    "name": args.name,
                    "run_ids": args.pairs,
                    "metrics": {"pairs": results},
                },
            ).raise_for_status()
    (settings.data_dir / "bench" / "cluster-penalty.json").write_text(
        json.dumps(results, indent=1), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
