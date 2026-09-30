"""Phase 0 smoke test: send the same System One request to Jev and laya-serve.

Usage (from backend/):
    uv run python ../tools/smoke_systemone.py --backend jev
    uv run python ../tools/smoke_systemone.py --backend laya
    uv run python ../tools/smoke_systemone.py --backend jev --packed 5   # packing probe

Prints answers, latency and token usage so the two backends can be compared by eye.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.config import settings

REVIEWS = [
    (
        "Not recommended",
        "PSN account requirement for a single-purchase game? Refunded. Sony fix this.",
    ),
    (
        "Recommended",
        "Stratagem combos and friendly fire make every drop chaotic. 60 hours, still fun.",
    ),
    ("Not recommended", "bad"),
    ("Not recommended", "Everyone go review bomb this until they remove the PSN link!!!"),
    ("Recommended", "Free keys at discord.gg/xxxx get yours now"),
]

QUESTIONS = {
    "informativeness": {
        "type": "score",
        "instructions": (
            "How much concrete, specific information about the game does this review contain?"
        ),
        "criteria": ["none / noise or meme", "minimal", "some specifics", "detailed and specific"],
    },
    "spam_promo": {
        "type": "noul",
        "instructions": (
            "Is this spam, advertising, or promotion of something other than an honest opinion?"
        ),
    },
    "campaign_language": {
        "type": "noul",
        "instructions": (
            "Does this review reference or urge a collective action, such as review bombing?"
        ),
    },
}


def build_single(verdict: str, text: str) -> dict:
    return {"context": f"Steam review of 'Helldivers 2'. Verdict: {verdict}.", "review": text}


def build_packed(n: int) -> tuple[list[dict], dict]:
    """Probe: array state + namespaced questions referencing `reviews[i].review`."""
    items = [build_single(v, t) for v, t in REVIEWS[:n]]
    questions = {}
    for i in range(len(items)):
        for qid, q in QUESTIONS.items():
            questions[f"r{i}_{qid}"] = {
                **q,
                "instructions": f"For the review at `reviews[{i}]` only: {q['instructions']}",
            }
    return items, questions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["jev", "laya"], default="jev")
    parser.add_argument("--packed", type=int, default=0, help="pack N reviews into one request")
    parser.add_argument("--raw", action="store_true", help="print full answer JSON")
    args = parser.parse_args()

    if args.backend == "jev":
        base, model = settings.typesafe_base_url, settings.jev_model
        headers = {"Authorization": f"Bearer {settings.typesafe_api_key}"}
        if not settings.typesafe_api_key:
            sys.exit("TYPESAFE_API_KEY is not set in .env")
    else:
        base, model, headers = settings.laya_base_url, settings.laya_model, {}

    with httpx.Client(base_url=base, headers=headers, timeout=300) as client:
        if args.packed:
            items, questions = build_packed(args.packed)
            payloads = [{"model": model, "state": {"reviews": items}, "questions": questions}]
        else:
            payloads = [
                {"model": model, "state": build_single(v, t), "questions": QUESTIONS}
                for v, t in REVIEWS
            ]
        for payload in payloads:
            t0 = time.perf_counter()
            r = client.post("/v1/systemone", json=payload)
            ms = (time.perf_counter() - t0) * 1000
            r.raise_for_status()
            body = r.json()
            print(f"--- {ms:.0f} ms  usage={body.get('usage')}  model={body.get('model')}")
            if args.raw:
                print(json.dumps(body["answers"], indent=2))
                continue
            for qid, a in body["answers"].items():
                value = a.get("noul", a.get("score", a.get("choice")))
                conf = a.get("confidence")
                print(f"  {qid:<24} {a['type']:<6} {value}  conf={conf}")


if __name__ == "__main__":
    main()
