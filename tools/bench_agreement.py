"""Human agreement on the label set (MVP_SPEC §10): Cohen's kappa per question for
human-human, human-Jev and (optionally) human-Laya.

Machine answers are mapped to the raters' choices with fixed rules, the same for every
model:
- about_game, verdict_basis, spam (spam_promo), copied (templated): yes when P >= 0.5;
- contradicts: yes when rating_support's most likely level is 0 ("contradicts it");
- overall: the engine's action, with FLAG counted as keep (it keeps full weight).

Kappa is reported for all reviews and per stratum (uniform / bomb window), with the
raw agreement and each side's "yes" rate, so a kappa near 0 on a rare class can be read
for what it is. A model run on another dataset (e.g. Laya on a 300-review subset) is
matched by review text.

Usage (from backend/, API on :8001):
    uv run python ../tools/bench_agreement.py --set hd2-300 [--laya-run <run id>] [--record]
    uv run python ../tools/bench_agreement.py --set hd2-300 --selfcheck   # Jev vs itself: kappa = 1
"""

import argparse
import json
import sys
from itertools import combinations
from pathlib import Path

import httpx
from sklearn.metrics import cohen_kappa_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))
from _api import client  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.models import HUMAN_LABEL_KEYS  # noqa: E402

API = "http://localhost:8001"


def machine_label(detail: dict) -> dict[str, str] | None:
    a = detail["answers"]
    if not a:
        return None
    yes = lambda q: (a.get(q) or {}).get("noul", 0.0) >= 0.5  # noqa: E731
    probs = (a.get("rating_support") or {}).get("probabilities") or {}
    top = max(probs, key=probs.get) if probs else None
    action = detail["action"] or "KEEP"
    return {
        "about_game": "yes" if yes("about_game") else "no",
        "verdict_basis": "playing" if yes("verdict_basis") else "other",
        "contradicts": "yes" if top == "0" else "no",
        "spam": "yes" if yes("spam_promo") else "no",
        "copied": "yes" if yes("templated") else "no",
        "overall": {"DOWNWEIGHT": "downweight", "EXCLUDE": "exclude"}.get(action, "keep"),
    }


def kappa_table(a: dict[int, dict], b: dict[int, dict], strata: dict[int, str]) -> dict:
    out = {}
    common = sorted(set(a) & set(b))
    for key in HUMAN_LABEL_KEYS:
        row = {}
        for stratum in ("all", "uniform", "bomb"):
            ids = [i for i in common if stratum == "all" or strata[i] == stratum]
            if not ids:
                continue
            x = [a[i][key] for i in ids]
            y = [b[i][key] for i in ids]
            positive = {"about_game": "no", "verdict_basis": "other", "overall": "keep"}.get(
                key, "yes"
            )
            agree = sum(p == q for p, q in zip(x, y, strict=True)) / len(ids)
            k = cohen_kappa_score(x, y) if len(set(x) | set(y)) > 1 else None
            row[stratum] = {
                "n": len(ids),
                "kappa": None if k is None or k != k else float(k),
                "agreement": agree,
                # share flagged as the minority class by each side ("not keep" for overall)
                "rate_a": sum((v != positive) if key == "overall" else (v == positive) for v in x)
                / len(ids),
                "rate_b": sum((v != positive) if key == "overall" else (v == positive) for v in y)
                / len(ids),
            }
        out[key] = row
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--set", default="hd2-300")
    p.add_argument("--laya-run", default=None, help="a Laya run over (a copy of) the label set")
    p.add_argument(
        "--selfcheck", action="store_true", help="score Jev against itself (expects kappa 1)"
    )
    p.add_argument("--record", action="store_true")
    args = p.parse_args()

    meta = json.loads((settings.data_dir / "bench" / "labelsets" / f"{args.set}.json").read_text())
    strata = {i["review_id"]: i["stratum"] for i in meta["items"]}
    ref = meta["reference_run"]
    with client(60) as c:
        summary = next(s for s in c.get("/labelsets").json() if s["name"] == args.set)
        raters = sorted(summary["labelled"])
        human = {}
        for r in raters:
            items = c.get(f"/labelsets/{args.set}", params={"rater": r}).json()["items"]
            human[r] = {i["review_id"]: i["label"] for i in items if i["label"]}
        details = {i: c.get(f"/runs/{ref}/reviews/{i}").json() for i in strata}
        jev = {i: m for i, d in details.items() if (m := machine_label(d))}
        laya = {}
        if args.laya_run:
            by_text = {d["text"]: i for i, d in details.items()}
            page = c.get(f"/runs/{args.laya_run}/reviews", params={"limit": 500}).json()
            for row in page["items"]:
                d = c.get(f"/runs/{args.laya_run}/reviews/{row['review_id']}").json()
                if d["text"] in by_text and (m := machine_label(d)):
                    laya[by_text[d["text"]]] = m

    pairs: dict[str, dict] = {}
    if args.selfcheck:
        pairs["jev-jev (selfcheck)"] = kappa_table(jev, jev, strata)
    for r1, r2 in combinations(raters, 2):
        pairs[f"{r1}-{r2}"] = kappa_table(human[r1], human[r2], strata)
    for r in raters:
        pairs[f"{r}-jev"] = kappa_table(human[r], jev, strata)
        if laya:
            pairs[f"{r}-laya"] = kappa_table(human[r], laya, strata)
    result = {
        "set": args.set,
        "reference_run": ref,
        "laya_run": args.laya_run,
        "raters": {r: len(human[r]) for r in raters},
        "pairs": pairs,
    }
    out = settings.data_dir / "bench" / f"agreement-{args.set}.json"
    out.write_text(json.dumps(result, indent=1), encoding="utf-8")
    for name, table in pairs.items():
        cells = "  ".join(
            f"{k} {v['all']['kappa']:.2f}"
            if v.get("all", {}).get("kappa") is not None
            else f"{k} -"
            for k, v in table.items()
        )
        print(f"{name:28s} {cells}")
    if args.record and not args.selfcheck:
        body = {
            "kind": "agreement",
            "name": f"{args.set} · Cohen's kappa",
            "backend": "jev" + (" + laya" if laya else ""),
            "run_ids": [ref] + ([args.laya_run] if args.laya_run else []),
            "metrics": result,
        }
        httpx.post(f"{API}/benchmarks", json=body, timeout=30).raise_for_status()
        print("recorded")


if __name__ == "__main__":
    main()
