"""Phase 3 probe: Jev determinism + token calibration for the pre-flight estimate.

Sends the same real review states twice (question set v1, pack=1) and reports:
- determinism: do identical inputs return identical answers? (S2 reuses judgments
  for byte-identical inputs, MEASUREMENTS M6c)
- tokens vs state size: least-squares fit input_tokens = a + b * len(state JSON),
  which the pre-flight estimator uses.

Usage (from backend/):  uv run python ../tools/jev_probe.py --n 30
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.config import settings
from app.ingest.steam_fetcher import load_pull
from app.ingest.steam_import import steam_to_reviews
from app.systemone.backend import backend_spec
from app.systemone.client import SystemOneClient
from app.systemone.questions_v1 import QUESTIONS, build_state, verdict_words

PULLS = {
    "Helldivers 2": "553850_2024-04-01_2024-06-30",
    "The Lord of the Rings: Gollum": "1265780_2023-05-01_2023-07-31",
}


def sample_states(n: int) -> list[dict]:
    states = []
    for subject, pull in PULLS.items():
        r = steam_to_reviews(load_pull(settings.steam_pulls_dir / pull).head(50_000))
        r = r.filter(r["text"].str.len_chars() > 0).sample(n, seed=11)
        for raw, norm, text in r.select("rating_raw", "rating_norm", "text").iter_rows():
            states.append(build_state(subject, "steam", verdict_words(raw, norm, "binary"), text))
    return states


def answer_key(a: dict) -> tuple:
    return (a["type"], a.get("noul"), a.get("score"), a.get("choice"), a.get("confidence"))


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=30, help="reviews per game")
    args = p.parse_args()
    states = sample_states(args.n)
    async with SystemOneClient(backend_spec("jev", settings, None, 8)) as c:
        first = await asyncio.gather(*(c.ask(s, QUESTIONS) for s in states))
        second = await asyncio.gather(*(c.ask(s, QUESTIONS) for s in states))
        cost, versions = c.cost_usd, c.usage.model_versions

    same = [
        all(answer_key(a.answers[q]) == answer_key(b.answers[q]) for q in QUESTIONS)
        for a, b in zip(first, second, strict=True)
    ]
    diffs = []
    for a, b in zip(first, second, strict=True):
        for q in QUESTIONS:
            x, y = a.answers[q], b.answers[q]
            for k in ("noul", "score", "confidence"):
                if x.get(k) is not None:
                    diffs.append(abs(x[k] - y[k]))
    print(f"model versions: {sorted(versions)}  |  total cost ${cost:.5f}")
    print(
        f"determinism: {sum(same)}/{len(same)} states returned identical answers; "
        f"max |delta| over numeric fields = {max(diffs):.6f}"
    )

    chars = np.array([len(json.dumps(s, ensure_ascii=False)) for s in states], dtype=float)
    tokens = np.array([r.input_tokens for r in first], dtype=float)
    b, a = np.polyfit(chars, tokens, 1)
    resid = tokens - (a + b * chars)
    print(
        f"tokens = {a:.1f} + {b:.4f} * state_chars   (residual sd {resid.std():.1f}, "
        f"max abs {np.abs(resid).max():.1f}; chars {chars.min():.0f}-{chars.max():.0f}; "
        f"tokens {tokens.min():.0f}-{tokens.max():.0f})"
    )
    print(f"mean tokens/review in this sample: {tokens.mean():.0f}")


if __name__ == "__main__":
    asyncio.run(main())
