"""Re-run finished runs with a config override, reusing their System One answers ($0).

Each variant is a JSON object merged into the source run's config, one level deep:
{"thresholds": {"w_spam": 0}} changes that one threshold and keeps the rest. Runs go one at a time: the corpus stage is CPU-bound and parallel runs
would only slow each other down.

Prints one JSON line per run: {variant, source, run_id, raw, adjusted, platform, counts}.

Usage (from backend/, API on :8001):
    uv run python ../tools/sweep_cached.py --sources run_a run_b \\
        --variant offtopic-0.5 '{"suspicion": {"factor_weights": {"new_account_share": 0.5, "offtopic_mean": 0.5}}}'
"""

import argparse
import json
import time

import httpx
from _api import client

API = "http://localhost:8001"


def run_cached(c: httpx.Client, source: str, override: dict) -> dict:
    src = c.get(f"/runs/{source}").json()
    cfg = src["config"]
    body = {
        "dataset_id": src["dataset_id"],
        "backend": "cached",
        "reuse_judgments_from": source,
        "question_set": cfg["question_set"],
        **{
            k: cfg[k]
            for k in (
                "weights",
                "thresholds",
                "features",
                "bursts",
                "clusters",
                "suspicion",
                "platform",
            )
        },
    }
    for k, v in override.items():
        body[k] = {**body[k], **v} if isinstance(v, dict) and isinstance(body.get(k), dict) else v
    run = c.post("/runs", json=body)
    run.raise_for_status()
    rid = run.json()["id"]
    while True:
        try:
            r = c.get(f"/runs/{rid}").json()
        except httpx.TransportError:  # the server can drop a poll while a corpus stage runs
            time.sleep(5)
            continue
        if r["status"] in ("done", "error"):
            break
        time.sleep(3)
    s = r["summary"] or {}
    return {
        "source": source,
        "run_id": rid,
        "status": r["status"],
        "error": r["error"],
        "raw": s.get("raw"),
        "adjusted": s.get("adjusted"),
        "ci": s.get("ci"),
        "platform": (s.get("platform") or {}).get("rating"),
        "counts": s.get("counts"),
        "suspicious_clusters": (s.get("corpus") or {}).get("suspicious_clusters"),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--sources", nargs="+", required=True, help="finished run ids to reuse")
    p.add_argument("--variant", nargs=2, action="append", metavar=("NAME", "JSON"), required=True)
    args = p.parse_args()
    with client(120) as c:
        for name, override in args.variant:
            for source in args.sources:
                print(
                    json.dumps({"variant": name, **run_cached(c, source, json.loads(override))}),
                    flush=True,
                )


if __name__ == "__main__":
    main()
