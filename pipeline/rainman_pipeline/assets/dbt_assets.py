"""dbt project as Dagster assets (seeds, models and dbt tests as asset checks)."""

from dagster import AssetExecutionContext
from dagster_dbt import DbtCliResource, DbtProject, dbt_assets

from ..resources import DBT_DIR, current_target

dbt_project = DbtProject(project_dir=DBT_DIR, profiles_dir=DBT_DIR, target=current_target())
# Writes target/manifest.json (dbt parse) when it is missing, e.g. on a fresh checkout or in CI.
if not dbt_project.manifest_path.exists():
    dbt_project.preparer.prepare(dbt_project)

dbt_resource = DbtCliResource(
    project_dir=dbt_project, profiles_dir=str(DBT_DIR), target=current_target()
)


@dbt_assets(manifest=dbt_project.manifest_path, project=dbt_project)
def rainman_dbt_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()
