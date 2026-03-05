"""
Short-term feature engineering for SharkPark ML.

State-transition model features — current occupancy and momentum matter more
than seasonal patterns for short horizons.

Features:
    - Lag features: occupancy_rate at t-15min, t-30min, t-45min, t-60min
    - Momentum: rate of change (current - lag_1)
    - Time context: cyclical hour/day encodings, academic period
    - Target: occupancy_rate at each future prediction hour
"""

from datetime import datetime
from typing import Sequence

import numpy as np
import pandas as pd

from src.config import PREDICTION_HOURS, SNAPSHOT_INTERVAL_MINUTES

from .base import (
    validate_snapshot_data,
    extract_time_components,
    add_hour_encoding,
    add_day_encoding,
    normalize_timestamps,
)

__all__ = [
    "compute_lag_features",
    "prepare_training_features",
    "prepare_inference_features",
]


# =============================================================================
# Constants
# =============================================================================

NUM_LAGS = 4
LAG_INTERVAL_MINUTES = SNAPSHOT_INTERVAL_MINUTES


# =============================================================================
# Lag Features
# =============================================================================


def compute_lag_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute lag features for each lot's time-sorted snapshots.

    Groups by lot_id, sorts by timestamp, then shifts to create:
    - occupancy_rate_lag_1 through occupancy_rate_lag_4
    - momentum (occupancy_rate - occupancy_rate_lag_1)

    Args:
        df: DataFrame with lot_id, timestamp, occupancy_rate columns.
            Must already be sorted or will be sorted internally.

    Returns:
        DataFrame with lag columns and momentum added.
    """
    df = df.sort_values(["lot_id", "timestamp"]).copy()

    # Assume sorted data to apply shift within lot groups
    for i in range(1, NUM_LAGS + 1):
        df[f"occupancy_rate_lag_{i}"] = df.groupby("lot_id")["occupancy_rate"].shift(i)

    df["momentum"] = df["occupancy_rate"] - df["occupancy_rate_lag_1"]

    return df


# =============================================================================
# Training Features
# =============================================================================


def prepare_training_features(
    df: pd.DataFrame,
    min_confidence: Sequence[str] | None = ("HIGH", "MEDIUM"),
) -> pd.DataFrame:
    """
    Prepare training data for the short-term XGBoost model.

    For each snapshot with valid lags, generates one row per future
    prediction hour (hours remaining in the day from 7-21). The target
    is the actual occupancy_rate at that future hour.

    Args:
        df: Raw OccupancySnapshot DataFrame with columns:
            lot_id, timestamp, occupancy, occupancy_rate,
            semester, academic_period, week_of_semester, is_campus_open.
        min_confidence: Accepted confidence levels. Defaults to
            ("HIGH", "MEDIUM") for training quality. Pass None to
            skip confidence filtering.

    Returns:
        DataFrame with columns: lot_id, hour, day_of_week, semester,
        academic_period, week_of_semester, is_campus_open, occupancy_rate,
        occupancy_rate_lag_1..4, momentum, sin_hour, cos_hour,
        sin_day, cos_day, target_hour, hours_ahead, target_occupancy_rate.
    """
    df = validate_snapshot_data(df, min_confidence=min_confidence)
    df = normalize_timestamps(df)
    df = extract_time_components(df, "timestamp")

    # Filter to operating hours
    df = df[df["hour"].isin(PREDICTION_HOURS)].copy()

    # Compute lags
    df = compute_lag_features(df)

    # Drop rows without full lag history
    lag_cols = [f"occupancy_rate_lag_{i}" for i in range(1, NUM_LAGS + 1)]
    df = df.dropna(subset=lag_cols).copy()

    if df.empty:
        return _empty_training_df()

    # Vectorised cross-join: expand each snapshot to all future prediction hours
    feature_cols = [
        "lot_id",
        "hour",
        "day_of_week",
        "semester",
        "academic_period",
        "week_of_semester",
        "is_campus_open",
        "occupancy_rate",
        "occupancy_rate_lag_1",
        "occupancy_rate_lag_2",
        "occupancy_rate_lag_3",
        "occupancy_rate_lag_4",
        "momentum",
        "date",
    ]
    hours_df = pd.DataFrame({"target_hour": PREDICTION_HOURS})
    expanded = df[feature_cols].merge(hours_df, how="cross")

    # Keep only future hours (target must be after current snapshot)
    expanded = expanded[expanded["target_hour"] > expanded["hour"]]

    if expanded.empty:
        return _empty_training_df()

    expanded["hours_ahead"] = expanded["target_hour"] - expanded["hour"]

    # Join actual occupancy at each target hour as the training label
    actuals_df = df[["lot_id", "date", "hour", "occupancy_rate"]].rename(
        columns={"hour": "target_hour", "occupancy_rate": "target_occupancy_rate"}
    )
    expanded = expanded.merge(
        actuals_df, on=["lot_id", "date", "target_hour"], how="inner"
    )

    # Drop the intermediate date column used for the actuals join
    features = expanded.drop(columns=["date"])
    features = add_hour_encoding(features)
    features = add_day_encoding(features)

    return features


def _empty_training_df() -> pd.DataFrame:
    """Return an empty DataFrame with the expected training schema."""
    # Raw hour/day is better for tree-based models; encoded better for linear/neural (LSTM)
    # Keep both for experimentation flexibility
    return pd.DataFrame(
        columns=[
            "lot_id",
            "hour",
            "day_of_week",
            "semester",
            "academic_period",
            "week_of_semester",
            "is_campus_open",
            "occupancy_rate",
            "occupancy_rate_lag_1",
            "occupancy_rate_lag_2",
            "occupancy_rate_lag_3",
            "occupancy_rate_lag_4",
            "momentum",
            "target_hour",
            "hours_ahead",
            "target_occupancy_rate",
            "sin_hour",
            "cos_hour",
            "sin_day",
            "cos_day",
        ]
    )


# =============================================================================
# Inference Features
# =============================================================================


def prepare_inference_features(
    recent_snapshots: pd.DataFrame,
    lot_ids: list[str],
    prediction_time: datetime | None = None,
    min_confidence: Sequence[str] | None = None,
) -> pd.DataFrame:
    """
    Prepare inference features for short-term predictions.

    Uses the most recent snapshots per lot to compute lag features,
    then generates one row per (lot_id, target_hour) for all remaining
    prediction hours in the day.

    Args:
        recent_snapshots: Recent OccupancySnapshot data (last ~1 hour
            per lot is sufficient). Must include lot_id, timestamp,
            occupancy, occupancy_rate, semester, academic_period,
            week_of_semester, is_campus_open.
        lot_ids: List of lot IDs to generate predictions for.
        prediction_time: "Now" — when the prediction is being made.
            Defaults to datetime.now() if None.
        min_confidence: Accepted confidence levels. Defaults to None
            (accept all) since inference during cold-start may only
            have LOW-confidence readings available.

    Returns:
        DataFrame with columns: lot_id, hour, day_of_week, semester,
        academic_period, week_of_semester, is_campus_open, occupancy_rate,
        occupancy_rate_lag_1..4, momentum, sin_hour, cos_hour,
        sin_day, cos_day, target_hour, hours_ahead.
    """
    if prediction_time is None:
        prediction_time = datetime.now()

    df = validate_snapshot_data(recent_snapshots, min_confidence=min_confidence)
    df = normalize_timestamps(df)
    df = extract_time_components(df, "timestamp")

    # Filter to requested lots
    df = df[df["lot_id"].isin(lot_ids)].copy()

    # Compute lags
    df = compute_lag_features(df)

    # For each lot, take the most recent snapshot
    df = df.sort_values("timestamp")
    latest = df.groupby("lot_id").last().reset_index()

    current_hour = prediction_time.hour

    # Target hours: remaining prediction hours after current time
    remaining_hours = [h for h in PREDICTION_HOURS if h > current_hour]
    if not remaining_hours:
        return _empty_inference_df()

    rows = []
    for _, row in latest.iterrows():
        lot_id = row["lot_id"]

        for target_hour in remaining_hours:
            hours_ahead = target_hour - current_hour

            rows.append(
                {
                    "lot_id": lot_id,
                    "hour": current_hour,
                    "day_of_week": row["day_of_week"],
                    "semester": row["semester"],
                    "academic_period": row["academic_period"],
                    "week_of_semester": row["week_of_semester"],
                    "is_campus_open": row["is_campus_open"],
                    "occupancy_rate": row["occupancy_rate"],
                    "occupancy_rate_lag_1": row.get("occupancy_rate_lag_1", np.nan),
                    "occupancy_rate_lag_2": row.get("occupancy_rate_lag_2", np.nan),
                    "occupancy_rate_lag_3": row.get("occupancy_rate_lag_3", np.nan),
                    "occupancy_rate_lag_4": row.get("occupancy_rate_lag_4", np.nan),
                    "momentum": row.get("momentum", 0.0),
                    "target_hour": target_hour,
                    "hours_ahead": hours_ahead,
                }
            )

    if not rows:
        return _empty_inference_df()

    result = pd.DataFrame(rows)

    # Fill missing lags with current occupancy (graceful degradation)
    for col in [f"occupancy_rate_lag_{i}" for i in range(1, NUM_LAGS + 1)]:
        result[col] = result[col].fillna(result["occupancy_rate"])
    result["momentum"] = result["momentum"].fillna(0.0)

    result = add_hour_encoding(result)
    result = add_day_encoding(result)

    return result


def _empty_inference_df() -> pd.DataFrame:
    """Return an empty DataFrame with the expected inference schema."""
    return pd.DataFrame(
        columns=[
            "lot_id",
            "hour",
            "day_of_week",
            "semester",
            "academic_period",
            "week_of_semester",
            "is_campus_open",
            "occupancy_rate",
            "occupancy_rate_lag_1",
            "occupancy_rate_lag_2",
            "occupancy_rate_lag_3",
            "occupancy_rate_lag_4",
            "momentum",
            "target_hour",
            "hours_ahead",
            "sin_hour",
            "cos_hour",
            "sin_day",
            "cos_day",
        ]
    )
