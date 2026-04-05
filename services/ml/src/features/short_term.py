"""
Short-term feature engineering for SharkPark ML.

State-transition model features — current occupancy and momentum matter more
than seasonal patterns for short horizons.

Features:
    - Lag features: occupancy_rate at t-15min, t-30min, t-45min, t-60min
    - Momentum: rate of change (current - lag_1)
    - Time context: raw hour/day_of_week integers, academic period
    - Target: occupancy_rate at each future prediction hour
"""

from datetime import datetime
from typing import Sequence

import pandas as pd

from src.config import PREDICTION_HOURS, SNAPSHOT_INTERVAL_MINUTES

from .base import (
    prepare_base_features,
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
    df = df.sort_values(["lot_id", "timestamp"])

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
            lot_id, timestamp, occupancy, available, occupancy_rate,
            confidence, semester, academic_period, week_of_semester,
            is_campus_open.
        min_confidence: Accepted confidence levels. Defaults to
            ("HIGH", "MEDIUM") for training quality. Pass None to
            skip confidence filtering.

    Returns:
        DataFrame with columns: lot_id, hour, day_of_week, semester,
        academic_period, week_of_semester, is_campus_open, occupancy_rate,
        occupancy_rate_lag_1..4, momentum, target_hour, hours_ahead,
        target_occupancy_rate.
    """
    df = prepare_base_features(df, min_confidence=min_confidence)

    # Filter to operating hours
    df = df[df["hour"].isin(PREDICTION_HOURS)]

    # Compute lags
    df = compute_lag_features(df)

    # Drop rows without full lag history
    lag_cols = [f"occupancy_rate_lag_{i}" for i in range(1, NUM_LAGS + 1)]
    df = df.dropna(subset=lag_cols)

    if df.empty:
        return _empty_training_df()

    # Vectorised cross-join: expand each snapshot to all future prediction hours
    # Carry through weight-related metadata columns if present
    _weight_cols = [c for c in ("_source", "is_cold_start") if c in df.columns]
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
    ] + _weight_cols
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

    return features


def _empty_training_df() -> pd.DataFrame:
    """Return an empty DataFrame with the expected training schema."""
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
            occupancy, available, occupancy_rate, confidence, semester,
            academic_period, week_of_semester, is_campus_open.
        lot_ids: List of lot IDs to generate predictions for.
        prediction_time: "Now" — when the prediction is being made.
            Defaults to datetime.now() if None.
        min_confidence: Accepted confidence levels. Defaults to None
            (accept all) since inference during cold-start may only
            have LOW-confidence readings available.

    Returns:
        DataFrame with columns: lot_id, hour, day_of_week, semester,
        academic_period, week_of_semester, is_campus_open, occupancy_rate,
        occupancy_rate_lag_1..4, momentum, target_hour, hours_ahead.
    """
    if prediction_time is None:
        prediction_time = datetime.now()

    df = prepare_base_features(recent_snapshots, min_confidence=min_confidence)

    # Filter to requested lots
    df = df[df["lot_id"].isin(lot_ids)]

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

    feature_cols = [
        "lot_id",
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
    ]
    if "is_cold_start" in latest.columns:
        feature_cols.append("is_cold_start")

    hours_df = pd.DataFrame({"target_hour": remaining_hours})
    result = latest[feature_cols].merge(hours_df, how="cross")
    result["hour"] = current_hour
    result["hours_ahead"] = result["target_hour"] - current_hour

    if result.empty:
        return _empty_inference_df()

    # Fill missing lags with current occupancy (graceful degradation)
    for col in [f"occupancy_rate_lag_{i}" for i in range(1, NUM_LAGS + 1)]:
        result[col] = result[col].fillna(result["occupancy_rate"])
    result["momentum"] = result["momentum"].fillna(0.0)

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
        ]
    )
