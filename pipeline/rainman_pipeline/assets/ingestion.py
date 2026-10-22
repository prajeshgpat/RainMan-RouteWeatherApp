"""Ingestion asset: last few days of Open-Meteo Previous Runs for every corridor point."""

from datetime import UTC, datetime, timedelta

from dagster import (
    AssetCheckResult,
    AssetCheckSeverity,
    AssetExecutionContext,
    Config,
    MaterializeResult,
    asset,
    asset_check,
)

from ..ingest import DEFAULT_DAYS, default_window, ingest, load_points
from ..resources import DBT_DIR, WarehouseResource

RAW_KEY = ["raw", "previous_runs"]  # the key dagster-dbt gives the dbt source raw.previous_runs


class IngestConfig(Config):
    days: int = DEFAULT_DAYS  # how many complete UTC days back to fetch (forward-only; no backfill)


@asset(
    key=RAW_KEY,
    group_name="ingestion",
    description="Raw Open-Meteo Previous Runs responses, upserted per (lat, lng, date window).",
)
def raw_previous_runs(
    context: AssetExecutionContext, config: IngestConfig, warehouse: WarehouseResource
) -> MaterializeResult:
    start, end = default_window(config.days)
    points = load_points(DBT_DIR / "seeds")
    context.log.info(f"fetching {len(points)} points for {start}..{end}")
    con = warehouse.connect()
    try:
        written = ingest(con, points, start, end)
        total = con.execute("select count(*) from raw.previous_runs").fetchone()[0]
    finally:
        con.close()
    return MaterializeResult(
        metadata={
            "rows_written": written,
            "rows_total": total,
            "start_date": str(start),
            "end_date": str(end),
        }
    )


@asset_check(asset=RAW_KEY, description="raw.previous_runs has rows for every corridor point")
def raw_has_rows(warehouse: WarehouseResource) -> AssetCheckResult:
    con = warehouse.connect()
    try:
        rows, points = con.execute(
            "select count(*), count(distinct (lat, lng)) from raw.previous_runs"
        ).fetchone()
    finally:
        con.close()
    expected = len(load_points(DBT_DIR / "seeds"))
    return AssetCheckResult(
        passed=points >= expected,
        metadata={"rows": rows, "points": points, "expected_points": expected},
    )


@asset_check(
    asset=RAW_KEY,
    description="newest fetched window ends within 3 days (warn only)",
    blocking=False,
)
def raw_is_fresh(warehouse: WarehouseResource) -> AssetCheckResult:
    con = warehouse.connect()
    try:
        latest = con.execute("select max(end_date) from raw.previous_runs").fetchone()[0]
    finally:
        con.close()
    cutoff = (datetime.now(UTC) - timedelta(days=3)).date()
    return AssetCheckResult(
        passed=latest is not None and latest >= cutoff,
        severity=AssetCheckSeverity.WARN,
        metadata={"latest_end_date": str(latest), "cutoff": str(cutoff)},
    )
