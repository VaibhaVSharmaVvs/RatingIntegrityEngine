"""Build the synthetic-attack benchmark (MVP_SPEC §10): a clean Steam slice and the same
slice with injected attacks whose ground truth is exact.

Clean slice: Helldivers 2, 2024-04-01 → 04-28 (before the May bomb), stratified by day.
Attacks, each in its own window so their bursts do not merge:

| type               | n   | verdict  | shape                                                          |
|--------------------|-----|----------|----------------------------------------------------------------|
| template_flood     | 150 | negative | one copy-paste text with small slot edits, over 2 days          |
| paraphrase_flood   | 150 | negative | one off-topic boycott message in many wordings, over 24 h       |
| coordinated_burst  | 200 | negative | varied, on-topic short complaints, new accounts, within 3 h     |
| astroturf_flood    | 150 | positive | templated praise from new accounts, within 6 h                  |
| spam               |  40 | mixed    | promo links and key resellers, spread over the month            |

The coordinated burst is deliberately hard: its texts look like genuine complaints, so
only timing, account signals and clustering can give it away.

Injected reviews get `ext_id` "inj-<type>-<n>". Ground truth (review id → type, for both
datasets) goes to data/bench/<name>.truth.json; it is never stored in review meta, so no
pipeline stage can see it. System One sees only the text and verdict, as for any review.

Usage (from backend/, with the API stopped: this writes to DuckDB directly):
    uv run python ../tools/inject_attacks.py --n-clean 5000
"""

import argparse
import hashlib
import json
import random
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import polars as pl

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.core.config import settings  # noqa: E402
from app.core.db import Database  # noqa: E402
from app.ingest.steam_fetcher import load_pull  # noqa: E402
from app.ingest.steam_import import steam_to_reviews, stratified_sample  # noqa: E402
from app.ingest.store import create_dataset, insert_reviews  # noqa: E402

PULL = "553850_2024-04-01_2024-06-30"
SUBJECT = "Helldivers 2"
CLEAN_FROM = datetime(2024, 4, 1, tzinfo=UTC)
CLEAN_TO = datetime(2024, 4, 29, tzinfo=UTC)

# --- text generators (seeded, so the benchmark is reproducible) -------------------------

TEMPLATE = (
    "{open} this game is {state} after the latest patch. {issue_a}, {issue_b} and the devs "
    "keep ignoring the community. Do NOT buy it until they fix it. {close}"
)
T_OPEN = ["Honestly,", "Warning:", "Real talk:", "Listen,", ""]
T_STATE = ["completely broken", "totally broken", "basically unplayable", "completely broken"]
T_ISSUE_A = ["Crashes every second mission", "Crashes every other mission", "Crashes every mission"]
T_ISSUE_B = ["matchmaking never works", "matchmaking barely works", "matchmaking doesn't work"]
T_CLOSE = ["Refunded.", "Requesting a refund.", "", "Save your money."]

P_SUBJECT = [
    "The publisher",
    "The parent company",
    "This studio's owner",
    "The company behind this",
    "Their corporate overlords",
    "The people who own this franchise",
]
P_ACT = [
    "just donated to a political campaign I can't support",
    "took a political side I find disgusting",
    "is funding politicians who are against everything I believe in",
    "made public statements I strongly disagree with",
    "backed a cause that I refuse to support with my money",
    "openly sided with people I won't give money to",
]
P_REASON = [
    "so I'm not giving them another cent",
    "and that's reason enough for me",
    "and I won't support that",
    "so this gets a thumbs down from me",
    "and my wallet votes accordingly",
    "so I'm out",
]
P_CALL = [
    "Boycott until they apologise.",
    "Everyone should leave a negative review.",
    "Don't reward this behaviour.",
    "Spread the word.",
    "Vote with your wallet.",
    "",
]

C_COMPLAINTS = [
    "Servers are down again",
    "Lost all my progress after a crash",
    "The new warbond is a ripoff",
    "Railgun nerf killed the fun",
    "Spawn rates are ridiculous on helldive",
    "Can't join friends, keeps timing out",
    "Performance tanked after the update",
    "Too grindy for super credits",
    "Bugs everywhere, mission objectives don't register",
    "Game crashes on extraction every time",
    "Friendly fire hitboxes are a joke",
    "Matchmaking takes forever",
    "Patrols spawn right on top of you",
    "Medals cap is too low",
    "Ship modules cost way too much",
    "Bile titans one-shot you through cover",
    "Stuck on the loading screen half the time",
    "The balance team hates fun",
    "Shotguns feel useless now",
    "Audio keeps cutting out",
    "Disconnects mid-mission, lose all rewards",
    "Difficulty scaling is broken",
    "UI is clunky and slow",
    "Stratagem inputs drop randomly",
    "FPS drops below 30 on a good PC",
    "Rewards are not worth the time",
    "Every patch breaks something new",
    "Objectives bug out and can't be completed",
    "Quickplay drops me into failing missions",
    "Armor passives do nothing",
]
C_TAIL = [
    "",
    "",
    " Not recommended.",
    " Fix it.",
    " Disappointed.",
    " Waste of money right now.",
    " 2/10.",
]

A_OPEN = [
    "Best game I've played in years!",
    "Absolute masterpiece!",
    "Best co-op game ever made!",
    "Incredible game!",
]
A_MID = [
    "Amazing gameplay, amazing graphics, amazing devs.",
    "Great gameplay, great graphics, great community.",
    "Perfect gameplay, perfect graphics, perfect devs.",
]
A_CLOSE = [
    "10/10 would recommend to everyone!",
    "10/10, everyone should buy it!",
    "10/10 must buy for everyone!",
]

S_SPAM = [
    "Free Helldivers 2 keys giveaway at discord.gg/{tag} join now",
    "Get it way cheaper on g2a.com use my code {tag}",
    "free steam keys every day, join discord.gg/{tag}",
    "Check out my channel youtube.com/@{tag} for helldivers builds and giveaways",
    "cheap keys at kinguin.com code {tag} for 10% off",
    "Join t.me/{tag} for free super credits",
    "skin giveaway on bit.ly/{tag} hurry",
    "Subscribe to my channel for free keys youtube.com/@{tag}",
]


def template_flood(rng: random.Random, n: int) -> list[str]:
    return [
        " ".join(
            TEMPLATE.format(
                open=rng.choice(T_OPEN),
                state=rng.choice(T_STATE),
                issue_a=rng.choice(T_ISSUE_A),
                issue_b=rng.choice(T_ISSUE_B),
                close=rng.choice(T_CLOSE),
            ).split()
        )
        for _ in range(n)
    ]


def paraphrase_flood(rng: random.Random, n: int) -> list[str]:
    out, seen = [], set()
    while len(out) < n:
        parts = (rng.choice(P_SUBJECT), rng.choice(P_ACT), rng.choice(P_REASON), rng.choice(P_CALL))
        if parts in seen:
            continue
        seen.add(parts)
        out.append(f"{parts[0]} {parts[1]}, {parts[2]}. {parts[3]}".strip())
    return out


def coordinated_burst(rng: random.Random, n: int) -> list[str]:
    out = []
    for _ in range(n):
        k = rng.choice([1, 1, 2])
        lines = rng.sample(C_COMPLAINTS, k)
        out.append(". ".join(lines) + "." + rng.choice(C_TAIL))
    return out


def astroturf_flood(rng: random.Random, n: int) -> list[str]:
    return [f"{rng.choice(A_OPEN)} {rng.choice(A_MID)} {rng.choice(A_CLOSE)}" for _ in range(n)]


def spam(rng: random.Random, n: int) -> list[str]:
    return [rng.choice(S_SPAM).format(tag=f"{rng.randrange(16**6):06x}") for _ in range(n)]


# --- rows ---------------------------------------------------------------------------------


def window(start: datetime, hours: float, n: int, rng: random.Random) -> list[datetime]:
    return sorted(start + timedelta(seconds=rng.uniform(0, hours * 3600)) for _ in range(n))


ATTACKS = [
    # type, generator, n, voted_up, start, hours, new accounts share, low playtime share
    (
        "template_flood",
        template_flood,
        150,
        False,
        datetime(2024, 4, 10, 6, tzinfo=UTC),
        48,
        0.5,
        0.3,
    ),
    (
        "paraphrase_flood",
        paraphrase_flood,
        150,
        False,
        datetime(2024, 4, 14, 0, tzinfo=UTC),
        24,
        0.4,
        0.3,
    ),
    (
        "coordinated_burst",
        coordinated_burst,
        200,
        False,
        datetime(2024, 4, 18, 14, tzinfo=UTC),
        3,
        0.8,
        0.6,
    ),
    (
        "astroturf_flood",
        astroturf_flood,
        150,
        True,
        datetime(2024, 4, 22, 20, tzinfo=UTC),
        6,
        0.8,
        0.6,
    ),
    ("spam", spam, 40, None, datetime(2024, 4, 2, 0, tzinfo=UTC), 24 * 26, 0.9, 0.8),
]


def injected_rows(seed: int) -> pl.DataFrame:
    rng = random.Random(seed)
    rows = []
    for kind, gen, n, voted_up, start, hours, new_share, low_share in ATTACKS:
        for i, (text, t) in enumerate(zip(gen(rng, n), window(start, hours, n, rng), strict=True)):
            ts = int(t.timestamp())
            new = rng.random() < new_share
            playtime = rng.randint(5, 110) if rng.random() < low_share else rng.randint(150, 9000)
            rows.append(
                {
                    "ext_id": f"inj-{kind}-{i:04d}",
                    "author_hash": hashlib.sha256(f"inj|{seed}|{kind}|{i}".encode()).hexdigest(),
                    "text": text,
                    "language": "english",
                    "timestamp_created": ts,
                    "timestamp_updated": ts,
                    "voted_up": rng.random() < 0.5 if voted_up is None else voted_up,
                    "votes_up": 0,
                    "votes_funny": 0,
                    "weighted_vote_score": 0.0,
                    "comment_count": 0,
                    "steam_purchase": rng.random() < 0.85,
                    "received_for_free": False,
                    "refunded": False,
                    "written_during_early_access": False,
                    "primarily_steam_deck": False,
                    "author_num_games_owned": rng.randint(1, 8) if new else rng.randint(20, 400),
                    "author_num_reviews": 1 if new else rng.randint(2, 60),
                    "author_playtime_forever": playtime + rng.randint(0, 300),
                    "author_playtime_at_review": playtime,
                }
            )
    return pl.DataFrame(rows)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--n-clean", type=int, default=5000)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--name", default="attack-bench-v1")
    args = p.parse_args()

    raw = load_pull(settings.steam_pulls_dir / PULL)
    clean = raw.filter(
        pl.col("timestamp_created").is_between(
            int(CLEAN_FROM.timestamp()), int(CLEAN_TO.timestamp()), closed="left"
        )
    )
    clean = stratified_sample(clean, args.n_clean, seed=args.seed)
    inj = injected_rows(args.seed).cast(clean.schema)
    attacked = pl.concat([clean, inj])

    db = Database(settings.db_path)
    params = {"benchmark": args.name, "pull_dir": PULL, "subject": SUBJECT, "seed": args.seed}
    ids = {}
    for label, frame in (("clean", clean), ("attacked", attacked)):
        ids[label] = create_dataset(
            db,
            name=f"Benchmark {args.name}: HD2 Apr 2024 {label}",
            source="steam",
            rating_scale="binary",
            source_params=params | {"variant": label, "sample_n": args.n_clean},
        )
        insert_reviews(db, ids[label], steam_to_reviews(frame))

    with db.cursor() as cur:
        rows = cur.execute(
            "SELECT id, ext_id FROM reviews WHERE dataset_id = ? AND ext_id LIKE 'inj-%' ORDER BY id",
            [ids["attacked"]],
        ).fetchall()
    truth = {str(i): e.split("-")[1] for i, e in rows}
    out = settings.data_dir / "bench" / f"{args.name}.truth.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "name": args.name,
                "datasets": ids,
                "n_clean": clean.height,
                "n_injected": inj.height,
                "attacks": {
                    a[0]: {"n": a[2], "start": a[4].isoformat(), "hours": a[5]} for a in ATTACKS
                },
                "truth": truth,  # attacked dataset: review id -> attack type
            },
            indent=1,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {"datasets": ids, "clean": clean.height, "injected": inj.height, "truth": str(out)}
        )
    )


if __name__ == "__main__":
    main()
