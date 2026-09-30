from dataclasses import dataclass, field

from fastapi import Request

from app.core.config import Settings
from app.core.db import Database
from app.core.events import EventRegistry


@dataclass
class AppState:
    settings: Settings
    db: Database
    events: EventRegistry
    pipelines: dict = field(default_factory=dict)  # run_id -> Pipeline (live runs)
    tasks: set = field(default_factory=set)  # strong refs so tasks aren't GC'd


def get_state(request: Request) -> AppState:
    return request.app.state.rie
