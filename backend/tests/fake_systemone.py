"""A fake System One server for tests: speaks the Jev wire protocol over MockTransport."""

import hashlib
import json

import httpx


def _unit(*parts: str) -> float:
    h = hashlib.sha256("|".join(parts).encode()).digest()
    return int.from_bytes(h[:4], "little") / 2**32


def answer(qid: str, q: dict, state) -> dict:
    """Deterministic in (question, state), like a real model on identical input."""
    s = json.dumps(state, sort_keys=True)
    u = _unit(qid, s)
    if q["type"] == "noul":
        return {"type": "noul", "noul": round(u * 0.2, 4)}
    if q["type"] == "score":
        levels = len(q["criteria"])
        score = round(u * (levels - 1), 4)
        return {
            "type": "score",
            "score": score,
            "legend": {},
            "probabilities": {},
            "confidence": 0.9,
        }
    options = list(q["criteria"])
    return {
        "type": "choice",
        "choice": options[int(u * len(options))],
        "probabilities": {o: 1 / len(options) for o in options},
        "confidence": 0.9,
    }


class FakeSystemOne:
    """Counts requests; can fail the first N with a status code (e.g. 429)."""

    def __init__(self, fail_first: int = 0, fail_status: int = 429, model: str = "jev-1.13.0"):
        self.fail_first = fail_first
        self.fail_status = fail_status
        self.model = model
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(body)
        if len(self.requests) <= self.fail_first:
            return httpx.Response(self.fail_status, text="slow down")
        answers = {qid: answer(qid, q, body["state"]) for qid, q in body["questions"].items()}
        tokens = len(json.dumps(body)) // 4
        return httpx.Response(
            200,
            json={
                "model": self.model,
                "answers": answers,
                "usage": {"input_tokens": tokens, "output_tokens": 5},
            },
        )

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)
