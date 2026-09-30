"""Phase 0: measure System One throughput on real reviews with question set v1.

Sends one request per review (6 questions) over HTTP, at a given concurrency, and
reports reviews/s, p50/p95 latency and token usage. Works for Jev and laya-serve.

Usage (from backend/):
    uv run python ../tools/bench_throughput.py --backend laya --n 60 --concurrency 1
    uv run python ../tools/bench_throughput.py --backend jev --n 200 --concurrency 8
"""

import argparse
import asyncio
import statistics
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.config import settings
from app.ingest.steam_fetcher import load_pull
from app.systemone.questions_v1 import QUESTIONS, build_state, verdict_words

DEFAULT_PULL = settings.data_dir / "raw" / "steam" / "1265780_2023-05-01_2023-07-31"


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--backend", choices=["jev", "laya"], default="laya")
    p.add_argument("--n", type=int, default=60)
    p.add_argument("--concurrency", type=int, default=1)
    p.add_argument("--pull", type=Path, default=DEFAULT_PULL)
    p.add_argument("--game", default="The Lord of the Rings: Gollum")
    args = p.parse_args()

    if args.backend == "jev":
        if not settings.typesafe_api_key:
            sys.exit("TYPESAFE_API_KEY is not set in .env")
        base, model = settings.typesafe_base_url, settings.jev_model
        headers = {"Authorization": f"Bearer {settings.typesafe_api_key}"}
    else:
        base, model, headers = settings.laya_base_url, settings.laya_model, {}

    df = load_pull(args.pull).sample(n=args.n, seed=7, shuffle=True)
    states = [
        build_state(args.game, "steam", verdict_words(float(v), float(v), "binary"), t)
        for v, t in zip(df["voted_up"], df["text"], strict=True)
    ]
    sem = asyncio.Semaphore(args.concurrency)
    latencies: list[float] = []
    tokens = 0

    async with httpx.AsyncClient(base_url=base, headers=headers, timeout=300) as client:
        # Warm-up request, not timed (first CPU forward pass is slow).
        await client.post(
            "/v1/systemone", json={"model": model, "state": states[0], "questions": QUESTIONS}
        )

        async def one(state: dict) -> None:
            nonlocal tokens
            async with sem:
                t0 = time.perf_counter()
                r = await client.post(
                    "/v1/systemone", json={"model": model, "state": state, "questions": QUESTIONS}
                )
                latencies.append(time.perf_counter() - t0)
                r.raise_for_status()
                tokens += r.json().get("usage", {}).get("input_tokens", 0)

        t0 = time.perf_counter()
        await asyncio.gather(*(one(s) for s in states))
        wall = time.perf_counter() - t0

    lat = sorted(latencies)
    print(f"backend={args.backend} model={model} n={args.n} concurrency={args.concurrency}")
    print(f"wall={wall:.1f}s  reviews/s={args.n / wall:.2f}  questions/s={args.n * 6 / wall:.1f}")
    print(f"latency p50={statistics.median(lat):.2f}s p95={lat[int(0.95 * (len(lat) - 1))]:.2f}s")
    print(f"input_tokens total={tokens} per_review={tokens / args.n:.0f}")
    print(
        f"extrapolated 5K={5000 / (args.n / wall) / 60:.0f} min  50K={50000 / (args.n / wall) / 3600:.1f} h"
    )


if __name__ == "__main__":
    asyncio.run(main())
