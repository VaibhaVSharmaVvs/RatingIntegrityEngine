"""Mock System One backend: deterministic random answers in the real response shape.

Lets the whole pipeline, SSE stream and UI run with no API key and no model. Answers
are seeded by (run seed, review id), so a mock run is reproducible.
"""

import asyncio

import numpy as np

from app.systemone.questions_v1 import QUESTIONS


def _answer(rng: np.random.Generator, spec: dict) -> dict:
    kind = spec["type"]
    if kind == "noul":
        return {"type": "noul", "noul": round(float(rng.beta(1, 12)), 4)}
    if kind == "score":
        levels = len(spec["criteria"])
        probs = rng.dirichlet(np.linspace(1, 3, levels))
        score = float((probs * np.arange(levels)).sum())
        return {
            "type": "score",
            "score": round(score, 4),
            "probabilities": {str(i): round(float(p), 4) for i, p in enumerate(probs)},
            "confidence": round(float(rng.beta(5, 2)), 4),
        }
    options = list(spec["criteria"])
    probs = rng.dirichlet(np.ones(len(options)) * 0.5)
    return {
        "type": "choice",
        "choice": options[int(probs.argmax())],
        "probabilities": {o: round(float(p), 4) for o, p in zip(options, probs, strict=True)},
        "confidence": round(float(rng.beta(5, 2)), 4),
    }


class MockBackend:
    model_version = "mock-1"

    def __init__(self, seed: int, latency_ms: float = 0.0) -> None:
        self.seed = seed
        self.latency_ms = latency_ms

    async def judge_batch(self, review_ids: list[int], states: list[dict]) -> list[dict]:
        if self.latency_ms:
            await asyncio.sleep(self.latency_ms / 1000)
        out = []
        for rid in review_ids:
            rng = np.random.default_rng([self.seed, rid])
            out.append({qid: _answer(rng, spec) for qid, spec in QUESTIONS.items()})
        return out
