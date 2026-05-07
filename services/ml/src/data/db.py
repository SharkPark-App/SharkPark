"""
Database utilities for SharkPark ML service.

Provides helpers for reading real occupancy data and writing predictions
to PostgreSQL. Uses psycopg2 directly (same pattern as synthetic.py).
"""

import os
import re
from datetime import date
from typing import Optional
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from sqlalchemy import create_engine, text
from cuid2 import cuid_wrapper

from src.config import DATABASE_URL, WEATHER_MAX_AGE_HOURS

_generate_cuid = cuid_wrapper()

__all__ = [
    "get_connection",
    "get_lot_id_map",
    "get_total_lot_count",
    "fetch_recent_snapshots",
    "fetch_latest_weather",
    "fetch_weather_forecast_map",
    "fetch_long_term_weather_forecast",
    "get_school_id_for_lots",
    "load_real_snapshots",
    "load_synthetic_v2_snapshots",
    "load_historical_snapshots",
    "write_short_term_predictions",
    "write_long_term_predictions",
]


def _get_db_url() -> str:
    """Return a DB URL compatible with psycopg2/SQLAlchemy on Fly/Neon."""
    # Prefer DATABASE_URL to match app defaults; fall back to DIRECT_URL.
    url = os.environ.get("DATABASE_URL", DATABASE_URL) or os.environ.get("DIRECT_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL environment variable is required but not set."
        )
    # Neon pooled URLs can include options psycopg2 rejects.
    # Keep other params (e.g. sslmode), but remove unsupported pool-only keys.
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params.pop("pgbouncer", None)
    params.pop("connection_limit", None)
    params.pop("channel_binding", None)
    sslmode = (params.get("sslmode", [""])[0] or "").strip().lower()
    if sslmode in {"verify-ca", "verify-full"}:
        # The container's libpq CA bundle may not trust Neon's cert chain.
        # Downgrade to `require` to keep TLS encryption without cert verification.
        params["sslmode"] = ["require"]
        params.pop("sslrootcert", None)
    cleaned = parsed._replace(query=urlencode(params, doseq=True))
    return urlunparse(cleaned)


def _normalize_catalog_term(term: Optional[str]) -> Optional[str]:
    """Normalize tags like Spring_2026 / spring-2026 to catalog term values."""
    if term is None:
        return None
    raw = term.strip()
    m = re.fullmatch(r"(?i)(spring|summer|fall|winter)[_-]\d{4}", raw)
    if m:
        return m.group(1).title()
    return raw


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
            SELECT s.lot_id, s.timestamp, s.occupancy, s.available, s.occupancy_rate,
                   s.confidence, s.is_cold_start, s.academic_period,
                   s.week_of_semester, s.is_campus_open, s.semester,
                   w.temperature_f, w.precipitation_probability,
                   w.wind_speed_mph, w.is_raining, w.conditions
            FROM occupancy_snapshots s
            LEFT JOIN weather w ON w.id = s.weather_id
            WHERE s.timestamp >= NOW() - make_interval(hours => :lookback_hours)
            ORDER BY s.timestamp
        """)

        df = pd.read_sql(query, conn, params={"lookback_hours": lookback_hours})

        if df.empty:
            raise RuntimeError(
                f"No snapshots found in the last {lookback_hours} hours. "
                "Is the backend scheduler running?\n"
                "For local dev, use --data-path to load from a parquet file instead:\n"
                "  python -m scripts.predict_short_term --data-path data/synthetic_fall-2025.parquet --start-of-day"
            )

        raw_lot_ids = df["lot_id"].copy()
        df["lot_id"] = df["lot_id"].map(reverse_map)
        unknown_mask = df["lot_id"].isna()
        if unknown_mask.any():
            unknown_ids = raw_lot_ids[unknown_mask].unique().tolist()
            raise RuntimeError(
                f"Snapshot rows contain lot IDs not found in lot_id_map: {unknown_ids}"
            )
        return _attach_weather_severity(df)


def get_school_id_for_lots(lot_ids: list[str]) -> str:
    """
    Resolve the single school_id that owns the given human-readable lot_ids.

    Raises if the lots span multiple schools (multi-campus inference is not
    supported by the current pipeline) or if any lot_id is unknown.
    """
    if not lot_ids:
        raise ValueError("lot_ids must be non-empty to resolve school_id")

    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT DISTINCT school_id FROM lots WHERE lot_id = ANY(:lot_ids)"),
            {"lot_ids": list(lot_ids)},
        )
        school_ids = [row[0] for row in result]

    if not school_ids:
        raise RuntimeError(f"No lots found for lot_ids={lot_ids}")

    if len(school_ids) > 1:
        raise RuntimeError(
            f"lot_ids span multiple schools ({school_ids}); "
            "inference must be scoped to a single school."
        )
    return school_ids[0]


def fetch_latest_weather(school_id: str):
    """
    Fetch the most recent weather observation for `school_id`.

    Returns the row as a `WeatherSnapshot` (defined in
    `src.postprocess.weather_adjustment`) or None when the table has no
    rows for this school or the DB is unreachable.

    Returns:
        WeatherSnapshot | None
    """
    from src.postprocess.weather_adjustment import WeatherSnapshot

    try:
        engine = get_engine()
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    """
                    SELECT timestamp, temperature_f, feels_like_f,
                           humidity_percent, wind_speed_mph, conditions,
                           precipitation_probability, is_raining
                    FROM weather
                    WHERE school_id = :school_id
                    ORDER BY timestamp DESC
                    LIMIT 1
                    """
                ),
                {"school_id": school_id},
            )
            row = result.fetchone()
    except Exception as exc:
        # Predictions must still ship if the weather table is unavailable.
        # Adjustment layer treats None as NO_WEATHER_DATA (no-op).
        import logging

        logging.getLogger(__name__).warning(
            "Could not fetch latest weather row (%s); skipping adjustment.", exc
        )
        return None

    if row is None:
        return None

    # weather staleness gate
    if WEATHER_MAX_AGE_HOURS > 0:
        from datetime import datetime, timezone
        import logging

        row_ts = row[0]

        # Naive timestamps from Postgres are UTC: backend writes `new Date()` in
        # apps/backend/src/weather/weather-fetch.service.ts, which Prisma stores
        # as a UTC instant in the `timestamp without time zone` column.
        if row_ts.tzinfo is None:
            row_ts = row_ts.replace(tzinfo=timezone.utc)

        age_hours = (datetime.now(timezone.utc) - row_ts).total_seconds() / 3600.0
        if age_hours > WEATHER_MAX_AGE_HOURS:
            logging.getLogger(__name__).warning(
                "Latest weather row is %.1fh old (max %.1fh); skipping adjustment.",
                age_hours,
                WEATHER_MAX_AGE_HOURS,
            )
            return None

    return WeatherSnapshot(
        timestamp=row[0],
        temperature_f=float(row[1]),
        feels_like_f=float(row[2]),
        humidity_percent=float(row[3]),
        wind_speed_mph=float(row[4]),
        conditions=row[5] or "",
        precipitation_probability=float(row[6]),
        is_raining=bool(row[7]),
    )


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
            SELECT s.lot_id, s.timestamp, s.occupancy, s.available, s.occupancy_rate,
                   s.confidence, s.is_cold_start, s.academic_period,
                   s.week_of_semester, s.is_campus_open, s.semester,
                   w.temperature_f, w.precipitation_probability,
                   w.wind_speed_mph, w.is_raining, w.conditions
            FROM occupancy_snapshots s
            LEFT JOIN weather w ON w.id = s.weather_id
            WHERE 1=1
        """

        # Append date range conditions
        params: dict = {}
        if start_date:
            query += " AND s.timestamp >= :start_date"
            params["start_date"] = start_date
        if end_date:
            query += " AND s.timestamp < :end_date"
            params["end_date"] = end_date

        query += " ORDER BY s.timestamp"

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
        return _attach_weather_severity(df)


def load_synthetic_v2_snapshots(
    school_short_name: Optional[str] = None,
    term: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    generator_version: str = "v2",
) -> pd.DataFrame:
    """
    Load catalog-driven synthetic occupancy rows from ``synthetic_observations``.

    The v2 generator (``services/ml/src/data/synthetic_v2.py``) writes
    per-lot/per-tick rows with a per-row ``sample_weight``. This loader
    returns them in the same column shape as ``load_real_snapshots`` so they
    can flow through ``merge_real_synthetic`` and the feature pipeline
    unchanged. Per-row metadata preserved for downstream weighting:

    * ``_source = "synthetic"`` — opts row into the synthetic tier in
      :meth:`BaseXGBoostModel._build_sample_weights`.
    * ``generator_version = "v2"`` — distinguishes from v1 parquet rows
      (which have no version column and fall into the v1 tier).
    * ``sample_weight`` (float) — passes through to per-row weight scaling.

    Args:
        school_short_name: Required filter (e.g. ``"CSULB"``) — the v2 table
            is multi-school. Pass ``None`` to load all schools (rare).
        term: Required filter (e.g. ``"Spring_2026"`` or ``"Spring"``)
            for reproducibility.
        start_date / end_date: Inclusive / exclusive ISO timestamp bounds.
        generator_version: Defaults to ``"v2"``; rarely overridden.

    Returns:
        Empty DataFrame when no rows match (caller handles gracefully).
        Otherwise: lot_id (human-readable), timestamp, occupancy, available,
        occupancy_rate, confidence ("HIGH"), is_cold_start (False),
        academic_period, week_of_semester, is_campus_open, semester,
        _source, generator_version, sample_weight.

    Raises:
        ValueError: Invalid date strings or inverted range.
        RuntimeError: Unknown ``school_short_name`` or rows reference lot IDs
            absent from the lots table.
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
        # Resolve school filter (loud failure on unknown name — no silent skip).
        school_id: Optional[str] = None
        if school_short_name is not None:
            row = conn.execute(
                text("SELECT id FROM schools WHERE short_name = :name"),
                {"name": school_short_name},
            ).first()
            if row is None:
                raise RuntimeError(
                    f"School short_name={school_short_name!r} not found in schools."
                )
            school_id = row[0]

        # JOIN lots to derive `available = capacity - occupancy`.
        query = """
            SELECT
                s.lot_id        AS lot_cuid,
                s.timestamp     AS timestamp,
                s.occupancy     AS occupancy,
                s.occupancy_rate AS occupancy_rate,
                s.sample_weight AS sample_weight,
                s.term          AS term,
                s.generator_version AS generator_version,
                l.capacity      AS total_spaces
            FROM synthetic_observations s
            JOIN lots l ON l.id = s.lot_id
            WHERE s.generator_version = :gen
        """
        params: dict = {"gen": generator_version}
        if school_id is not None:
            query += " AND s.school_id = :school_id"
            params["school_id"] = school_id
        resolved_term = _normalize_catalog_term(term)
        if resolved_term is not None:
            query += " AND s.term = :term"
            params["term"] = resolved_term
        if start_date:
            query += " AND s.timestamp >= :start_date"
            params["start_date"] = start_date
        if end_date:
            query += " AND s.timestamp < :end_date"
            params["end_date"] = end_date
        query += " ORDER BY s.timestamp"

        df = pd.read_sql(text(query), conn, params=params)
        if df.empty:
            return df

        lot_id_map = get_lot_id_map(conn)
        reverse_map = {v: k for k, v in lot_id_map.items()}

    df["lot_id"] = df["lot_cuid"].map(reverse_map)
    unknown_mask = df["lot_id"].isna()
    if unknown_mask.any():
        unknown_ids = df.loc[unknown_mask, "lot_cuid"].unique().tolist()
        raise RuntimeError(
            f"synthetic_observations rows reference unknown lot IDs: {unknown_ids}"
        )

    df["available"] = (df["total_spaces"] - df["occupancy"]).clip(lower=0).astype(int)
    df["confidence"] = "HIGH"
    df["is_cold_start"] = False
    df["_source"] = "synthetic"
    df["semester"] = df["term"]

    # Derive academic_period / week_of_semester / is_campus_open from each
    # row's local date. Synthetic v2 stores UTC timestamps; the calendar
    # functions are coarse enough that UTC vs local is irrelevant for
    # CSULB (-08:00 fixed offset never crosses a calendar boundary that
    # matters for week/period classification within a class day).
    from src.academic_calendar import get_week_of_semester, is_campus_open

    dates = pd.to_datetime(df["timestamp"]).dt.date
    week_period = dates.map(get_week_of_semester)
    df["week_of_semester"] = week_period.map(lambda wp: wp[0]).astype(int)
    df["academic_period"] = week_period.map(lambda wp: wp[1])
    df["is_campus_open"] = dates.map(is_campus_open).astype(bool)

    # Synthetic v2 has no weather observation. Leave the weather feature
    # columns as NaN; XGBoost handles missing values natively, and the
    # learned model treats "no weather signal" the same way it treats real
    # rows whose `weather_id` was NULL at the time of capture.
    import numpy as np

    df["temperature_f"] = np.nan
    df["precipitation_probability"] = np.nan
    df["wind_speed_mph"] = np.nan
    df["is_raining"] = np.nan
    df["weather_severity"] = "NO_WEATHER_DATA"

    return df.drop(columns=["lot_cuid", "total_spaces", "term"])[
        [
            "lot_id",
            "timestamp",
            "occupancy",
            "available",
            "occupancy_rate",
            "confidence",
            "is_cold_start",
            "academic_period",
            "week_of_semester",
            "is_campus_open",
            "semester",
            "temperature_f",
            "precipitation_probability",
            "wind_speed_mph",
            "is_raining",
            "weather_severity",
            "_source",
            "generator_version",
            "sample_weight",
        ]
    ]


def _attach_weather_severity(df: pd.DataFrame) -> pd.DataFrame:
    """Derive `weather_severity` per row from the joined weather columns and
    drop the raw `conditions` string (kept only as input to the classifier).

    Real-data loaders LEFT JOIN the `weather` table and pull
    `temperature_f`, `precipitation_probability`, `wind_speed_mph`,
    `is_raining`, `conditions`. Rows whose `weather_id` was NULL (or whose
    weather row was deleted) get NaN numerics + NO_WEATHER_DATA severity.
    """
    from src.postprocess.weather_adjustment import classify_severity_from_fields

    if "conditions" not in df.columns:
        # Loader didn't pull weather \u2014 nothing to derive.
        return df

    def _classify(row) -> str:
        return classify_severity_from_fields(
            temperature_f=row.get("temperature_f"),
            wind_speed_mph=row.get("wind_speed_mph"),
            conditions=row.get("conditions"),
            is_raining=row.get("is_raining"),
            precipitation_probability=row.get("precipitation_probability"),
        )

    df = df.copy()
    df["weather_severity"] = df.apply(_classify, axis=1)
    # `is_raining` becomes a numeric feature (0/1) for XGBoost; preserve NaN
    # for missing weather so the model can split on "weather present" too.
    if "is_raining" in df.columns:
        df["is_raining"] = pd.to_numeric(df["is_raining"], errors="coerce")
    return df.drop(columns=["conditions"])


def fetch_weather_forecast_map(school_id: str) -> dict:
    """Return a mapping ``hour_of_day -> dict`` of forecast features for the
    next ~24h, used by short-term inference to attach a per-target-hour
    forecast (latest weather is used for hours we don't have a forecast for).

    Each value dict has keys: ``temperature_f``, ``precipitation_probability``,
    ``wind_speed_mph``, ``is_raining``, ``weather_severity``.
    Returns an empty dict if the table is empty or unreachable.
    """
    from src.postprocess.weather_adjustment import classify_severity_from_fields

    try:
        engine = get_engine()
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    """
                    SELECT target_time, temperature_f, precipitation_probability,
                           wind_speed_mph, is_raining, conditions
                    FROM weather_forecasts
                    WHERE school_id = :school_id
                      AND target_time >= NOW()
                      AND target_time < NOW() + INTERVAL '24 hours'
                    ORDER BY target_time
                    """
                ),
                {"school_id": school_id},
            )
            rows = result.fetchall()
    except Exception as exc:
        import logging

        logging.getLogger(__name__).warning(
            "Could not fetch weather forecasts (%s); skipping forecast feature.", exc
        )
        return {}

    out: dict[int, dict] = {}
    for row in rows:
        target_time, temperature_f, precip_prob, wind_mph, is_raining, conditions = row
        hour = int(target_time.hour)
        if hour in out:
            continue  # keep the earliest forecast for that hour
        severity = classify_severity_from_fields(
            temperature_f=float(temperature_f),
            wind_speed_mph=float(wind_mph),
            conditions=conditions or "",
            is_raining=bool(is_raining),
            precipitation_probability=float(precip_prob),
        )
        out[hour] = {
            "temperature_f": float(temperature_f),
            "precipitation_probability": float(precip_prob),
            "wind_speed_mph": float(wind_mph),
            "is_raining": float(bool(is_raining)),
            "weather_severity": severity,
        }
    return out


def fetch_long_term_weather_forecast(
    school_id: str, days_ahead: int = 7
) -> dict[tuple[date, int], dict]:
    """Return a ``(target_date, target_hour) -> forecast`` map for the next
    ``days_ahead`` days, used by long-term inference to apply the rule-based
    weather adjustment per row.

    Unlike :func:`fetch_weather_forecast_map` (which collapses to hour-of-day
    for the next 24h), this preserves the full date so multi-day inference can
    look up the correct forecast for each (target_date, target_hour) row.

    Each value dict has keys: ``target_time``, ``temperature_f``,
    ``precipitation_probability``, ``wind_speed_mph``, ``is_raining``,
    ``conditions``, ``weather_severity``.

    Returns an empty dict when the table is empty, unreachable, or the
    forecast horizon ends before now (the upstream NWS scrape may be
    behind). Caller MUST treat empty-map as "no weather adjustment" rather
    than fail \u2014 see ``predict_long_term.py`` for the wiring contract.
    """
    from src.postprocess.weather_adjustment import classify_severity_from_fields

    horizon = max(1, min(days_ahead, 14))
    try:
        engine = get_engine()
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    """
                    SELECT target_time, temperature_f,
                           precipitation_probability, wind_speed_mph,
                           is_raining, conditions
                    FROM weather_forecasts
                    WHERE school_id = :school_id
                      AND target_time >= NOW()
                      AND target_time < NOW() + (:horizon || ' days')::interval
                    ORDER BY target_time
                    """
                ),
                {"school_id": school_id, "horizon": str(horizon)},
            )
            rows = result.fetchall()
    except Exception as exc:
        import logging

        logging.getLogger(__name__).warning(
            "Could not fetch long-term weather forecasts (%s); "
            "skipping weather adjustment.",
            exc,
        )
        return {}

    out: dict[tuple[date, int], dict] = {}
    for row in rows:
        target_time, temperature_f, precip_prob, wind_mph, is_raining, conditions = row
        # ``target_time`` comes back as a tz-aware datetime; the predict
        # script's target_dates are naive ``date`` objects in school-local
        # time. Storing the date in UTC matches what the backend persisted
        # \u2014 callers normalize at lookup time.
        key = (target_time.date(), int(target_time.hour))
        if key in out:
            continue  # earliest forecast wins for a given slot
        severity = classify_severity_from_fields(
            temperature_f=float(temperature_f),
            wind_speed_mph=float(wind_mph),
            conditions=conditions or "",
            is_raining=bool(is_raining),
            precipitation_probability=float(precip_prob),
        )
        out[key] = {
            "target_time": target_time,
            "temperature_f": float(temperature_f),
            "precipitation_probability": float(precip_prob),
            "wind_speed_mph": float(wind_mph),
            "is_raining": bool(is_raining),
            "conditions": conditions or "",
            "weather_severity": severity,
        }
    return out


def load_historical_snapshots(lookback_weeks: int = 6) -> pd.DataFrame:
    """
    Fetch several weeks of occupancy snapshots from PostgreSQL for long-term
    baseline computation and model training.

    Args:
        lookback_weeks: How many weeks of history to fetch (default: 6 —
            4 weeks for the baseline window plus a 2-week buffer).

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
            SELECT s.lot_id, s.timestamp, s.occupancy, s.available, s.occupancy_rate,
                   s.confidence, s.is_cold_start, s.academic_period,
                   s.week_of_semester, s.is_campus_open, s.semester,
                   w.temperature_f, w.precipitation_probability,
                   w.wind_speed_mph, w.is_raining, w.conditions
            FROM occupancy_snapshots s
            LEFT JOIN weather w ON w.id = s.weather_id
            WHERE s.timestamp >= NOW() - make_interval(weeks => :lookback_weeks)
            ORDER BY s.timestamp
        """)

        df = pd.read_sql(query, conn, params={"lookback_weeks": lookback_weeks})

        if df.empty:
            raise RuntimeError(
                f"No snapshots found in the last {lookback_weeks} weeks. "
                "Is the backend scheduler running?\n"
                "For local dev, use --data-path to load from a parquet file instead:\n"
                "  python -m scripts.predict_long_term --data-path data/synthetic_fall-2025.parquet"
            )
        # Map CUID lot_ids back to human-readable names
        raw_lot_ids = df["lot_id"].copy()
        df["lot_id"] = df["lot_id"].map(reverse_map)
        unknown_mask = df["lot_id"].isna()
        if unknown_mask.any():
            unknown_ids = raw_lot_ids[unknown_mask].unique().tolist()
            raise RuntimeError(
                f"Snapshot rows contain lot IDs not found in lot_id_map: {unknown_ids}"
            )
        return _attach_weather_severity(df)


def write_short_term_predictions(predictions_df: pd.DataFrame) -> int:
    """
    Write short-term predictions to the predictions_short_term table.

    Append-only. Each call inserts new rows for every prediction in
    the dataframe; prior predictions for the same `(lot_id, target_time)` are
    NOT deleted/overwritten.

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
            # Batch insert new predictions
            ids = [_generate_cuid() for _ in range(len(predictions_df))]
            rows = list(
                zip(
                    ids,
                    cuid_lot_ids,
                    predictions_df["predicted_at"],
                    predictions_df["target_time"],
                    predictions_df["predicted_occupancy"].astype(float),
                    predictions_df["confidence_lower"].astype(float),
                    predictions_df["confidence_upper"].astype(float),
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


def write_long_term_predictions(predictions_df: pd.DataFrame) -> int:
    """
    Write long-term predictions to the predictions_long_term table.

    Append-only. Each call inserts new rows for every prediction in
    the dataframe; prior predictions for the same
    `(lot_id, target_date, target_hour)` are NOT deleted or overwritten.

    Args:
        predictions_df: DataFrame with columns: lot_id, predicted_at, target_date,
            target_hour, predicted_occupancy, confidence_lower, confidence_upper,
            model_version.

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

        # Validate lot_ids
        lot_ids_in_df = set(predictions_df["lot_id"].unique())
        missing = lot_ids_in_df - set(lot_id_map.keys())
        if missing:
            raise RuntimeError(
                f"Cannot resolve lot_id(s) to database IDs: {missing}. "
                "Ensure these lots exist in the 'lots' table."
            )

        # Resolve readable lot_ids to CUIDs
        cuid_lot_ids = [lot_id_map[lid] for lid in predictions_df["lot_id"]]

        with conn.cursor() as cur:
            ids = [_generate_cuid() for _ in range(len(predictions_df))]
            rows = list(
                zip(
                    ids,
                    cuid_lot_ids,
                    predictions_df["predicted_at"],
                    predictions_df["target_date"],
                    predictions_df["target_hour"].astype(int),
                    predictions_df["predicted_occupancy"].astype(float),
                    predictions_df["confidence_lower"].astype(float),
                    predictions_df["confidence_upper"].astype(float),
                    predictions_df["model_version"],
                )
            )

            execute_values(
                cur,
                """
                INSERT INTO predictions_long_term
                    (id, lot_id, predicted_at, target_date, target_hour,
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
