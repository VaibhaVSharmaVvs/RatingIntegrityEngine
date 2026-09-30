"""Pipeline-facing System One backend: Jev or Laya behind one interface.

`judge_batch(review_ids, states) -> list[answers]` is the same interface as
`MockBackend`, so the pipeline has no per-backend branches.
"""

import asyncio

from app.core.config import Settings
from app.systemone.client import BackendSpec, SystemOneClient
from app.systemone.ensemble import average_answers
from app.systemone.packing import pack, unpack
from app.systemone.questions_v1 import QUESTIONS

JEV_PRICE_PER_MTOK = 0.042  # docs.typesafe.ai/models.md, 2026-09-30 (MEASUREMENTS M4)


def backend_spec(name: str, settings: Settings, model: str | None, concurrency: int) -> BackendSpec:
    if name == "jev":
        if not settings.typesafe_api_key:
            raise ValueError("TYPESAFE_API_KEY is not set")
        return BackendSpec(
            name="jev",
            base_url=settings.typesafe_base_url,
            model=model or settings.jev_model,
            api_key=settings.typesafe_api_key,
            price_per_mtok=JEV_PRICE_PER_MTOK,
            requests_per_second=settings.jev_requests_per_second,
            concurrency=concurrency,
        )
    if name == "laya":
        return BackendSpec(
            name="laya",
            base_url=settings.laya_base_url,
            model=model or settings.laya_model,
            price_per_mtok=0.0,
            requests_per_second=100.0,
            # laya-serve is CPU-bound; parallel requests only add latency (M1).
            concurrency=min(concurrency, 2),
            timeout_s=600.0,
        )
    raise ValueError(f"no System One backend named {name!r}")


class SystemOneBackend:
    def __init__(
        self,
        client: SystemOneClient,
        pack_size: int = 1,
        questions: dict | None = None,
        samples_per_review: int = 1,
    ) -> None:
        if pack_size > 1 and client.spec.name != "jev":
            raise ValueError("packing is only supported on Jev (it is broken on Laya, M1b)")
        self.client = client
        self.pack_size = pack_size
        self.samples = samples_per_review
        self.questions = questions or QUESTIONS

    @property
    def model_version(self) -> str:
        versions = sorted(self.client.usage.model_versions)
        name = self.client.spec.name
        return f"{name}:{'+'.join(versions)}" if versions else f"{name}:{self.client.spec.model}"

    @property
    def cost_usd(self) -> float:
        return self.client.cost_usd

    @property
    def tokens_in(self) -> int:
        return self.client.usage.input_tokens

    async def judge_batch(self, review_ids: list[int], states: list[dict]) -> list[dict]:
        if self.samples == 1:
            return await self._judge_once(states)
        draws = await asyncio.gather(*(self._judge_once(states) for _ in range(self.samples)))
        return [average_answers([d[i] for d in draws], self.questions) for i in range(len(states))]

    async def _judge_once(self, states: list[dict]) -> list[dict]:
        if self.pack_size == 1:
            results = await asyncio.gather(*(self.client.ask(s, self.questions) for s in states))
            return [r.answers for r in results]
        chunks = [states[i : i + self.pack_size] for i in range(0, len(states), self.pack_size)]

        async def one(chunk: list[dict]) -> list[dict]:
            state, questions = pack(chunk, self.questions)
            result = await self.client.ask(state, questions)
            return unpack(result.answers, len(chunk), self.questions)

        out: list[dict] = []
        for part in await asyncio.gather(*(one(c) for c in chunks)):
            out.extend(part)
        return out

    async def aclose(self) -> None:
        await self.client.aclose()
