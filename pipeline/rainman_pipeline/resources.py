"""Warehouse location: a local DuckDB file (dev) or the MotherDuck database `rainman` (prod).

The target comes from RAINMAN_TARGET (default `dev`). MotherDuck authenticates through the
MOTHERDUCK_TOKEN environment variable; nothing secret lives in the repo.
"""

from __future__ import annotations

import os
from pathlib import Path

import duckdb
from dagster import ConfigurableResource

PIPELINE_DIR = Path(__file__).resolve().parent.parent
DBT_DIR = PIPELINE_DIR / "dbt"
OUTPUT_DIR = PIPELINE_DIR / "output"
DEV_DB = PIPELINE_DIR / ".data" / "rainman.duckdb"
PROD_DATABASE = "rainman"

# dbt's profile resolves this relative to its own cwd; pin it so ingestion and dbt agree.
os.environ.setdefault("RAINMAN_DEV_DB", str(DEV_DB))
# The motherduck extension reads the lower-case name.
if "MOTHERDUCK_TOKEN" in os.environ:
    os.environ.setdefault("motherduck_token", os.environ["MOTHERDUCK_TOKEN"])


def current_target() -> str:
    target = os.environ.get("RAINMAN_TARGET", "dev")
    if target not in ("dev", "prod"):
        raise ValueError(f"RAINMAN_TARGET must be 'dev' or 'prod', got {target!r}")
    return target


def connect(target: str, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    if target == "prod":
        if not (os.environ.get("MOTHERDUCK_TOKEN") or os.environ.get("motherduck_token")):
            raise RuntimeError("MOTHERDUCK_TOKEN is not set; cannot connect to MotherDuck")
        admin = duckdb.connect("md:")
        admin.execute(f"create database if not exists {PROD_DATABASE}")
        admin.close()
        return duckdb.connect(f"md:{PROD_DATABASE}")
    path = Path(os.environ["RAINMAN_DEV_DB"])
    path.parent.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(str(path), read_only=read_only and path.exists())


class WarehouseResource(ConfigurableResource):
    """Short-lived connections, so ingestion, dbt and the export never hold the file together."""

    target: str = "dev"

    def connect(self) -> duckdb.DuckDBPyConnection:
        return connect(self.target)
