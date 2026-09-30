"""Per-run event bus → SSE subscribers + replay recorder (MVP_SPEC §3).

Every event is kept in memory with its offset from run start, so a subscriber that
connects mid-run (or after the run) gets the full history first, then live events.
On close the history is written to `replays/{run_id}.jsonl.gz`; that file is what the
static public demo plays back.
"""

import asyncio
import gzip
import time
from collections.abc import AsyncIterator
from pathlib import Path

from pydantic import BaseModel

from app.models import ReplayLine

_CLOSED = object()


class RunEventBus:
    def __init__(self, run_id: str, replay_path: Path) -> None:
        self.run_id = run_id
        self.replay_path = replay_path
        self.history: list[ReplayLine] = []
        self.closed = False
        self._t0 = time.monotonic()
        self._subscribers: set[asyncio.Queue] = set()

    def publish(self, event: BaseModel) -> None:
        if self.closed:
            raise RuntimeError(f"bus for {self.run_id} is closed")
        line = ReplayLine(t=round(time.monotonic() - self._t0, 4), event=event)  # type: ignore[arg-type]
        self.history.append(line)
        for q in self._subscribers:
            q.put_nowait(line)

    def close(self) -> None:
        """Stop the stream and persist the replay. Idempotent."""
        if self.closed:
            return
        self.closed = True
        self.replay_path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(self.replay_path, "wt", encoding="utf-8") as f:
            for line in self.history:
                f.write(line.model_dump_json() + "\n")
        for q in self._subscribers:
            q.put_nowait(_CLOSED)

    async def subscribe(self) -> AsyncIterator[ReplayLine]:
        """History first, then live events until the bus closes."""
        q: asyncio.Queue = asyncio.Queue()
        backlog = list(self.history)
        if self.closed:
            for line in backlog:
                yield line
            return
        self._subscribers.add(q)
        try:
            for line in backlog:
                yield line
            while True:
                item = await q.get()
                if item is _CLOSED:
                    return
                yield item
        finally:
            self._subscribers.discard(q)


def read_replay(path: Path) -> list[ReplayLine]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [ReplayLine.model_validate_json(line) for line in f if line.strip()]


class EventRegistry:
    """Live buses by run id. After a restart, finished runs are served from replay files."""

    def __init__(self, replays_dir: Path) -> None:
        self.replays_dir = replays_dir
        self._buses: dict[str, RunEventBus] = {}

    def replay_path(self, run_id: str) -> Path:
        return self.replays_dir / f"{run_id}.jsonl.gz"

    def create(self, run_id: str) -> RunEventBus:
        bus = RunEventBus(run_id, self.replay_path(run_id))
        self._buses[run_id] = bus
        return bus

    def get(self, run_id: str) -> RunEventBus | None:
        return self._buses.get(run_id)

    def stream(self, run_id: str) -> AsyncIterator[ReplayLine] | None:
        bus = self.get(run_id)
        if bus is not None:
            return bus.subscribe()
        path = self.replay_path(run_id)
        if path.exists():

            async def from_file() -> AsyncIterator[ReplayLine]:
                for line in read_replay(path):
                    yield line

            return from_file()
        return None
