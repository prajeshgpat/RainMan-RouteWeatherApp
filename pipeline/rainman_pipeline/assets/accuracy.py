"""accuracy_json: export the marts to pipeline/output/accuracy.json for the site."""

import json

from dagster import (
    AssetCheckResult,
    AssetExecutionContext,
    AssetKey,
    MaterializeResult,
    MetadataValue,
    asset,
    asset_check,
)

from ..export import write_accuracy
from ..resources import OUTPUT_DIR, WarehouseResource

ACCURACY_PATH = OUTPUT_DIR / "accuracy.json"
MART_KEYS = [
    AssetKey(["marts", "mart_accuracy_by_lead_day"]),
    AssetKey(["marts", "mart_accuracy_by_corridor"]),
    AssetKey(["marts", "mart_accuracy_summary"]),
]


@asset(
    key="accuracy_json",
    deps=MART_KEYS,
    group_name="export",
    description="Accuracy numbers as JSON for the site's Accuracy page.",
)
def accuracy_json(context: AssetExecutionContext, warehouse: WarehouseResource):
    con = warehouse.connect()
    try:
        data = write_accuracy(con, ACCURACY_PATH)
    finally:
        con.close()
    context.log.info(f"wrote {ACCURACY_PATH}")
    return MaterializeResult(
        metadata={
            "path": MetadataValue.path(str(ACCURACY_PATH)),
            "departures_evaluated": data["departures_evaluated"],
            "window": MetadataValue.json(data["window"]),
            "headline": MetadataValue.json(data["headline"]),
        }
    )


@asset_check(asset="accuracy_json", description="accuracy.json exists and has lead-day rows")
def accuracy_json_has_rows() -> AssetCheckResult:
    if not ACCURACY_PATH.exists():
        return AssetCheckResult(passed=False, metadata={"reason": "file missing"})
    data = json.loads(ACCURACY_PATH.read_text())
    return AssetCheckResult(
        passed=bool(data["by_lead_day"]) and data["departures_evaluated"] > 0,
        metadata={"lead_days": len(data["by_lead_day"]), "n": data["departures_evaluated"]},
    )
