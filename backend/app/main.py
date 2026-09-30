import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import datasets, runs
from app.api.deps import AppState
from app.core.config import Settings, settings
from app.core.db import Database
from app.core.events import EventRegistry


def create_app(config: Settings = settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(config.db_path)
        app.state.rie = AppState(settings=config, db=db, events=EventRegistry(config.replays_dir))
        yield
        for task in list(app.state.rie.tasks):
            task.cancel()
        db.close()

    app = FastAPI(title="Rating Integrity Engine", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(datasets.router)
    app.include_router(runs.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
app = create_app()
