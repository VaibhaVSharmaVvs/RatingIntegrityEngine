import json
import random
from pathlib import Path

import numpy as np
import polars as pl
import pytest

from app.features.embeddings import embed_cached, nearest_neighbours
from app.features.extract import deterministic_features, feature_counts, semantic_features
from app.features.heuristics import account_features, text_features
from app.features.minhash import duplicate_groups
from app.models import FeatureConfig
from tests.fakes import HashingEmbedder

CFG = FeatureConfig()

VOCAB = [
    "the",
    "combat",
    "feels",
    "tight",
    "and",
    "the",
    "stratagems",
    "are",
    "creative",
    "but",
    "matchmaking",
    "breaks",
    "often",
    "servers",
    "crash",
    "after",
    "updates",
    "enemies",
    "swarm",
    "quickly",
    "friendly",
    "fire",
    "causes",
    "chaos",
    "weapons",
    "need",
    "balance",
    "progression",
    "is",
    "slow",
    "the",
    "difficulty",
    "scales",
    "well",
    "with",
    "four",
    "players",
    "map",
    "variety",
    "is",
    "limited",
    "missions",
    "repeat",
    "voice",
    "lines",
    "are",
    "fun",
    "ship",
    "upgrades",
    "take",
    "time",
]


def organic(n: int, seed: int = 0) -> list[str]:
    rng = random.Random(seed)
    return [" ".join(rng.choices(VOCAB, k=rng.randint(15, 40))) for _ in range(n)]


def perturb(text: str, rng: random.Random) -> str:
    """A near-copy: one word dropped and one word swapped, as a paraphrase bot would do."""
    words = text.split()
    words.pop(rng.randrange(len(words)))
    words[rng.randrange(len(words))] = rng.choice(["really", "honestly", "truly", "just"])
    return " ".join(words)


# --- heuristics ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "pattern"),
    [
        ("free keys at discord.gg/abc123 get yours", "discord_invite"),
        ("FREE STEAM KEYS here", "free_keys"),
        ("buy it cheaper on g2a.com", "key_reseller"),
        ("use my code GAMER10", "promo_code"),
        ("trade offers welcome", "trade_offer"),
        ("cheap accounts and boosting service, dm me", "boosting"),
    ],
)
def test_promo_patterns_fire(text: str, pattern: str) -> None:
    f = text_features(pl.Series([text]))
    assert f["has_promo"][0]
    assert pattern in json.loads(f["promo_hits"][0])


@pytest.mark.parametrize(
    ("text", "pattern"),
    [
        ("check out my channel for gameplay", "self_promo"),
        ("here is my gameplay video on the steam deck: https://youtu.be/m4jeoi5", "stream_link"),
        ("watch at twitch.tv/somebody", "stream_link"),
    ],
)
def test_self_promo_is_recorded_but_not_promo(text: str, pattern: str) -> None:
    """Reviewers linking their own video review are not advertising (real Gollum data)."""
    f = text_features(pl.Series([text]))
    assert not f["has_promo"][0]
    assert pattern in json.loads(f["promo_hits"][0])


@pytest.mark.parametrize(
    "text",
    [
        "the devs gave out free updates, great value",  # "free" but not promo
        "good trade-offs between weapons",
        "I watched a youtube review before buying",
        "the discord community is helpful",
        "PSN account requirement is a dealbreaker. Refunded.",
        # Real HD2 review phrases that the first pattern set flagged wrongly:
        "a refreshing break from all the free game with battle-pass structure",
        "those devs for resisting sony finally giving us a free game",
        "you only need to buy credits if you want access to all the warbonds",
    ],
)
def test_promo_patterns_do_not_fire_on_opinions(text: str) -> None:
    assert not text_features(pl.Series([text]))["has_promo"][0]


def test_text_statistics() -> None:
    f = text_features(pl.Series(["bad bad bad", "Great game!!!!!!!", "🔥🔥🔥 ok", "", None]))
    assert f["n_tokens"].to_list() == [3, 2, 1, 0, 0]
    assert f["type_token_ratio"][0] == pytest.approx(1 / 3)
    assert f["max_char_run"][1] == 7
    assert f["emoji_ratio"][2] == pytest.approx(3 / 6)
    assert f["emoji_ratio"][0] == 0.0
    assert not f["has_url"][0]
    assert text_features(pl.Series(["see www.example.com now"]))["has_url"][0]


def test_account_features_from_steam_meta_and_null_elsewhere() -> None:
    meta = pl.Series(
        [
            json.dumps(
                {
                    "author_playtime_at_review": 30,
                    "author_num_reviews": 1,
                    "received_for_free": False,
                    "steam_purchase": False,
                }
            ),
            json.dumps(
                {
                    "author_playtime_at_review": 6000,
                    "author_num_reviews": 40,
                    "received_for_free": True,
                    "steam_purchase": True,
                }
            ),
            None,
        ]
    )
    f = account_features(meta, CFG)
    assert f["low_playtime"].to_list() == [True, False, None]
    assert f["single_review_account"].to_list() == [True, False, None]
    assert f["received_for_free"].to_list() == [False, True, None]
    assert f["not_purchased"].to_list() == [True, False, None]


# --- duplicates (exit criterion: 100% exact, >= 90% near) ---------------------------


def test_duplicate_detection_recall_on_injected_copies() -> None:
    rng = random.Random(42)
    base = organic(2000)
    templates = organic(20, seed=99)
    texts = list(base)
    exact_idx, near_idx, family = [], [], {}
    offset = len(templates)
    for f, t in enumerate(templates):
        family[f] = f
        for _ in range(5):  # exact copies of each template
            exact_idx.append(offset + len(texts))
            family[offset + len(texts)] = f
            texts.append(t)
        for _ in range(5):  # near-copies of each template
            near_idx.append(offset + len(texts))
            family[offset + len(texts)] = f
            texts.append(perturb(t, rng))
    # Put each template's original first so it is the earliest in its group.
    texts = templates + texts

    g = duplicate_groups(texts, CFG)
    exact_recall = np.mean([g["exact_group_id"][i] >= 0 for i in exact_idx])
    near_recall = np.mean([g["dup_group_id"][i] >= 0 for i in near_idx])
    assert exact_recall == 1.0
    assert near_recall >= 0.9, near_recall

    # "Keep the first": a detected copy points at the earliest member of its own
    # template family. Two near-copies may match each other and not the original,
    # which is correct; they must never join a different family or organic text.
    for i in exact_idx + near_idx:
        if g["dup_of"][i] >= 0:
            assert family.get(int(g["dup_of"][i])) == family[i]
    assert all(g["dup_of"][i] == i for i in range(offset))

    # Organic reviews (random word salad) are not grouped with each other.
    organic_grouped = np.mean(g["dup_group_id"][offset : offset + len(base)] >= 0)
    assert organic_grouped < 0.01, organic_grouped


def test_exact_duplicates_ignore_case_whitespace_and_punctuation() -> None:
    g = duplicate_groups(["Great  game!", "great game", "GREAT GAME.", "different text here"], CFG)
    assert g["exact_group_id"].tolist() == [0, 0, 0, -1]
    assert g["dup_of"].tolist() == [0, 0, 0, -1]
    assert g["dup_score"].tolist() == [1.0, 1.0, 1.0, 0.0]


def test_template_flood_is_not_quadratic() -> None:
    """5,000 identical reviews collapse to one LSH item (would be ~12.5M pairs)."""
    texts = ["this game is a scam refund now everyone"] * 5000 + organic(50)
    g = duplicate_groups(texts, CFG)
    assert (g["dup_of"][:5000] == 0).all()


# --- embeddings ---------------------------------------------------------------------


def test_nearest_neighbour_excludes_self_and_finds_twin() -> None:
    emb = HashingEmbedder().encode(["a b c", "x y z", "a b c", "a b d"])
    nn, cos = nearest_neighbours(emb)
    assert nn[0] == 2 and nn[2] == 0
    assert cos[0] == pytest.approx(1.0)
    assert (nn != np.arange(4)).all()


def test_embedding_cache_hit_and_content_invalidation(tmp_path: Path) -> None:
    emb = HashingEmbedder()
    a, hit1 = embed_cached(["x y", "z"], emb, tmp_path, "ds1")
    b, hit2 = embed_cached(["x y", "z"], emb, tmp_path, "ds1")
    _, hit3 = embed_cached(["x y", "changed"], emb, tmp_path, "ds1")
    assert (hit1, hit2, hit3) == (False, True, False)
    assert np.array_equal(a, b)
    assert emb.calls == 2


# --- end to end ---------------------------------------------------------------------


def test_deterministic_and_semantic_features(tmp_path: Path) -> None:
    long_copy = "this game is a total scam and the developers lied about everything they promised"
    texts = [
        "free keys at discord.gg/x1 now",
        "good game",
        "good game",
        long_copy,
        long_copy,
        *organic(30),
    ]
    reviews = pl.DataFrame({"id": range(len(texts)), "text": texts, "meta": [None] * len(texts)})
    frame, timings = deterministic_features(reviews, CFG)
    assert frame.height == len(texts)
    assert frame["review_id"].to_list() == list(range(len(texts)))
    counts = feature_counts(frame, CFG)
    assert counts["promo"] == 1
    assert counts["exact_dup_reviews"] == 4
    # "good game" is a duplicate but too short to count as copying evidence;
    # the second long copy is a later copy.
    assert counts["later_copies"] == 1
    assert set(timings) == {"heuristics", "minhash"}

    emb = HashingEmbedder()
    sem = semantic_features(texts, emb, tmp_path, "ds")
    assert sem.nn_review_id[3] == 4 and sem.nn_cosine_max[3] == pytest.approx(1.0)
    assert set(sem.timings_s) == {"embeddings", "knn"}
    warm = semantic_features(texts, emb, tmp_path, "ds")
    assert warm.cache_hit and emb.calls == 1
    assert np.array_equal(warm.nn_review_id, sem.nn_review_id)
    changed = semantic_features([*texts[:-1], "brand new text"], emb, tmp_path, "ds")
    assert not changed.cache_hit  # stale kNN is never served for changed content
