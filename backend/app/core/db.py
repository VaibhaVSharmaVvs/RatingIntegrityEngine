"""DuckDB storage (MVP_SPEC §5): one file, versioned idempotent migrations.

Deviation from the spec, on purpose: `reviews.id` is the review's position within its
dataset, assigned in chronological order at import (PK is `(dataset_id, id)`). That
makes the grid order implicit: grid cell i is review i, so no `grid_order` array.
"""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import duckdb

MIGRATIONS: list[str] = [
    # 1: initial schema
    """
    CREATE TABLE datasets (
        id            VARCHAR PRIMARY KEY,
        name          VARCHAR NOT NULL,
        source        VARCHAR NOT NULL,        -- 'steam' | 'csv' | 'yelpzip' | 'synthetic'
        source_params JSON,
        rating_scale  VARCHAR NOT NULL,        -- 'binary' | '1-5' | '1-10'
        status        VARCHAR NOT NULL,        -- 'fetching' | 'ready' | 'failed'
        error         VARCHAR,
        n_reviews     INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
    );

    CREATE TABLE reviews (
        dataset_id  VARCHAR NOT NULL,
        id          INTEGER NOT NULL,           -- chronological position = grid index
        ext_id      VARCHAR,
        author_hash VARCHAR,                    -- sha256(salt + id); raw IDs never stored
        text        VARCHAR NOT NULL,
        rating_raw  DOUBLE,
        rating_norm DOUBLE,                     -- in [0, 1]
        created_at  TIMESTAMPTZ,
        updated_at  TIMESTAMPTZ,
        lang        VARCHAR,
        meta        JSON,
        PRIMARY KEY (dataset_id, id)
    );

    CREATE TABLE runs (
        id            VARCHAR PRIMARY KEY,
        dataset_id    VARCHAR NOT NULL,
        backend       VARCHAR NOT NULL,         -- 'jev' | 'laya' | 'laya-ft' | 'heuristic' | 'mock'
        model_version VARCHAR,
        config        JSON NOT NULL,
        status        VARCHAR NOT NULL,         -- 'queued' | 'running' | 'done' | 'failed'
        error         VARCHAR,
        started_at    TIMESTAMPTZ,
        finished_at   TIMESTAMPTZ,
        stats         JSON,
        cost_usd      DOUBLE DEFAULT 0,
        tokens_in     BIGINT DEFAULT 0
    );

    CREATE TABLE features (
        run_id           VARCHAR NOT NULL,
        review_id        INTEGER NOT NULL,
        n_tokens         INTEGER,
        type_token_ratio DOUBLE,
        has_url          BOOLEAN,
        has_promo        BOOLEAN,
        emoji_ratio      DOUBLE,
        minhash_bucket   VARCHAR,
        dup_group_id     INTEGER,
        dup_score        DOUBLE,
        nn_cosine_max    DOUBLE,
        embedding_idx    INTEGER,
        PRIMARY KEY (run_id, review_id)
    );

    CREATE TABLE judgments (
        run_id        VARCHAR NOT NULL,
        review_id     INTEGER NOT NULL,
        question_id   VARCHAR NOT NULL,
        type          VARCHAR NOT NULL,         -- 'noul' | 'choice' | 'score'
        value         DOUBLE,
        choice        VARCHAR,
        probabilities JSON,
        confidence    DOUBLE,
        latency_ms    DOUBLE,
        pack_id       INTEGER,
        PRIMARY KEY (run_id, review_id, question_id)
    );

    CREATE TABLE clusters (
        run_id             VARCHAR NOT NULL,
        cluster_id         INTEGER NOT NULL,
        kind               VARCHAR NOT NULL,    -- 'semantic' | 'duplicate' | 'burst'
        size               INTEGER NOT NULL,
        t_start            TIMESTAMPTZ,
        t_end              TIMESTAMPTZ,
        time_concentration DOUBLE,
        mean_similarity    DOUBLE,
        rating_homogeneity DOUBLE,
        new_account_share  DOUBLE,
        offtopic_mean      DOUBLE,
        suspicion          DOUBLE,
        caption            VARCHAR,
        top_phrases        JSON,
        PRIMARY KEY (run_id, cluster_id)
    );

    CREATE TABLE cluster_members (
        run_id     VARCHAR NOT NULL,
        cluster_id INTEGER NOT NULL,
        review_id  INTEGER NOT NULL
    );

    CREATE TABLE decisions (
        run_id          VARCHAR NOT NULL,
        review_id       INTEGER NOT NULL,
        action          VARCHAR NOT NULL,       -- KEEP | DOWNWEIGHT | FLAG | EXCLUDE
        weight          DOUBLE NOT NULL,
        integrity_score DOUBLE,
        reasons         JSON,                   -- top-3 reason codes
        human_override  VARCHAR,
        PRIMARY KEY (run_id, review_id)
    );

    CREATE TABLE labels (
        dataset_id VARCHAR NOT NULL,
        review_id  INTEGER NOT NULL,
        rater      VARCHAR NOT NULL,
        label      VARCHAR NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
    );
    """,
    # 2: Phase 2 feature columns (spec §6.2 signals the §5 table didn't name)
    """
    ALTER TABLE features ADD COLUMN max_char_run INTEGER;
    ALTER TABLE features ADD COLUMN promo_hits JSON;          -- names of matched promo patterns
    ALTER TABLE features ADD COLUMN exact_group_id INTEGER;   -- same normalised text
    ALTER TABLE features ADD COLUMN dup_of INTEGER;           -- earliest review in its dup group
    ALTER TABLE features ADD COLUMN nn_review_id INTEGER;     -- nearest semantic neighbour
    ALTER TABLE features ADD COLUMN low_playtime BOOLEAN;
    ALTER TABLE features ADD COLUMN single_review_account BOOLEAN;
    ALTER TABLE features ADD COLUMN received_for_free BOOLEAN;
    ALTER TABLE features ADD COLUMN not_purchased BOOLEAN;
    """,
    # 3: Phase 4 corpus analysis and S4 cluster rules
    """
    ALTER TABLE clusters ADD COLUMN window_info JSON;       -- densest window / burst rate
    ALTER TABLE decisions ADD COLUMN base_integrity DOUBLE;  -- before the cluster penalty
    ALTER TABLE decisions ADD COLUMN cluster_id INTEGER;     -- most suspicious cluster (-1 none)
    ALTER TABLE decisions ADD COLUMN cluster_suspicion DOUBLE;
    """,
    # 4: Phase 7 benchmark results (one row per scored experiment)
    """
    CREATE TABLE benchmarks (
        id           VARCHAR PRIMARY KEY,
        kind         VARCHAR NOT NULL,          -- attack | control | agreement | adversarial | ablation
        name         VARCHAR NOT NULL,
        backend      VARCHAR,
        question_set VARCHAR,
        run_ids      JSON NOT NULL,
        metrics      JSON NOT NULL,
        cost_usd     DOUBLE NOT NULL DEFAULT 0,
        notes        VARCHAR,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
    );
    """,
]


class Database:
    """One DuckDB connection per process; each caller gets its own cursor.

    DuckDB cursors are independent connections to the same database and are safe to
    use from different threads (FastAPI runs sync endpoints in a threadpool).
    """

    def __init__(self, path: Path | str) -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._con = duckdb.connect(str(path))
        self._lock = threading.Lock()
        self.migrate()

    @contextmanager
    def cursor(self) -> Iterator[duckdb.DuckDBPyConnection]:
        with self._lock:
            cur = self._con.cursor()
        # Burst detection bins by UTC hour; never let the host timezone leak in.
        cur.execute("SET TimeZone = 'UTC'")
        try:
            yield cur
        finally:
            cur.close()

    def migrate(self) -> int:
        with self.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
            row = cur.execute("SELECT max(version) FROM schema_version").fetchone()
            current = row[0] or 0
            for version, sql in enumerate(MIGRATIONS[current:], start=current + 1):
                cur.execute("BEGIN")
                cur.execute(sql)
                cur.execute("INSERT INTO schema_version VALUES (?)", [version])
                cur.execute("COMMIT")
            return len(MIGRATIONS)

    def close(self) -> None:
        self._con.close()
