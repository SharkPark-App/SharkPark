"""
C2: Daily recompute of per-lot/dow_bucket/hour_bucket EWMA penetration rates.

For each consensus_observation written yesterday (school-local) where
`is_ground_truth = true`, we treat
    sample_penetration = clip(contributor_count / observed_occupancy, 0.005, 1.0)
as one observation of the app's penetration rate at that school-local
day-of-week and hour, for that lot.

Aggregation strategy
--------------------
Within a single (lot_id, dow_bucket, hour_bucket) we may have up to 12
ground-truth windows in a day (one per 5-min bucket inside the hour).
We collapse those into a single per-day observation = mean of per-row
samples, then apply ONE EWMA update per day per bucket. Doing it that
way keeps `alpha = 0.1` interpretable (~10-day half-life of "today's
single observation"), which is what we want for a slowly-drifting
behavioral parameter.

Variance
--------
We track an EWMA-residual variance:
    variance_new = (1-alpha) * variance_old + alpha * (sample - ewma_old)^2
This matches the EWMA's response curve (so the variance moves with the
mean) and is numerically stable for any n. The schema column is named
`ewma_variance` for that reason. `sample_count` is incremented per
applied update so the C3 backend gate (`sample_count >= 30`) works.

Output marker
-------------
Prints a final `ML_RESULT: {...}` line so apps/backend's CronRunnerService
captures rollup metadata into `ml_cron_runs.metadata` (visible at
/admin/ml-status). Format mirrors predict_short_term.py.

Idempotency
-----------
The recompute reads `is_ground_truth = true` rows STRICTLY FROM
yesterday's local-day window so re-running on the same calendar day
applies the same updates again — that's not idempotent. The cron is
scheduled at 02:30 PT and only runs once daily; if an operator re-runs
manually they should pass `--date YYYY-MM-DD` for the explicit local
date they want to (re-)process, and accept that the EWMA will get a
double dose. We do NOT try to make this UPSERT-idempotent because
EWMA history is a property of the update sequence, not the inputs.
"""

import argparse
import json
import logging
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import execute_values

from src.data.db import get_connection

logger = logging.getLogger(__name__)

# Spec-mandated alpha — 10-day-ish half-life. Do NOT tune without coordinating
# with the C3 backend gate (sample_count >= 30 / 14d freshness window).
EWMA_ALPHA = 0.1
SAMPLE_MIN = 0.005
SAMPLE_MAX = 1.0


# Map ISO weekday (Mon=1..Sun=7) → 3-bucket traffic profile used in the schema.
# Holidays would shift here but are NOT remapped in v1; the spec mentions
# "academic holidays mapped" as future work and we keep the mapping pure-DOW
# until the academic-calendar Python port lands.
def dow_to_bucket(iso_weekday: int) -> int:
    if iso_weekday == 6:
        return 1  # Saturday-like
    if iso_weekday == 7:
        return 2  # Sunday-like / closure
    return 0  # Mon–Fri


@dataclass(frozen=True)
class BucketKey:
    lot_id: str
    dow_bucket: int
    hour_bucket: int


@dataclass
class ExistingState:
    ewma_value: float
    ewma_variance: float
    sample_count: int


def _resolve_yesterday_window(school_tz: str, override_date: str | None) -> tuple[datetime, datetime, str]:
    """Return (utc_start, utc_end, yyyy_mm_dd_local) for the local calendar day to process."""
    tz = ZoneInfo(school_tz)
    if override_date:
        local_day = datetime.strptime(override_date, "%Y-%m-%d").replace(tzinfo=tz)
    else:
        now_local = datetime.now(tz)
        local_day = (now_local - timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    local_start = local_day
    local_end = local_day + timedelta(days=1)
    return (
        local_start.astimezone(timezone.utc),
        local_end.astimezone(timezone.utc),
        local_day.strftime("%Y-%m-%d"),
    )


def _fetch_school_timezone(conn) -> str:
    """Return the timezone string of the (single) school. Falls back to LA."""
    with conn.cursor() as cur:
        cur.execute("SELECT timezone FROM schools ORDER BY created_at ASC LIMIT 1")
        row = cur.fetchone()
    return row[0] if row and row[0] else "America/Los_Angeles"


def _fetch_ground_truth_rows(
    conn, utc_start: datetime, utc_end: datetime
) -> list[tuple[str, datetime, int, int]]:
    """
    Pull yesterday's ground-truth consensus rows. Returns
    [(lot_id, window_start_utc, contributor_count, observed_occupancy), ...].
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT lot_id, window_start, contributor_count, observed_occupancy
            FROM consensus_observations
            WHERE is_ground_truth = TRUE
              AND window_start >= %s
              AND window_start <  %s
              AND observed_occupancy > 0
            """,
            (utc_start, utc_end),
        )
        return cur.fetchall()


def _fetch_existing_estimates(
    conn, keys: Iterable[BucketKey]
) -> dict[BucketKey, ExistingState]:
    """Bulk-fetch existing rows for the bucket keys we're about to update."""
    keys_list = list(keys)
    if not keys_list:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT lot_id, dow_bucket, hour_bucket, ewma_value, ewma_variance, sample_count
            FROM penetration_rate_estimates
            WHERE (lot_id, dow_bucket, hour_bucket) IN %s
            """,
            (tuple((k.lot_id, k.dow_bucket, k.hour_bucket) for k in keys_list),),
        )
        return {
            BucketKey(lot_id=row[0], dow_bucket=row[1], hour_bucket=row[2]): ExistingState(
                ewma_value=row[3], ewma_variance=row[4], sample_count=row[5]
            )
            for row in cur.fetchall()
        }


def _apply_ewma(existing: ExistingState | None, sample: float) -> ExistingState:
    """One EWMA + EWMA-residual-variance step. See module docstring."""
    if existing is None or existing.sample_count == 0:
        return ExistingState(ewma_value=sample, ewma_variance=0.0, sample_count=1)
    residual = sample - existing.ewma_value
    new_value = (1 - EWMA_ALPHA) * existing.ewma_value + EWMA_ALPHA * sample
    new_variance = (1 - EWMA_ALPHA) * existing.ewma_variance + EWMA_ALPHA * residual * residual
    return ExistingState(
        ewma_value=new_value,
        ewma_variance=new_variance,
        sample_count=existing.sample_count + 1,
    )


def _upsert(conn, key: BucketKey, state: ExistingState, now_utc: datetime) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO penetration_rate_estimates
                (lot_id, dow_bucket, hour_bucket, ewma_value, ewma_variance, sample_count, last_updated)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (lot_id, dow_bucket, hour_bucket) DO UPDATE SET
                ewma_value    = EXCLUDED.ewma_value,
                ewma_variance = EXCLUDED.ewma_variance,
                sample_count  = EXCLUDED.sample_count,
                last_updated  = EXCLUDED.last_updated
            """,
            (
                key.lot_id,
                key.dow_bucket,
                key.hour_bucket,
                state.ewma_value,
                state.ewma_variance,
                state.sample_count,
                now_utc,
            ),
        )


def recompute(date_override: str | None = None) -> dict:
    """
    Main entrypoint. Returns a metadata dict (also printed as ML_RESULT).
    """
    with get_connection() as conn:
        school_tz = _fetch_school_timezone(conn)
        utc_start, utc_end, local_date = _resolve_yesterday_window(school_tz, date_override)

        logger.info(
            "Recomputing penetration EWMA for local date=%s (%s) UTC window [%s, %s)",
            local_date,
            school_tz,
            utc_start.isoformat(),
            utc_end.isoformat(),
        )

        rows = _fetch_ground_truth_rows(conn, utc_start, utc_end)
        logger.info("Fetched %d ground-truth consensus rows", len(rows))

        if not rows:
            print(
                "ML_RESULT: "
                + json.dumps(
                    {
                        "task": "recompute_penetration_rates",
                        "local_date": local_date,
                        "rows_examined": 0,
                        "buckets_updated": 0,
                        "no_op_reason": "no_ground_truth_rows",
                    }
                )
            )
            return {"buckets_updated": 0}

        # Bucket per-row samples by (lot, school-local dow_bucket, hour_bucket).
        tz = ZoneInfo(school_tz)
        per_bucket: dict[BucketKey, list[float]] = defaultdict(list)
        for lot_id, window_start_utc, contributor_count, observed_occupancy in rows:
            # Postgres returns naive datetimes for `timestamp without time zone`
            # columns; our window_start is `timestamp` (UTC by convention).
            ws_utc = window_start_utc if window_start_utc.tzinfo else window_start_utc.replace(tzinfo=timezone.utc)
            ws_local = ws_utc.astimezone(tz)
            key = BucketKey(
                lot_id=lot_id,
                dow_bucket=dow_to_bucket(ws_local.isoweekday()),
                hour_bucket=ws_local.hour,
            )
            sample = max(SAMPLE_MIN, min(SAMPLE_MAX, contributor_count / observed_occupancy))
            per_bucket[key].append(sample)

        existing = _fetch_existing_estimates(conn, per_bucket.keys())
        now_utc = datetime.now(timezone.utc)

        updated = 0
        for key, samples in per_bucket.items():
            mean_sample = sum(samples) / len(samples)
            new_state = _apply_ewma(existing.get(key), mean_sample)
            _upsert(conn, key, new_state, now_utc)
            updated += 1

        conn.commit()

    metadata = {
        "task": "recompute_penetration_rates",
        "local_date": local_date,
        "school_timezone": school_tz,
        "rows_examined": len(rows),
        "buckets_updated": updated,
        "alpha": EWMA_ALPHA,
    }
    print("ML_RESULT: " + json.dumps(metadata))
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--date",
        type=str,
        default=os.environ.get("RECOMPUTE_DATE"),
        help="School-local YYYY-MM-DD to process (default: yesterday).",
    )
    parser.add_argument(
        "--log-level", type=str, default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"]
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    recompute(date_override=args.date)


if __name__ == "__main__":
    main()
