"""Open-Meteo Previous Runs ingestion: URL building, fetching, and loading into raw.previous_runs.

The fetch step is a plain function `Fetcher = Callable[[str], str]` (URL in, response text out),
so tests and offline replays pass a fixture fetcher while Dagster uses `http_fetch`.

The pipeline only ingests going forward: every run fetches the last few days and upserts them,
so the evaluated window grows as daily runs accumulate.
"""

from __future__ import annotations

import csv
import json
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import duckdb
import requests

API_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
LEAD_DAYS = (1, 2, 3, 4, 5)
DEFAULT_DAYS = 5  # Previous Runs data only reaches back a few days per daily run
# Actuals are the analysis-hour weather_code / precipitation; forecasts are `*_previous_dayN`.
HOURLY_VARS: tuple[str, ...] = ("weather_code", "precipitation", "is_day") + tuple(
    f"{name}_previous_day{n}"
    for n in LEAD_DAYS
    for name in (
        "weather_code",
        "precipitation_probability",
        "temperature_2m",
        "wind_speed_10m",
        "wind_gusts_10m",
    )
)
UNITS = "temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime"
RAW_DDL = """
create schema if not exists raw;
create table if not exists raw.previous_runs (
    lat double,
    lng double,
    start_date date,
    end_date date,
    fetched_at timestamp,
    request_url varchar,
    response varchar,
    primary key (lat, lng, start_date, end_date)
)
"""

Fetcher = Callable[[str], str]
Point = tuple[float, float]


@dataclass(frozen=True)
class RawRow:
    lat: float
    lng: float
    start_date: date
    end_date: date
    fetched_at: datetime
    request_url: str
    response: str


def load_points(seeds_dir: Path) -> list[Point]:
    """Distinct (lat, lng) of every corridor point, in file order."""
    seen: dict[Point, None] = {}
    with (seeds_dir / "corridor_points.csv").open() as f:
        for row in csv.DictReader(f):
            seen.setdefault((float(row["lat"]), float(row["lng"])), None)
    return list(seen)


def chunked[T](items: list[T], size: int) -> Iterator[list[T]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def default_window(days: int = DEFAULT_DAYS, today: date | None = None) -> tuple[date, date]:
    """The last `days` complete UTC days (today's actuals are not final yet)."""
    end = (today or datetime.now(UTC).date()) - timedelta(days=1)
    return end - timedelta(days=days - 1), end


def build_url(points: list[Point], start: date, end: date) -> str:
    lats = ",".join(f"{lat:g}" for lat, _ in points)
    lngs = ",".join(f"{lng:g}" for _, lng in points)
    return (
        f"{API_URL}?latitude={lats}&longitude={lngs}&hourly={','.join(HOURLY_VARS)}"
        f"&start_date={start.isoformat()}&end_date={end.isoformat()}&{UNITS}"
    )


def http_fetch(url: str, retries: int = 5, backoff: float = 2.0, pause: float = 1.0) -> str:
    """GET with exponential backoff on 429/5xx, then pause ~1 s to stay polite."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=120)
            if resp.status_code == 429 or resp.status_code >= 500:
                raise requests.HTTPError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            resp.raise_for_status()
            time.sleep(pause)
            return resp.text
        except (requests.RequestException, OSError) as err:
            last = err
            time.sleep(backoff * (2**attempt))
    raise RuntimeError(f"Open-Meteo request failed after {retries} attempts: {last}")


def split_response(text: str) -> list[dict]:
    """One location comes back as an object, several as an array in request order."""
    data = json.loads(text)
    return data if isinstance(data, list) else [data]


def rows_for_batch(
    points: list[Point],
    start: date,
    end: date,
    fetch: Fetcher,
    fetched_at: datetime | None = None,
) -> list[RawRow]:
    url = build_url(points, start, end)
    locations = split_response(fetch(url))
    if len(locations) != len(points):
        raise ValueError(f"expected {len(points)} locations, got {len(locations)}")
    now = fetched_at or datetime.now(UTC).replace(tzinfo=None, microsecond=0)
    return [
        RawRow(lat, lng, start, end, now, url, json.dumps(loc, separators=(",", ":")))
        for (lat, lng), loc in zip(points, locations, strict=True)
    ]


def ensure_table(con: duckdb.DuckDBPyConnection) -> None:
    for stmt in RAW_DDL.split(";"):
        if stmt.strip():
            con.execute(stmt)


def upsert(con: duckdb.DuckDBPyConnection, rows: Iterable[RawRow]) -> int:
    ensure_table(con)
    data = [
        (r.lat, r.lng, r.start_date, r.end_date, r.fetched_at, r.request_url, r.response)
        for r in rows
    ]
    if data:
        con.executemany(
            "insert or replace into raw.previous_runs values (?, ?, ?, ?, ?, ?, ?)", data
        )
    return len(data)


def ingest(
    con: duckdb.DuckDBPyConnection,
    points: list[Point],
    start: date,
    end: date,
    fetch: Fetcher = http_fetch,
    batch_size: int = 10,
) -> int:
    """Fetch every point for [start, end] in batched requests and upsert the raw responses."""
    total = 0
    for batch in chunked(points, batch_size):
        total += upsert(con, rows_for_batch(batch, start, end, fetch))
    return total
