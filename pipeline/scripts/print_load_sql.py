"""Print server-side load statements for raw.previous_runs (used to backfill MotherDuck via SQL).

Usage (from pipeline/):
    python scripts/print_load_sql.py START END [BATCH_SIZE] [URLS_PER_STATEMENT]
Statements are separated by a line containing only `-- next`.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from rainman_pipeline.ingest import chunked, load_points, load_sql, windows

SEEDS = Path(__file__).resolve().parent.parent / "dbt" / "seeds"

if __name__ == "__main__":
    start, end = date.fromisoformat(sys.argv[1]), date.fromisoformat(sys.argv[2])
    batch = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    per_stmt = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    points = load_points(SEEDS)
    reqs = [(pts, ws, we) for ws, we in windows(start, end) for pts in chunked(points, batch)]
    for group in chunked(reqs, per_stmt):
        print(load_sql(group) + ";")
        print("-- next")
