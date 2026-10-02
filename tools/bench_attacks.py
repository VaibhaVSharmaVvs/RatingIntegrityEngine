"""Score a run on the synthetic-attack benchmark against its clean twin (MVP_SPEC §10).

Needs two finished runs with the same settings: one on the clean dataset and one on the
attacked dataset (tools/inject_attacks.py). Reports, from the API only:

- per attack type: how many injected reviews were caught (any action but KEEP), how many
  lost weight (DOWNWEIGHT / EXCLUDE), their mean weight, and how many sit in a detected
  cluster / a penalised cluster;
- collateral: organic reviews whose weight dropped only because the attack was there
  (same review, clean run vs attacked run);
- the rating: how much of the attack's pull on the raw rating the adjusted rating removes;
- cluster ARI among injected reviews (attack type vs detected cluster), per cluster kind.

Usage (from backend/, API on :8001):
    uv run python ../tools/bench_attacks.py --clean <run id> --attacked <run id> [--record]
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import httpx
import numpy as np
from sklearn.metrics import adjusted_rand_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))
from _api import client  # noqa: E402

from app.core.config import settings  # noqa: E402

API = "http://localhost:8001"
ACTION = {0: "PENDING", 1: "KEEP", 2: "DOWNWEIGHT", 3: "FLAG", 4: "EXCLUDE"}


def weights(scores: dict) -> np.ndarray:
    w = scores["weights"]
    table = np.array([0.0, w["KEEP"], w["DOWNWEIGHT"], w["FLAG"], w["EXCLUDE"]])
    return table[np.array(scores["action"])]


def rating(r: np.ndarray, w: np.ndarray, mask: np.ndarray | None = None) -> float:
    m = ~np.isnan(r) if mask is None else (~np.isnan(r) & mask)
    return float((r[m] * w[m]).sum() / w[m].sum())


def clusters(c: httpx.Client, run_id: str, threshold: float, min_size: int) -> dict:
    """review id -> {kind: (cluster id, penalised)} for every detected cluster."""
    out: dict[int, dict] = defaultdict(dict)
    for cl in c.get(f"/runs/{run_id}/clusters", params={"limit": 1000}).json():
        penalised = cl["suspicion"] > threshold and cl["size"] >= min_size
        members = c.get(f"/runs/{run_id}/clusters/{cl['cluster_id']}", params={"sample": 0}).json()[
            "member_ids"
        ]
        for m in members:
            out[m][cl["kind"]] = (cl["cluster_id"], penalised)
    return out


def source_cost(run: dict) -> float:
    src = run["config"].get("reuse_judgments_from")
    if run["backend"] != "cached" or not src:
        return run["cost_usd"]
    return httpx.get(f"{API}/runs/{src}", timeout=30).json()["cost_usd"]


def score(clean_id: str, attacked_id: str) -> dict:
    with client(120) as c:
        runs = {
            k: c.get(f"/runs/{v}").json()
            for k, v in (("clean", clean_id), ("attacked", attacked_id))
        }
        bench = runs["attacked"]["dataset_id"]
        truth_file = next(
            p
            for p in (settings.data_dir / "bench").glob("*.truth.json")
            if json.loads(p.read_text())["datasets"]["attacked"] == bench
        )
        meta = json.loads(truth_file.read_text())
        if runs["clean"]["dataset_id"] != meta["datasets"]["clean"]:
            sys.exit("the clean run is not on this benchmark's clean dataset")
        s_clean = c.get(f"/runs/{clean_id}/scores").json()
        s_att = c.get(f"/runs/{attacked_id}/scores").json()
        t = runs["attacked"]["config"]["thresholds"]
        cl = clusters(c, attacked_id, t["cluster_penalty_threshold"], t["min_penalty_cluster_size"])
        tc = runs["clean"]["config"]["thresholds"]
        cl_clean = clusters(
            c, clean_id, tc["cluster_penalty_threshold"], tc["min_penalty_cluster_size"]
        )

    truth = {int(k): v for k, v in meta["truth"].items()}
    n = len(s_att["action"])
    injected = np.zeros(n, bool)
    injected[list(truth)] = True
    organic = ~injected
    r_att = np.array([np.nan if x is None else x for x in s_att["rating_norm"]], float)
    r_cln = np.array([np.nan if x is None else x for x in s_clean["rating_norm"]], float)
    w_att, w_cln = weights(s_att), weights(s_clean)
    if organic.sum() != len(r_cln) or not np.allclose(r_att[organic], r_cln, equal_nan=True):
        sys.exit("organic reviews of the attacked dataset do not line up with the clean dataset")

    acts = np.array(s_att["action"])
    per_type = {}
    for kind in sorted(set(truth.values())):
        ids = [i for i, k in truth.items() if k == kind]
        a = acts[ids]
        per_type[kind] = {
            "n": len(ids),
            "caught": float(np.mean(a != 1)),
            "discounted": float(np.mean(np.isin(a, [2, 4]))),
            "excluded": float(np.mean(a == 4)),
            "flagged": float(np.mean(a == 3)),
            "mean_weight": float(w_att[ids].mean()),
            "in_cluster": float(np.mean([bool(cl.get(i)) for i in ids])),
            "in_penalised_cluster": float(
                np.mean([any(p for _, p in cl.get(i, {}).values()) for i in ids])
            ),
            "actions": dict(Counter(ACTION[x] for x in a)),
        }

    w_org = w_att[organic]
    lowered = w_org < w_cln - 1e-9
    raised = w_org > w_cln + 1e-9
    # Deterministic collateral: organic reviews in a penalised cluster only when attacked.
    # (Weight changes above also carry System One's run-to-run noise, both directions.)
    org_ids = np.flatnonzero(organic)  # attacked id of the k-th organic review = clean id k
    pen = lambda m, i: any(p for _, p in m.get(int(i), {}).values())  # noqa: E731
    newly_penalised = sum(1 for k, i in enumerate(org_ids) if pen(cl, i) and not pen(cl_clean, k))
    ari = {}
    inj_ids = sorted(truth)
    labels_true = [truth[i] for i in inj_ids]
    for kind in ("duplicate", "semantic", "burst"):
        pred = [cl.get(i, {}).get(kind, (f"none-{i}", False))[0] for i in inj_ids]
        ari[kind] = float(adjusted_rand_score(labels_true, [str(p) for p in pred]))

    raw_c, adj_c = rating(r_cln, np.ones_like(w_cln)), rating(r_cln, w_cln)
    raw_a, adj_a = rating(r_att, np.ones_like(w_att)), rating(r_att, w_att)
    pf = lambda r: (r["summary"]["platform"] or {}).get("rating")  # noqa: E731
    shift_raw, shift_adj = raw_a - raw_c, adj_a - adj_c
    return {
        "benchmark": meta["name"],
        "runs": {"clean": clean_id, "attacked": attacked_id},
        "backend": runs["attacked"]["backend"],
        "question_set": runs["attacked"]["config"]["question_set"],
        "n_organic": int(organic.sum()),
        "n_injected": int(injected.sum()),
        "per_type": per_type,
        "injected_overall": {
            "caught": float(np.mean(acts[injected] != 1)),
            "discounted": float(np.mean(np.isin(acts[injected], [2, 4]))),
            "mean_weight": float(w_att[injected].mean()),
        },
        "collateral": {
            "organic_weight_lowered": int(lowered.sum()),
            "organic_weight_lowered_share": float(lowered.mean()),
            "organic_weight_raised": int(raised.sum()),
            "organic_newly_in_penalised_cluster": newly_penalised,
            "organic_discounted_clean": float(np.mean(w_cln < 1)),
            "organic_discounted_attacked": float(np.mean(w_org < 1)),
        },
        "rating": {
            "raw_clean": raw_c,
            "adjusted_clean": adj_c,
            "raw_attacked": raw_a,
            "adjusted_attacked": adj_a,
            "platform_clean": pf(runs["clean"]),
            "platform_attacked": pf(runs["attacked"]),
            "attack_shift_raw_pp": 100 * shift_raw,
            "attack_shift_adjusted_pp": 100 * shift_adj,
            "shift_removed": 1 - shift_adj / shift_raw if shift_raw else None,
        },
        "cluster_ari": ari,
        # a cached run reuses another run's answers: charge what those answers cost
        "cost_usd": sum(source_cost(r) for r in runs.values()),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--clean", required=True)
    p.add_argument("--attacked", required=True)
    p.add_argument("--out", help="write the JSON here (default: data/bench/<attacked run>.json)")
    p.add_argument("--record", action="store_true", help="also store it via POST /benchmarks")
    p.add_argument("--label", default=None, help="name suffix, e.g. 'jev v4' or 'heuristics only'")
    p.add_argument("--kind", default="attack", choices=["attack", "ablation"])
    args = p.parse_args()
    result = score(args.clean, args.attacked)
    out = Path(args.out) if args.out else settings.data_dir / "bench" / f"{args.attacked}.json"
    out.write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))
    if args.record:
        name = f"{result['benchmark']} · {args.label or result['backend']}"
        body = {
            "kind": args.kind,
            "name": name,
            "backend": result["backend"],
            "question_set": result["question_set"],
            "run_ids": [args.clean, args.attacked],
            "metrics": result,
            "cost_usd": result["cost_usd"],
        }
        r = httpx.post(f"{API}/benchmarks", json=body, timeout=30)
        r.raise_for_status()
        print("recorded", r.json()["id"])


if __name__ == "__main__":
    main()
