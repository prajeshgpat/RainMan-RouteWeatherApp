"""Offline replay of synthetic Open-Meteo responses (tests and the PR CI job).

    python -m rainman_pipeline.fixtures [DB_PATH]

loads tests/fixtures/synthetic_previous_runs.json into raw.previous_runs of a local DuckDB file
(default pipeline/.data/rainman.duckdb) so `dbt build --target dev` can run without network access.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import duckdb

from .ingest import Fetcher, ingest, load_points

PIPELINE_DIR = Path(__file__).resolve().parent.parent
SEEDS_DIR = PIPELINE_DIR / "dbt" / "seeds"
FIXTURE_FILE = PIPELINE_DIR / "tests" / "fixtures" / "synthetic_previous_runs.json"
FIXTURE_START, FIXTURE_END = date(2026, 10, 1), date(2026, 10, 3)


def fixture_fetcher(path: Path = FIXTURE_FILE) -> Fetcher:
    """A Fetcher answering Previous Runs URLs from a fixture file, matching by coordinates."""
    locations = {(loc["latitude"], loc["longitude"]): loc for loc in json.loads(path.read_text())}

    def fetch(url: str) -> str:
        query = parse_qs(urlparse(url).query)
        lats = [float(x) for x in query["latitude"][0].split(",")]
        lngs = [float(x) for x in query["longitude"][0].split(",")]
        found = [locations[(a, b)] for a, b in zip(lats, lngs, strict=True) if (a, b) in locations]
        return json.dumps(found[0] if len(found) == 1 else found)

    return fetch


def load_fixtures(con: duckdb.DuckDBPyConnection) -> int:
    """Ingest the fixture locations through the normal ingestion path; returns rows written."""
    locs = {(loc["latitude"], loc["longitude"]) for loc in json.loads(FIXTURE_FILE.read_text())}
    points = [p for p in load_points(SEEDS_DIR) if p in locs]
    return ingest(con, points, FIXTURE_START, FIXTURE_END, fixture_fetcher())


if __name__ == "__main__":
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else PIPELINE_DIR / ".data" / "rainman.duckdb"
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(str(db))
    print(f"loaded {load_fixtures(conn)} synthetic rows into {db}")
    conn.close()
