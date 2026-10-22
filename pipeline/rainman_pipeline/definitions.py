"""Dagster entry point: `dagster dev -m rainman_pipeline.definitions`."""

from dagster import AssetSelection, Definitions, ScheduleDefinition, define_asset_job

from .assets.accuracy import accuracy_json, accuracy_json_has_rows
from .assets.dbt_assets import dbt_resource, rainman_dbt_assets
from .assets.ingestion import raw_has_rows, raw_is_fresh, raw_previous_runs
from .resources import WarehouseResource, current_target

daily_accuracy_job = define_asset_job("daily_accuracy", selection=AssetSelection.all())

daily_schedule = ScheduleDefinition(
    name="daily_accuracy_schedule",
    job=daily_accuracy_job,
    cron_schedule="0 6 * * *",
    execution_timezone="UTC",
)

defs = Definitions(
    assets=[raw_previous_runs, rainman_dbt_assets, accuracy_json],
    asset_checks=[raw_has_rows, raw_is_fresh, accuracy_json_has_rows],
    schedules=[daily_schedule],
    jobs=[daily_accuracy_job],
    resources={
        "dbt": dbt_resource,
        "warehouse": WarehouseResource(target=current_target()),
    },
)
