import json

import httpx
import pytest

from app.systemone.backend import SystemOneBackend
from app.systemone.client import BackendSpec, SystemOneClient, SystemOneError, normalise_answer
from app.systemone.packing import pack, unpack
from app.systemone.questions_v1 import QUESTIONS, build_state, verdict_words
from tests.fake_systemone import FakeSystemOne


def spec(**kw) -> BackendSpec:
    base = dict(
        name="jev",
        base_url="https://fake",
        model="jev-latest",
        api_key="k",
        price_per_mtok=0.042,
        max_attempts=4,
    )
    return BackendSpec(**(base | kw))


STATE = build_state("Helldivers 2", "steam", "Not recommended", "PSN link required. Refunded.")


async def test_ask_parses_answers_usage_and_resolved_model() -> None:
    fake = FakeSystemOne()
    async with SystemOneClient(spec(), transport=fake.transport) as c:
        r = await c.ask(STATE, QUESTIONS)
    assert set(r.answers) == set(QUESTIONS)
    assert r.answers["spam_promo"]["type"] == "noul" and "confidence" not in r.answers["spam_promo"]
    assert r.answers["informativeness"]["confidence"] == 0.9
    assert r.model_version == "jev-1.13.0"
    assert c.usage.requests == 1 and c.usage.input_tokens == r.input_tokens > 0
    assert c.cost_usd == pytest.approx(r.input_tokens * 0.042 / 1e6)
    sent = fake.requests[0]
    assert sent["model"] == "jev-latest" and sent["state"] == STATE


@pytest.mark.parametrize("status", [429, 529, 503])
async def test_retries_throttling_then_succeeds(status: int) -> None:
    fake = FakeSystemOne(fail_first=2, fail_status=status)
    async with SystemOneClient(spec(), transport=fake.transport) as c:
        r = await c.ask(STATE, QUESTIONS)
    assert len(fake.requests) == 3 and c.usage.retries == 2
    assert set(r.answers) == set(QUESTIONS)


@pytest.mark.parametrize("status", [401, 422])
async def test_caller_errors_fail_fast(status: int) -> None:
    fake = FakeSystemOne(fail_first=99, fail_status=status)
    async with SystemOneClient(spec(), transport=fake.transport) as c:
        with pytest.raises(SystemOneError) as err:
            await c.ask(STATE, QUESTIONS)
    assert err.value.status == status and not err.value.retryable
    assert len(fake.requests) == 1


async def test_gives_up_after_max_attempts() -> None:
    fake = FakeSystemOne(fail_first=99, fail_status=429)
    async with SystemOneClient(spec(max_attempts=3), transport=fake.transport) as c:
        with pytest.raises(SystemOneError):
            await c.ask(STATE, QUESTIONS)
    assert len(fake.requests) == 3


async def test_missing_answer_is_an_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"model": "m", "answers": {}, "usage": {}})

    async with SystemOneClient(spec(), transport=httpx.MockTransport(handler)) as c:
        with pytest.raises(SystemOneError, match="omitted answers"):
            await c.ask(STATE, QUESTIONS)


def test_normalise_ignores_backend_extras() -> None:
    laya_noul = {
        "type": "noul",
        "noul": 0.1,
        "confidence": 0.9,
        "answer_confidence": 0.9,
        "action": {},
    }
    assert normalise_answer(laya_noul) == {"type": "noul", "noul": 0.1}


def test_pack_retargets_fields_and_roundtrips() -> None:
    states = [STATE, build_state("Helldivers 2", "steam", "Recommended", "Fun with friends.")]
    packed_state, packed_q = pack(states, QUESTIONS)
    assert packed_state == {"reviews": states}
    assert len(packed_q) == 2 * len(QUESTIONS)
    assert "`reviews[1].verdict`" in packed_q["r1__rating_support"]["instructions"]
    assert "`review`" not in json.dumps(packed_q)
    answers = {k: {"type": "noul", "noul": 0.5} for k in packed_q}
    assert unpack(answers, 2, QUESTIONS)[1].keys() == QUESTIONS.keys()


async def test_backend_packs_on_jev_and_refuses_on_laya() -> None:
    fake = FakeSystemOne()
    backend = SystemOneBackend(SystemOneClient(spec(), transport=fake.transport), pack_size=5)
    out = await backend.judge_batch(list(range(12)), [STATE] * 12)
    assert len(out) == 12 and len(fake.requests) == 3  # 5 + 5 + 2
    assert backend.model_version == "jev:jev-1.13.0"
    with pytest.raises(ValueError, match="only supported on Jev"):
        SystemOneBackend(SystemOneClient(spec(name="laya")), pack_size=5)


@pytest.mark.parametrize(
    ("raw", "norm", "scale", "words"),
    [
        (1.0, 1.0, "binary", "Recommended"),
        (0.0, 0.0, "binary", "Not recommended"),
        (4.0, 0.75, "1-5", "Positive (4 of 5 stars)"),
        (1.0, 0.0, "1-5", "Very negative (1 of 5 stars)"),
        (10.0, 1.0, "1-10", "Very positive (10 of 10 stars)"),
        (None, None, "1-5", "No rating given"),
    ],
)
def test_verdict_is_given_in_words(raw, norm, scale, words) -> None:
    assert verdict_words(raw, norm, scale) == words


def test_average_answers() -> None:
    from app.systemone.ensemble import average_answers

    q = {
        "n": {"type": "noul"},
        "s": {"type": "score", "criteria": ["a", "b", "c"]},
        "c": {"type": "choice", "criteria": {"x": "", "y": ""}},
    }
    a = {
        "n": {"type": "noul", "noul": 0.2},
        "s": {
            "type": "score",
            "score": 1.0,
            "probabilities": {"0": 0.2, "1": 0.6, "2": 0.2},
            "confidence": 0.6,
        },
        "c": {
            "type": "choice",
            "choice": "x",
            "probabilities": {"x": 0.6, "y": 0.4},
            "confidence": 0.2,
        },
    }
    b = {
        "n": {"type": "noul", "noul": 0.4},
        "s": {
            "type": "score",
            "score": 2.0,
            "probabilities": {"0": 0.0, "1": 0.0, "2": 1.0},
            "confidence": 1.0,
        },
        "c": {
            "type": "choice",
            "choice": "y",
            "probabilities": {"x": 0.3, "y": 0.7},
            "confidence": 0.4,
        },
    }
    m = average_answers([a, b], q)
    assert m["n"]["noul"] == pytest.approx(0.3)
    assert m["s"]["score"] == pytest.approx(1.5) and m["s"]["confidence"] == pytest.approx(0.8)
    assert m["s"]["probabilities"]["2"] == pytest.approx(0.6)
    assert m["c"]["choice"] == "y" and m["c"]["probabilities"]["x"] == pytest.approx(0.45)
    assert average_answers([a], q) is a  # k=1 passes the backend answer through untouched


def test_preflight_token_model() -> None:
    from app.models import RunCreate
    from app.systemone.preflight import TOKENS_PER_STATE_CHAR, estimate, question_tokens

    states = [STATE] * 10
    req = RunCreate(dataset_id="d", backend="jev")
    pf = estimate(states, req, price_per_mtok=0.042, requests_per_second=40, limit_usd=2.0)
    per_call = question_tokens(req.question_set) + TOKENS_PER_STATE_CHAR * len(
        json.dumps(STATE, ensure_ascii=False)
    )
    assert pf.est_input_tokens == int(10 * per_call)
    assert pf.est_seconds == pytest.approx(10 / 40, abs=0.1)
    reuse = estimate(
        states,
        req.model_copy(update={"reuse_identical_inputs": True}),
        price_per_mtok=0.042,
        requests_per_second=40,
        limit_usd=2.0,
        distinct_inputs=1,
    )
    assert reuse.calls == 1
