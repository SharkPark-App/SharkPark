"""
Shared feature engineering utilities for SharkPark ML models.

Contains common transformations used by both short-term and long-term models:
- Cyclical time encoding
- Data validation
"""

import logging
from typing import Sequence, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

__all__ = [
    "normalize_timestamps",
    "merge_real_synthetic",
    "encode_cyclical",
    "add_hour_encoding",
    "add_day_encoding",
    "extract_time_components",
    "validate_snapshot_data",
    "prepare_base_features",
]


# =============================================================================
# Timestamp Normalization
# =============================================================================


def normalize_timestamps(df: pd.DataFrame, col: str = "timestamp") -> pd.DataFrame:
    """Strip timezone info from timestamps for consistent comparisons."""
    df = df.copy()
    ts = pd.to_datetime(df[col])
    if ts.dt.tz is not None:
        ts = ts.dt.tz_localize(None)
    df[col] = ts
    return df


# =============================================================================
# Real / Synthetic Merging
# =============================================================================


def merge_real_synthetic(
    df_real: pd.DataFrame,
    df_synthetic: pd.DataFrame,
) -> pd.DataFrame:
    """
    Merge real and synthetic snapshot DataFrames, preferring real data.

    Normalizes timestamps, deduplicates on 15-min (lot_id, slot) keys so that
    real rows replace overlapping synthetic rows, then concatenates.

    Args:
        df_real: Real snapshot DataFrame (must not be empty).
        df_synthetic: Synthetic snapshot DataFrame.

    Returns:
        Combined DataFrame with ``_source`` column set to ``"real"`` for real rows.
    """
    df_real = normalize_timestamps(df_real)
    df_synthetic = normalize_timestamps(df_synthetic)

    df_real["_source"] = "real"

    df_real["_slot"] = df_real["timestamp"].dt.floor("15min")
    df_synthetic["_slot"] = df_synthetic["timestamp"].dt.floor("15min")

    real_keys = df_real[["lot_id", "_slot"]].drop_duplicates()
    df_synthetic_filtered = (
        df_synthetic.merge(
            real_keys, on=["lot_id", "_slot"], how="left", indicator=True
        )
        .query('_merge == "left_only"')
        .drop(columns=["_merge", "_slot"])
    )
    df_real = df_real.drop(columns=["_slot"])

    dropped = len(df_synthetic) - len(df_synthetic_filtered)
    if dropped:
        logger.info("  Dropped %s synthetic rows replaced by real data", f"{dropped:,}")

    df = pd.concat([df_real, df_synthetic_filtered], ignore_index=True)
    logger.info("  Combined: %s rows", f"{len(df):,}")
    return df


# =============================================================================
# Cyclical Time Encoding
# =============================================================================


def encode_cyclical(value: float, period: float) -> Tuple[float, float]:
    """
    Encode a cyclical feature as sin/cos components.

    Preserves the circular nature of time (e.g., hour 23 is close to hour 0).

    Args:
        value: The value to encode (e.g., hour 14, day 3)
        period: The period of the cycle (e.g., 24 for hours, 7 for days)

    Returns:
        Tuple of (sin_component, cos_component)

    Example:
        >>> encode_cyclical(6, 24)  # 6am
        (1.0, 0.0)  # approximately
    """
    angle = 2 * np.pi * value / period
    return np.sin(angle), np.cos(angle)


def add_hour_encoding(df: pd.DataFrame, hour_col: str = "hour") -> pd.DataFrame:
    """
    Add cyclical hour encoding (sin_hour, cos_hour) to dataframe.

    Args:
        df: DataFrame with hour column
        hour_col: Name of the hour column (0-23)

    Returns:
        DataFrame with sin_hour and cos_hour columns added
    """
    df = df.copy()
    df["sin_hour"] = np.sin(2 * np.pi * df[hour_col] / 24)
    df["cos_hour"] = np.cos(2 * np.pi * df[hour_col] / 24)
    return df


def add_day_encoding(df: pd.DataFrame, day_col: str = "day_of_week") -> pd.DataFrame:
    """
    Add cyclical day-of-week encoding (sin_day, cos_day) to dataframe.

    Args:
        df: DataFrame with day_of_week column (0=Monday, 6=Sunday)
        day_col: Name of the day column

    Returns:
        DataFrame with sin_day and cos_day columns added
    """
    df = df.copy()
    df["sin_day"] = np.sin(2 * np.pi * df[day_col] / 7)
    df["cos_day"] = np.cos(2 * np.pi * df[day_col] / 7)
    return df


# =============================================================================
# Time Extraction
# =============================================================================


def extract_time_components(
    df: pd.DataFrame, timestamp_col: str = "timestamp"
) -> pd.DataFrame:
    """
    Extract time components from timestamp column.

    Args:
        df: DataFrame with timestamp column
        timestamp_col: Name of the timestamp column (ISO 8601 string or datetime)

    Returns:
        DataFrame with added columns:
        - hour (0-23)
        - day_of_week (0=Monday, 6=Sunday)
        - date (YYYY-MM-DD string)
        - is_weekend (bool)
    """
    df = df.copy()

    # Convert to datetime if needed; strings == object types
    if df[timestamp_col].dtype == object:
        df[timestamp_col] = pd.to_datetime(df[timestamp_col])

    df["hour"] = df[timestamp_col].dt.hour
    df["day_of_week"] = df[timestamp_col].dt.dayofweek
    df["date"] = df[timestamp_col].dt.strftime("%Y-%m-%d")
    df["is_weekend"] = df["day_of_week"].isin([5, 6])

    return df


# =============================================================================
# Validation
# =============================================================================


def validate_snapshot_data(
    df: pd.DataFrame,
    min_confidence: Sequence[str] | None = ("HIGH", "MEDIUM"),
) -> pd.DataFrame:
    """
    Validate and clean occupancy snapshot data.

    Args:
        df: Raw snapshot DataFrame
        min_confidence: Accepted confidence levels. Defaults to
            ("HIGH", "MEDIUM") for training quality. Pass None to
            accept all confidence levels (useful for inference
            during cold-start when most readings are LOW).

    Returns:
        Cleaned DataFrame with invalid rows removed

    Raises:
        ValueError: If required columns are missing
    """
    required_cols = [
        "lot_id",
        "timestamp",
        "occupancy",
        "occupancy_rate",
        "semester",
        "academic_period",
        "week_of_semester",
        "is_campus_open",
    ]
    missing = [col for col in required_cols if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    df = df.copy()

    # Remove rows with null values in required columns
    df = df.dropna(subset=required_cols)

    # Filter by confidence level
    if min_confidence is not None and "confidence" in df.columns:
        pre_filter = len(df)
        df = df[df["confidence"].isin(min_confidence)]
        dropped = pre_filter - len(df)
        if pre_filter > 0 and dropped / pre_filter > 0.5:
            logger.warning(
                "Confidence filter dropped %d / %d rows (%.0f%%). "
                "Accepted levels: %s. Consider passing min_confidence=None "
                "if LOW-confidence data is acceptable for this use case.",
                dropped,
                pre_filter,
                100 * dropped / pre_filter,
                list(min_confidence),
            )

    # Clamp occupancy_rate to valid range
    df["occupancy_rate"] = df["occupancy_rate"].clip(0.0, 1.0)

    # Remove negative occupancy
    df = df[df["occupancy"] >= 0]

    return df


# =============================================================================
# Feature Pipeline Helper
# =============================================================================


def prepare_base_features(
    df: pd.DataFrame,
    timestamp_col: str = "timestamp",
    min_confidence: Sequence[str] | None = ("HIGH", "MEDIUM"),
) -> pd.DataFrame:
    """
    Apply base feature transformations shared by both models.

    Pipeline:
    1. Validate and clean data
    2. Normalize timestamps (strip timezone)
    3. Extract time components (hour, day_of_week, date, is_weekend)

    Args:
        df: Raw snapshot DataFrame
        timestamp_col: Name of timestamp column
        min_confidence: Accepted confidence levels (passed to
            validate_snapshot_data).

    Returns:
        DataFrame with base features added
    """
    df = validate_snapshot_data(df, min_confidence=min_confidence)
    df = normalize_timestamps(df, col=timestamp_col)
    df = extract_time_components(df, timestamp_col)

    return df
