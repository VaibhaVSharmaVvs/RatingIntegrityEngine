"""Phase 3: how noisy is Jev, and does averaging k calls per review help?

Sends each state R times (question set v1, pack=1), then reports:
- per-question test-retest noise: SD of each numeric answer across repeats
- decision flip rate: how often the policy action differs between two independent
  single calls, vs between two independent means-of-k calls
- rating impact: how much the per-review integrity score moves

Usage (from backend/):  uv run python ../tools/jev_noise.py --n 30 --repeats 6
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from jev_probe import sample_states

from app.core.config import settings
from app.decide.policy import decide
from app.models import PolicyThresholds
from app.systemone.backend import backend_spec
from app.systemone.client import SystemOneClient
from app.systemone.ensemble import average_answers
from app.systemone.questions_v1 import QUESTIONS

LEVELS = {q: len(s["criteria"]) for q, s in QUESTIONS.items() if s["type"] == "score"}
T = PolicyThresholds()


def numeric(a: dict) -> float:
    return a.get("noul", a.get("score"))


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=30, help="reviews per game")
    p.add_argument("--repeats", type=int, default=6)
    p.add_argument("--save", type=Path, default=None, help="write raw answers as JSON")
    args = p.parse_args()
    states = sample_states(args.n)
    async with SystemOneClient(backend_spec("jev", settings, None, 16)) as c:
        runs = [
            await asyncio.gather(*(c.ask(s, QUESTIONS) for s in states))
            for _ in range(args.repeats)
        ]
        print(
            f"calls {c.usage.requests}, cost ${c.cost_usd:.5f}, versions {sorted(c.usage.model_versions)}"
        )
    R = [[r.answers for r in run] for run in runs]  # R[repeat][state]

    print("\nper-question test-retest SD across repeats (mean over states):")
    for q, spec in QUESTIONS.items():
        if spec["type"] == "choice":
            agree = np.mean(
                [
                    len({R[k][i][q]["choice"] for k in range(args.repeats)}) == 1
                    for i in range(len(states))
                ]
            )
            print(f"  {q:<18} choice: same top choice in all repeats for {agree:.0%} of states")
            continue
        sd = [
            np.std([numeric(R[k][i][q]) for k in range(args.repeats)]) for i in range(len(states))
        ]
        scale = LEVELS.get(q, 2) - 1  # score range 0..levels-1; noul 0..1
        print(
            f"  {q:<18} {spec['type']}: mean SD {np.mean(sd):.3f} (= {np.mean(sd) / scale:.1%} of range), max SD {np.max(sd):.3f}"
        )

    def action_and_score(ans: dict) -> tuple[str, float]:
        d = decide(ans, T, score_levels=LEVELS)
        return d.action.name, d.integrity_score

    print("\ndecision stability (policy v1 thresholds):")
    rng = np.random.default_rng(0)
    for k in (1, 2, 3):
        if 2 * k > args.repeats:
            break
        flips, deltas = [], []
        for i in range(len(states)):
            for _ in range(50):  # random disjoint pairs of k-call groups
                order = rng.permutation(args.repeats)
                a = average_answers([R[j][i] for j in order[:k]], QUESTIONS)
                b = average_answers([R[j][i] for j in order[k : 2 * k]], QUESTIONS)
                (xa, sa), (xb, sb) = action_and_score(a), action_and_score(b)
                flips.append(xa != xb)
                deltas.append(abs(sa - sb))
        print(
            f"  mean of k={k}: action differs between two independent estimates in "
            f"{np.mean(flips):.1%}; |integrity delta| mean {np.mean(deltas):.3f}, "
            f"p95 {np.percentile(deltas, 95):.3f}"
        )

    if args.save:
        args.save.write_text(json.dumps({"states": states, "repeats": R}), encoding="utf-8")
        print(f"\nraw answers saved to {args.save}")


if __name__ == "__main__":
    asyncio.run(main())
