"""Builds accuracy.json (the contract with the site's Accuracy page) from the dbt marts."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb

METHODOLOGY_URL = (
    "https://github.com/prajeshgpat/RainMan-RouteWeatherApp/blob/main/pipeline/README.md"
)
HEADLINE_LEAD_DAY = 1


def _rows(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    cur = con.execute(sql)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, row, strict=True)) for row in cur.fetchall()]


def _num(x: float | None) -> float | None:
    return None if x is None else float(x)


def build_accuracy(con: duckdb.DuckDBPyConnection, now: datetime | None = None) -> dict:
    summary = _rows(con, "select * from marts.mart_accuracy_summary")
    lead = _rows(con, "select * from marts.mart_accuracy_by_lead_day order by lead_day")
    corridors = _rows(con, "select * from marts.mart_accuracy_by_corridor order by corridor_id")
    if not summary or summary[0]["window_start"] is None or not lead:
        raise ValueError("marts hold no evaluated departures yet; nothing to export")
    s = summary[0]
    head = next((r for r in lead if r["lead_day"] == HEADLINE_LEAD_DAY), lead[0])
    stamp = (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "generated_at": stamp,
        "window": {"start": s["window_start"].isoformat(), "end": s["window_end"].isoformat()},
        "corridors": int(s["corridors"]),
        "points": int(s["points"]),
        "departures_evaluated": int(s["departures_evaluated"]),
        "headline": {
            "lead_day": int(head["lead_day"]),
            "green_trip_dry_rate": _num(head["green_trip_dry_rate"]),
            "n_green_trips": int(head["n_green_trips"]),
        },
        "by_lead_day": [
            {
                "lead_day": int(r["lead_day"]),
                "green_trip_dry_rate": _num(r["green_trip_dry_rate"]),
                "okay_trip_dry_rate": _num(r["okay_trip_dry_rate"]),
                "bad_trip_wet_rate": _num(r["bad_trip_wet_rate"]),
                "brier_pop": _num(r["brier_pop"]),
                "rain_pod": _num(r["rain_pod"]),
                "rain_far": _num(r["rain_far"]),
                "n_trips": int(r["n_trips"]),
                "n_point_hours": int(r["n_point_hours"]),
            }
            for r in lead
        ],
        "by_corridor": [
            {
                "corridor_id": r["corridor_id"],
                "name": r["name"],
                "green_trip_dry_rate_day1": _num(r["green_trip_dry_rate_day1"]),
                "brier_pop_day1": _num(r["brier_pop_day1"]),
                "n_trips_day1": int(r["n_trips_day1"]),
            }
            for r in corridors
        ],
        "methodology_url": METHODOLOGY_URL,
    }


def write_accuracy(con: duckdb.DuckDBPyConnection, path: Path, now: datetime | None = None) -> dict:
    data = build_accuracy(con, now)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return data
