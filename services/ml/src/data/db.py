"""
Database utilities for SharkPark ML service.

Provides helpers for reading real occupancy data and writing predictions
to PostgreSQL. Uses psycopg2 directly (same pattern as synthetic.py).
"""

import os
from typing import Optional

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from sqlalchemy import create_engine, text
from cuid2 import cuid_wrapper

from src.config import DATABASE_URL

_generate_cuid = cuid_wrapper()

__all__ = [
    "get_connection",
    "get_lot_id_map",
    "get_total_lot_count",
    "fetch_recent_snapshots",
    "load_real_snapshots",
    "write_predictions",
]


def _get_db_url() -> str:
    """Return the database URL, raise if not configured."""
    url = os.environ.get("DATABASE_URL", DATABASE_URL)
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is required but not set.")
    return url


def get_engine():
    """Return a SQLAlchemy engine for read queries (pd.read_sql)."""
    return create_engine(_get_db_url())


def get_connection():
    """Return a psycopg2 connection for write queries (execute_values)."""
    return psycopg2.connect(_get_db_url())


def get_total_lot_count() -> int:
    """Return the total number of lots in the database."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM lots")
            return cur.fetchone()[0]


def get_lot_id_map(conn) -> dict[str, str]:
    """
    Query the lots table and return a mapping of human-readable lot_id
    (e.g. "G1") to the CUID primary key (lots.id).

    Works with both SQLAlchemy and psycopg2 connections.

    Returns:
        dict mapping lot_id -> id  (e.g. {"G1": "clx...", "E1": "clx..."})
    """
    # SQLAlchemy connection
    if hasattr(conn, "execute") and not hasattr(conn, "cursor"):
        result = conn.execute(text("SELECT id, lot_id FROM lots"))
        return {row[1]: row[0] for row in result}

    # psycopg2 connection
    with conn.cursor() as cur:
        cur.execute("SELECT id, lot_id FROM lots")
        rows = cur.fetchall()
    return {row[1]: row[0] for row in rows}


def fetch_recent_snapshots(lookback_hours: int = 2) -> pd.DataFrame:
    """
    Fetch recent occupancy snapshots from PostgreSQL for inference.

    Queries the last `lookback_hours` of snapshots — enough to compute
    lag features (t-15m, t-30m, t-45m, t-60m) for all lots.

    Args:
        lookback_hours: How many hours of history to fetch (default: 2).

    Returns:
        DataFrame with columns: lot_id (human-readable), timestamp, occupancy,
        available, occupancy_rate, confidence, is_cold_start, academic_period,
        week_of_semester, is_campus_open, semester.

    Raises:
        RuntimeError: If DB connection fails or no snapshots are found.
    """
    engine = get_engine()
    with engine.connect() as conn:
        lot_id_map = get_lot_id_map(conn)
        reverse_map = {val: k for k, val in lot_id_map.items()}

        query = text("""
            SELECT lot_id, timestamp, occupancy, available, occupancy_rate,
                   confidence, is_cold_start, academic_period,
                   week_of_semester, is_campus_open, semester
            FROM occupancy_snapshots
            WHERE timestamp >= NOW() - make_interval(hours => :lookback_hours)
            ORDER BY timestamp
        """)

        df = pd.read_sql(query, conn, params={"lookback_hours": lookback_hours})

        if df.empty:
            raise RuntimeError(
                f"No snapshots found in the last {lookback_hours} hours. "
                "Is the backend scheduler running?\n"
                "For local dev, use --data-path to load from a parquet file instead:\n"
                "  python -m scripts.predict --data-path data/synthetic_fall-2025.parquet --start-of-day"
            )

        raw_lot_ids = df["lot_id"].copy()
        df["lot_id"] = df["lot_id"].map(reverse_map)
        unknown_mask = df["lot_id"].isna()
        if unknown_mask.any():
            unknown_ids = raw_lot_ids[unknown_mask].unique().tolist()
            raise RuntimeError(
                f"Snapshot rows contain lot IDs not found in lot_id_map: {unknown_ids}"
            )
        return df


def load_real_snapshots(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> pd.DataFrame:
    """
    Load real (non-synthetic) occupancy snapshots from PostgreSQL.

    Args:
        start_date: Inclusive lower bound (ISO date, e.g. "2026-01-15").
        end_date: Exclusive upper bound (ISO date, e.g. "2026-03-01").

    Returns:
        DataFrame with columns matching synthetic output: lot_id (human-readable),
        timestamp, occupancy, available, occupancy_rate, confidence,
        is_cold_start, academic_period, week_of_semester, is_campus_open, semester.

    Raises:
        ValueError: If dates are not valid ISO format or start_date > end_date.
    """
    from datetime import date

    for label, val in [("start_date", start_date), ("end_date", end_date)]:
        if val is not None:
            try:
                date.fromisoformat(val)
            except ValueError:
                raise ValueError(
                    f"Invalid {label} '{val}'. Expected ISO format (YYYY-MM-DD)."
                )

    if start_date and end_date and start_date >= end_date:
        raise ValueError(
            f"start_date ({start_date}) must be before end_date ({end_date})."
        )

    engine = get_engine()
    with engine.connect() as conn:
        lot_id_map = get_lot_id_map(conn)
        reverse_map = {v: k for k, v in lot_id_map.items()}

        query = """
            SELECT lot_id, timestamp, occupancy, available, occupancy_rate,
                   confidence, is_cold_start, academic_period,
                   week_of_semester, is_campus_open, semester
            FROM occupancy_snapshots
            WHERE 1=1
        """

        # Append date range conditions
        params: dict = {}
        if start_date:
            query += " AND timestamp >= :start_date"
            params["start_date"] = start_date
        if end_date:
            query += " AND timestamp < :end_date"
            params["end_date"] = end_date

        query += " ORDER BY timestamp"

        df = pd.read_sql(text(query), conn, params=params or None)

        if df.empty:
            return df

        # Map CUID lot_ids back to human-readable names
        raw_lot_ids = df["lot_id"].copy()
        df["lot_id"] = df["lot_id"].map(reverse_map)
        unknown_mask = df["lot_id"].isna()
        if unknown_mask.any():
            unknown_ids = raw_lot_ids[unknown_mask].unique().tolist()
            raise RuntimeError(
                f"Snapshot rows contain lot IDs not found in lot_id_map: {unknown_ids}"
            )
        return df


def write_predictions(predictions_df: pd.DataFrame) -> int:
    """
    Write short-term predictions to the predictions_short_term table.

    Replaces all existing predictions for the affected lots in a single
    transaction (DELETE + INSERT).

    Args:
        predictions_df: DataFrame with columns matching predictions_short_term
            schema: lot_id, predicted_at, target_time, predicted_occupancy,
            confidence_lower, confidence_upper, model_version.

    Returns:
        Number of rows inserted.

    Raises:
        RuntimeError: If DB connection fails or lot_id mapping is missing.
    """
    if predictions_df.empty:
        return 0

    conn = get_connection()
    try:
        lot_id_map = get_lot_id_map(conn)

        # Validate all lot_ids can be resolved
        lot_ids_in_df = set(predictions_df["lot_id"].unique())
        missing = lot_ids_in_df - set(lot_id_map.keys())
        if missing:
            raise RuntimeError(
                f"Cannot resolve lot_id(s) to database IDs: {missing}. "
                "Ensure these lots exist in the 'lots' table."
            )

        # Resolve human-readable lot_ids to CUIDs
        cuid_lot_ids = [lot_id_map[lid] for lid in predictions_df["lot_id"]]

        with conn.cursor() as cur:
            # Delete existing predictions for these lots
            affected_cuids = list({lot_id_map[lid] for lid in lot_ids_in_df})
            cur.execute(
                "DELETE FROM predictions_short_term WHERE lot_id = ANY(%s)",
                (affected_cuids,),
            )

            # Batch insert new predictions
            ids = [_generate_cuid() for _ in range(len(predictions_df))]
            rows = list(
                zip(
                    ids,
                    cuid_lot_ids,
                    predictions_df["predicted_at"],
                    predictions_df["target_time"],
                    predictions_df["predicted_occupancy"].astype(int),
                    predictions_df["confidence_lower"].astype(int),
                    predictions_df["confidence_upper"].astype(int),
                    predictions_df["model_version"],
                )
            )

            execute_values(
                cur,
                """
                INSERT INTO predictions_short_term
                    (id, lot_id, predicted_at, target_time,
                     predicted_occupancy, confidence_lower, confidence_upper,
                     model_version)
                VALUES %s
                """,
                rows,
            )

        conn.commit()
        return len(rows)

    except psycopg2.OperationalError as exc:
        raise RuntimeError(f"Could not connect to database: {exc}") from exc
    except psycopg2.Error as exc:
        conn.rollback()
        raise RuntimeError(f"Database write failed: {exc}") from exc
    finally:
        conn.close()
