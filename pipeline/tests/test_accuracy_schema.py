import copy
import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import jsonschema
import pytest

from rainman_pipeline.export import build_accuracy, write_accuracy
from tests.conftest import SCHEMA  # noqa: I001


@pytest.fixture(scope="module")
def doc(built_db: Path) -> dict:
    con = duckdb.connect(str(built_db), read_only=True)
    return build_accuracy(con, datetime(2026, 10, 4, 6, 0, 0, tzinfo=UTC))


def validate(data: dict) -> None:
    jsonschema.Draft202012Validator(SCHEMA, format_checker=jsonschema.FormatChecker()).validate(
        data
    )


def test_exported_accuracy_json_matches_schema(doc):
    validate(doc)
    assert doc["generated_at"] == "2026-10-04T06:00:00Z"
    assert doc["window"] == {"start": "2026-10-01", "end": "2026-10-03"}
    assert doc["corridors"] == 2 and doc["points"] == 13
    assert [r["lead_day"] for r in doc["by_lead_day"]] == [1, 2, 3, 4, 5]
    assert {r["corridor_id"] for r in doc["by_corridor"]} == {"den_vail_i70", "sea_pdx_i5"}
    assert doc["headline"]["lead_day"] == 1
    assert doc["headline"]["green_trip_dry_rate"] == doc["by_lead_day"][0]["green_trip_dry_rate"]


def test_synthetic_numbers_are_sane(doc):
    day1 = doc["by_lead_day"][0]
    assert day1["brier_pop"] < 0.25
    assert day1["n_trips"] == sum(c["n_trips_day1"] for c in doc["by_corridor"])
    # Noisier forecasts at longer lead should not beat day 1 on the probability score.
    assert doc["by_lead_day"][-1]["brier_pop"] > day1["brier_pop"]


def test_write_accuracy_roundtrips(built_db: Path, tmp_path: Path):
    con = duckdb.connect(str(built_db), read_only=True)
    out = tmp_path / "out" / "accuracy.json"
    written = write_accuracy(con, out)
    assert json.loads(out.read_text()) == written
    validate(json.loads(out.read_text()))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.pop("headline"),
        lambda d: d["headline"].update(green_trip_dry_rate=1.5),
        lambda d: d["by_lead_day"].clear(),
        lambda d: d["by_lead_day"][0].update(n_trips=-1),
        lambda d: d["window"].update(start="Oct 1"),
        lambda d: d.update(extra=1),
    ],
)
def test_schema_rejects_bad_documents(doc, mutate):
    bad = copy.deepcopy(doc)
    mutate(bad)
    with pytest.raises(jsonschema.ValidationError):
        validate(bad)


def test_null_rates_are_allowed(doc):
    ok = copy.deepcopy(doc)
    ok["by_lead_day"][0]["green_trip_dry_rate"] = None
    validate(ok)


def test_build_raises_when_marts_are_empty(tmp_path: Path):
    con = duckdb.connect()
    for schema in ("marts",):
        con.execute(f"create schema {schema}")
    con.execute("create table marts.mart_accuracy_by_lead_day (lead_day int)")
    con.execute("create table marts.mart_accuracy_by_corridor (corridor_id varchar)")
    con.execute("create table marts.mart_accuracy_summary (window_start date)")
    with pytest.raises(ValueError, match="nothing to export"):
        build_accuracy(con)
