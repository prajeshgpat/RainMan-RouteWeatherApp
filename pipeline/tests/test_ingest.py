import json
from datetime import date, datetime
from pathlib import Path

import duckdb
import pytest
import requests

from rainman_pipeline import ingest
from rainman_pipeline.fixtures import FIXTURE_FILE, SEEDS_DIR, fixture_fetcher, load_fixtures

START, END = date(2026, 10, 1), date(2026, 10, 3)
FETCHED = datetime(2026, 10, 4, 6, 0, 0)


@pytest.fixture
def locations() -> list[dict]:
    return json.loads(FIXTURE_FILE.read_text())


def test_fixture_is_labelled_synthetic_and_has_documented_shape(locations):
    assert len(locations) == 13
    for loc in locations:
        assert loc["_synthetic"].startswith("NOT REAL DATA")
        hourly = loc["hourly"]
        n = len(hourly["time"])
        assert n == 72
        assert hourly["time"][1] - hourly["time"][0] == 3600  # unix seconds
        assert set(hourly) == {"time", *ingest.HOURLY_VARS}
        assert all(len(v) == n for v in hourly.values())


def test_fixture_mixes_dry_and_wet_hours(locations):
    precip = [p for loc in locations for p in loc["hourly"]["precipitation"]]
    wet = sum(p >= 0.1 for p in precip)
    assert 0.1 * len(precip) < wet < 0.7 * len(precip)


def test_build_url_batches_points_and_lists_every_variable():
    url = ingest.build_url([(37.77, -122.42), (34.05, -118.24)], START, END)
    assert url.startswith(ingest.API_URL + "?latitude=37.77,34.05&longitude=-122.42,-118.24")
    assert "start_date=2026-10-01&end_date=2026-10-03" in url
    assert "temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime" in url
    for n in ingest.LEAD_DAYS:
        assert f"precipitation_probability_previous_day{n}" in url
    assert "weather_code" in url and "precipitation," in url and "is_day" in url


def test_split_response_accepts_object_or_array(locations):
    assert len(ingest.split_response(json.dumps(locations[0]))) == 1
    assert len(ingest.split_response(json.dumps(locations[:3]))) == 3


def test_rows_for_batch_keeps_request_order_and_raw_json(locations):
    points = [(loc["latitude"], loc["longitude"]) for loc in locations[:3]]
    rows = ingest.rows_for_batch(points, START, END, fixture_fetcher(), FETCHED)
    assert [(r.lat, r.lng) for r in rows] == points
    assert all(r.fetched_at == FETCHED and r.request_url.startswith(ingest.API_URL) for r in rows)
    assert json.loads(rows[1].response)["hourly"]["time"] == locations[1]["hourly"]["time"]


def test_rows_for_batch_rejects_wrong_location_count(locations):
    with pytest.raises(ValueError, match="expected 2 locations, got 1"):
        ingest.rows_for_batch(
            [(1.0, 2.0), (3.0, 4.0)], START, END, lambda _: json.dumps(locations[0])
        )


def test_load_points_dedupes_and_default_window_is_complete_days():
    points = ingest.load_points(SEEDS_DIR)
    assert len(points) == len(set(points)) > 100
    assert ingest.default_window(5, today=date(2026, 10, 22)) == (
        date(2026, 10, 17),
        date(2026, 10, 21),
    )


def test_chunked():
    assert list(ingest.chunked([1, 2, 3, 4, 5], 2)) == [[1, 2], [3, 4], [5]]


def test_ingest_is_idempotent_upsert():
    con = duckdb.connect()
    assert load_fixtures(con) == 13
    assert load_fixtures(con) == 13
    assert con.execute("select count(*) from raw.previous_runs").fetchone()[0] == 13


def test_http_fetch_retries_then_succeeds(monkeypatch):
    calls = []

    class Resp:
        def __init__(self, status):
            self.status_code, self.text = status, "{}"

        def raise_for_status(self):
            if self.status_code >= 400:
                raise requests.HTTPError("bad")

    def fake_get(url, timeout):
        calls.append(url)
        return Resp(429 if len(calls) < 3 else 200)

    monkeypatch.setattr(ingest.requests, "get", fake_get)
    monkeypatch.setattr(ingest.time, "sleep", lambda _: None)
    assert ingest.http_fetch("https://example.test") == "{}"
    assert len(calls) == 3


def test_http_fetch_gives_up(monkeypatch):
    monkeypatch.setattr(
        ingest.requests, "get", lambda *a, **k: (_ for _ in ()).throw(requests.ConnectionError())
    )
    monkeypatch.setattr(ingest.time, "sleep", lambda _: None)
    with pytest.raises(RuntimeError, match="after 2 attempts"):
        ingest.http_fetch("https://example.test", retries=2)


def test_staging_unnests_one_row_per_point_hour_lead(built_db: Path):
    con = duckdb.connect(str(built_db), read_only=True)
    n, leads, hours = con.execute(
        "select count(*), count(distinct lead_day), count(distinct valid_hour)"
        " from staging.stg_point_hours"
    ).fetchone()
    assert (n, leads, hours) == (13 * 72 * 5, 5, 72)
