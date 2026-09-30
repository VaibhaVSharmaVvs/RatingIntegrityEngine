"""Average k System One answers for the same review into one answer.

Jev is not deterministic (MEASUREMENTS M7), so k independent calls per review reduce
per-review noise. Averaging rules:
- noul: mean probability.
- score: mean score; probabilities averaged per level.
- choice: probabilities averaged per option; `choice` is the argmax of the mean.
- confidence (choice/score): mean of the backend's own confidences, so k=1 and k>1
  stay on the same scale for the LOW_CONFIDENCE rule.
"""


def average_answers(samples: list[dict[str, dict]], questions: dict[str, dict]) -> dict[str, dict]:
    if len(samples) == 1:
        return samples[0]
    out: dict[str, dict] = {}
    for qid, spec in questions.items():
        answers = [s[qid] for s in samples]
        kind = spec["type"]
        if kind == "noul":
            out[qid] = {"type": "noul", "noul": sum(a["noul"] for a in answers) / len(answers)}
            continue
        keys = sorted({k for a in answers for k in a.get("probabilities", {})})
        probs = {
            k: sum(a.get("probabilities", {}).get(k, 0.0) for a in answers) / len(answers)
            for k in keys
        }
        merged: dict = {"type": kind, "probabilities": probs}
        if kind == "score":
            merged["score"] = sum(a["score"] for a in answers) / len(answers)
        else:
            merged["choice"] = max(probs, key=probs.get) if probs else answers[0]["choice"]
        confs = [a["confidence"] for a in answers if a.get("confidence") is not None]
        if confs:
            merged["confidence"] = sum(confs) / len(confs)
        out[qid] = merged
    return out
