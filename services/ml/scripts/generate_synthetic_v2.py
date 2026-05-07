"""
generate_synthetic_v2.py — D4 driver for the catalog-driven synthetic
occupancy generator (`services/ml/src/data/synthetic_v2.py`).

Per-term, on-demand: this script is **not** wired into cron. Synthetic
data only needs regeneration when (a) a new academic term's catalog has
been ingested (D2), (b) the proximity matrix has been rebuilt (D3), or
(c) the generator constants have been retuned. Tying it to a schedule
would burn DB writes for no benefit.

Operator usage
--------------
    # Manual local run (one term).
    python -m scripts.generate_synthetic_v2 \
        --school CSULB --term Spring_2026 \
        --start 2026-01-20 --end 2026-05-15 \
        --truncate-existing

    # Dry run (compute everything, print summary, write nothing).
    python -m scripts.generate_synthetic_v2 \
        --school CSULB --term Spring_2026 \
        --start 2026-01-20 --end 2026-05-15 --dry-run

GitHub Actions trigger
----------------------
The companion workflow at `.github/workflows/generate-synthetic-v2.yml`
exposes this as a manual `workflow_dispatch` with the same inputs, so
operators can regenerate from the GitHub UI without local DB access.

Output
------
Inserts into `synthetic_observations` with `generator_version='v2'`.
Coexists with prior `v1` rows (different `generator_version`) and with
real `occupancy_snapshots` (separate table). When `--truncate-existing`
is set, only `(school, term, version=v2)` rows are dropped first.

Emits one `ML_RESULT: {…}` line on stdout for `_ml-runner.ts` to capture
into `ml_cron_runs.metadata` if invoked from the backend; debug logs go
to stderr.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import date, datetime
from typing import Optional

from src.data.db import get_connection
from src.data.synthetic_v2 import (
    GENERATOR_VERSION,
    SyntheticV2Generator,
    bulk_insert,
    truncate_existing,
)

logger = logging.getLogger(__name__)


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _normalize_term(term: str) -> str:
    """Accept tags like Spring_2026 and normalize to catalog term values."""
    raw = term.strip()
    m = re.fullmatch(r"(?i)(spring|summer|fall|winter)[_-]\d{4}", raw)
    if m:
        return m.group(1).title()
    return raw


def _resolve_school_id(conn, short_name: str) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM schools WHERE short_name = %s", (short_name,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"School short_name={short_name!r} not found.")
        return row[0]


def run(
    *,
    school_short_name: str,
    term: str,
    start: date,
    end: date,
    seed: int,
    truncate: bool,
    dry_run: bool,
) -> dict:
    resolved_term = _normalize_term(term)
    with get_connection() as conn:
        school_id = _resolve_school_id(conn, school_short_name)
        gen = SyntheticV2Generator(
            conn=conn, school_id=school_id, term=resolved_term, seed=seed
        )
        gen.load()

        if not gen.lots:
            raise SystemExit(f"No lots found for school {school_short_name!r}.")
        if not gen.meetings:
            raise SystemExit(
                f"No course meetings found for school={school_short_name!r} "
                f"term={resolved_term!r}. Run ingest_csulb_catalog first."
            )

        deleted = 0
        if truncate and not dry_run:
            deleted = truncate_existing(conn, school_id=school_id, term=resolved_term)
            logger.info("Deleted %d prior %s rows", deleted, GENERATOR_VERSION)

        rows = list(gen.generate(start, end))
        logger.info("Generated %d synthetic observations", len(rows))

        inserted = 0
        if not dry_run:
            inserted = bulk_insert(conn, rows)
            conn.commit()

        # Quick sanity stats for the metadata payload.
        if rows:
            sample_occ = [r["occupancy"] for r in rows]
            mean_occ = sum(sample_occ) / len(sample_occ)
            max_occ = max(sample_occ)
            mean_rate = sum(r["occupancy_rate"] for r in rows) / len(rows)
        else:
            mean_occ = max_occ = mean_rate = 0.0

        return {
            "task": "generate_synthetic_v2",
            "school": school_short_name,
            "term": resolved_term,
            "term_input": term,
            "generator_version": GENERATOR_VERSION,
            "date_range": [start.isoformat(), end.isoformat()],
            "lots": len(gen.lots),
            "meetings": len(gen.meetings),
            "events": len(gen.events),
            "rows_generated": len(rows),
            "rows_inserted": inserted,
            "rows_deleted": deleted,
            "dry_run": dry_run,
            "stats": {
                "mean_occupancy": round(mean_occ, 2),
                "max_occupancy": int(max_occ),
                "mean_occupancy_rate": round(mean_rate, 4),
            },
        }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--school", required=True, help="School short_name (e.g. CSULB).")
    parser.add_argument(
        "--term",
        required=True,
        help="Term tag (Spring or Spring_2026; normalized to catalog term values).",
    )
    parser.add_argument("--start", required=True, type=_parse_date, help="YYYY-MM-DD.")
    parser.add_argument("--end", required=True, type=_parse_date, help="YYYY-MM-DD.")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed.")
    parser.add_argument(
        "--truncate-existing",
        action="store_true",
        help="DELETE prior (school, term, v2) rows before insert.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute everything; write nothing to the DB.",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    metadata = run(
        school_short_name=args.school,
        term=args.term,
        start=args.start,
        end=args.end,
        seed=args.seed,
        truncate=args.truncate_existing,
        dry_run=args.dry_run,
    )
    print("ML_RESULT: " + json.dumps(metadata))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
