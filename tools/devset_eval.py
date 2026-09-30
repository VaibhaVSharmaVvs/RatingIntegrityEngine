"""Run a question set on the dev set, save answers, compare runs, show reviews.

Usage (from backend/):
    uv run python ../tools/devset_eval.py run --label v1_p1 [--pack 5] [--questions v1]
    uv run python ../tools/devset_eval.py compare v1_p1 v1_p1_again
    uv run python ../tools/devset_eval.py show v1_p1 --stratum hd2_bomb --n 10

Saved to data/devsets/runs/<label>.json (gitignored: contains review text).
"""

import argparse
import asyncio
import importlib
import json
import sys
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.config import settings
from app.core.db import Database
from app.decide.policy import decide
from app.models import PolicyThresholds
from app.systemone.backend import SystemOneBackend, backend_spec
from app.systemone.client import SystemOneClient
from app.systemone.questions_v1 import build_state, verdict_words

RUNS = settings.data_dir / "devsets" / "runs"


def load_devset() -> list[dict]:
    db = Database(settings.db_path)
    with db.cursor() as cur:
        ds = cur.execute(
            "SELECT id FROM datasets WHERE json_extract_string(source_params, '$.devset') = 'v1' "
            "ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        if ds is None:
            raise SystemExit("no dev set dataset; run make_devset.py first")
        rows = cur.execute(
            "SELECT id, text, rating_raw, rating_norm, meta FROM reviews WHERE dataset_id = ? ORDER BY id",
            [ds[0]],
        ).fetchall()
    out = []
    for rid, text, raw, norm, meta in rows:
        m = json.loads(meta)
        out.append(
            {
                "id": rid,
                "text": text,
                "stratum": m["stratum"],
                "state": build_state(
                    m["subject"], "steam", verdict_words(raw, norm, "binary"), text
                ),
            }
        )
    return out


def questions_module(version: str):
    return importlib.import_module(f"app.systemone.questions_{version}")


async def cmd_run(args) -> None:
    dev = load_devset()
    qm = questions_module(args.questions)
    spec = backend_spec(args.backend, settings, None, 16)
    backend = SystemOneBackend(
        SystemOneClient(spec),
        pack_size=args.pack,
        questions=qm.QUESTIONS,
        samples_per_review=args.samples,
    )
    answers = await backend.judge_batch([d["id"] for d in dev], [d["state"] for d in dev])
    await backend.aclose()
    RUNS.mkdir(parents=True, exist_ok=True)
    out = {
        "label": args.label,
        "questions": args.questions,
        "backend": args.backend,
        "pack": args.pack,
        "samples": args.samples,
        "model_version": backend.model_version,
        "cost_usd": backend.cost_usd,
        "tokens_in": backend.tokens_in,
        "requests": backend.client.usage.requests,
        "reviews": [
            {"id": d["id"], "stratum": d["stratum"], "answers": a}
            for d, a in zip(dev, answers, strict=True)
        ],
    }
    (RUNS / f"{args.label}.json").write_text(json.dumps(out), encoding="utf-8")
    print(
        f"{args.label}: {len(dev)} reviews, {out['requests']} requests, {out['tokens_in']} tokens, "
        f"${out['cost_usd']:.5f}, {out['model_version']}"
    )


def _load(label: str) -> dict:
    return json.loads((RUNS / f"{label}.json").read_text(encoding="utf-8"))


def _levels(questions: dict) -> dict[str, int]:
    return {q: len(s["criteria"]) for q, s in questions.items() if s["type"] == "score"}


def cmd_compare(args) -> None:
    a, b = _load(args.a), _load(args.b)
    qa = questions_module(a["questions"]).QUESTIONS
    qb = questions_module(b["questions"]).QUESTIONS
    ra = {r["id"]: r["answers"] for r in a["reviews"]}
    rb = {r["id"]: r["answers"] for r in b["reviews"]}
    ids = sorted(set(ra) & set(rb))
    print(f"{args.a} vs {args.b}: {len(ids)} reviews")
    for q, spec in qa.items():
        if q not in qb:
            continue
        if spec["type"] == "choice":
            agree = np.mean([ra[i][q]["choice"] == rb[i][q]["choice"] for i in ids])
            print(f"  {q:<18} choice agreement {agree:.3f}")
        else:
            key = "score" if spec["type"] == "score" else "noul"
            x = np.array([ra[i][q][key] for i in ids])
            y = np.array([rb[i][q][key] for i in ids])
            rho = spearmanr(x, y).statistic
            print(
                f"  {q:<18} {spec['type']:<5} spearman {rho:.3f}  mean |delta| {np.mean(np.abs(x - y)):.3f}"
            )
    T = PolicyThresholds()
    acts = [
        (
            decide(ra[i], T, score_levels=_levels(qa)).action,
            decide(rb[i], T, score_levels=_levels(qb)).action,
        )
        for i in ids
    ]
    print(f"  decision agreement {np.mean([x == y for x, y in acts]):.3f}")


def cmd_show(args) -> None:
    run = _load(args.label)
    dev = {d["id"]: d for d in load_devset()}
    qs = questions_module(run["questions"]).QUESTIONS
    T = PolicyThresholds()
    shown = 0
    for r in run["reviews"]:
        if args.stratum and r["stratum"] != args.stratum:
            continue
        d = dev[r["id"]]
        a = r["answers"]
        dec = decide(a, T, score_levels=_levels(qs))
        text = d["text"].replace("\n", " ")
        print(
            f"\n#{r['id']} [{r['stratum']}] {d['state']['verdict']} -> {dec.action.name} {dec.reasons} "
            f"(integrity {dec.integrity_score:.2f})"
        )
        print(f"  {text[: args.chars]}{'...' if len(text) > args.chars else ''}")
        parts = []
        for q, spec in qs.items():
            v = a[q]
            if spec["type"] == "choice":
                parts.append(f"{q}={v['choice']}({v.get('confidence', 0):.2f})")
            elif spec["type"] == "score":
                parts.append(f"{q}={v['score']:.2f}/{len(spec['criteria']) - 1}")
            else:
                parts.append(f"{q}={v['noul']:.2f}")
        print("  " + "  ".join(parts))
        shown += 1
        if shown >= args.n:
            break


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--label", required=True)
    r.add_argument("--questions", default="v1")
    r.add_argument("--backend", default="jev")
    r.add_argument("--pack", type=int, default=1)
    r.add_argument("--samples", type=int, default=1)
    c = sub.add_parser("compare")
    c.add_argument("a")
    c.add_argument("b")
    s = sub.add_parser("show")
    s.add_argument("label")
    s.add_argument("--stratum")
    s.add_argument("--n", type=int, default=10)
    s.add_argument("--chars", type=int, default=280)
    args = p.parse_args()
    if args.cmd == "run":
        asyncio.run(cmd_run(args))
    elif args.cmd == "compare":
        cmd_compare(args)
    else:
        cmd_show(args)


if __name__ == "__main__":
    main()
