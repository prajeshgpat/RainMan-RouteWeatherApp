import json
import os
import subprocess
import sys
from pathlib import Path

import duckdb
import pytest

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PIPELINE_DIR.parent
DBT_DIR = PIPELINE_DIR / "dbt"
SCHEMA = json.loads((PIPELINE_DIR / "schema" / "accuracy.schema.json").read_text())


@pytest.fixture(scope="session")
def built_db(tmp_path_factory) -> Path:
    """Synthetic fixtures -> raw.previous_runs -> `dbt build --target dev` in a temp DuckDB."""
    from rainman_pipeline.fixtures import load_fixtures

    tmp = tmp_path_factory.mktemp("warehouse")
    db = tmp / "rainman.duckdb"
    con = duckdb.connect(str(db))
    load_fixtures(con)
    con.close()
    env = {**os.environ, "RAINMAN_DEV_DB": str(db)}
    dbt = Path(sys.executable).parent / "dbt"
    result = subprocess.run(
        [str(dbt), "build", "--target", "dev", "--profiles-dir", str(DBT_DIR),
         "--project-dir", str(DBT_DIR), "--target-path", str(tmp / "target"),
         "--log-path", str(tmp / "logs")],
        env=env, capture_output=True, text=True, cwd=DBT_DIR,
    )  # fmt: skip
    assert result.returncode == 0, result.stdout[-3000:] + result.stderr[-2000:]
    return db
