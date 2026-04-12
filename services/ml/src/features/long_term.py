"""
Long-term feature engineering for SharkPark ML.

Two-stage model features:
  Stage 1 — Historical Baseline: 4-week rolling average per
      (lot_id, academic_period, day_of_week, hour). Represents the
      "typical" occupancy at that time slot.
  Stage 2 — XGBoost Adjustment: predicts the deviation from baseline
      using calendar and horizon features.

Features:
    - historical_baseline: Stage 1 output (occupancy rate)
    - days_ahead: forecast horizon (1-7)
    - week_of_semester, semester, academic_period, is_campus_open
    - lot_id (categorical)
    - sin_hour, cos_hour, sin_day, cos_day (cyclical encodings of time)

Target: deviation = actual_occupancy_rate - historical_baseline
"""

import logging
from datetime import timedelta
from typing import Sequence

import numpy as np
import pandas as pd

from src.config import LONG_TERM_BASELINE_WEEKS, PREDICTION_HOURS

from .base import (
    prepare_base_features,
    extract_time_components,
    add_hour_encoding,
    add_day_encoding,
)

logger = logging.getLogger(__name__)

__all__ = [
    "compute_baseline",
    "prepare_training_features",
]

# Minimum unique days per (lot_id, academic_period, day_of_week, hour) group
# before trusting its mean; sparse groups fall back to global (day_of_week, hour)
# Must be ≤2 to work within short academic periods (dead_week, midterms)
_MIN_COVERAGE_DAYS = 2


# =============================================================================
# Stage 1: Historical Baseline
# =============================================================================


def compute_baseline(
    df: pd.DataFrame,
    baseline_weeks: int = LONG_TERM_BASELINE_WEEKS,
    min_confidence: Sequence[str] | None = ("HIGH", "MEDIUM"),
) -> pd.DataFrame:
    """
    Compute rolling average occupancy per (lot_id, academic_period,
    day_of_week, hour).

    Only the most recent `baseline_weeks` of data are included so that the
    baseline reflects current conditions.
    Same-academic-period filtering prevents, e.g., summer break data from
    contaminating regular-semester baselines.

    Cold-start fallback: if a group has fewer than _MIN_COVERAGE_DAYS unique
    days, the group's mean is replaced by the global (day_of_week, hour)
    average across all lots.

    Confidence filtering: unlike the training-feature path, the baseline DOES
    filter LOW-confidence rows by default. The baseline has no weighting
    mechanism, so a noisy baseline directly corrupts the Stage 2 deviation
    target. Pass ``min_confidence=None`` to disable.

    Args:
        df: Snapshot DataFrame. Must include columns: lot_id, timestamp,
            occupancy_rate, academic_period. Time components are extracted
            internally if not already present.
        baseline_weeks: Rolling window size in weeks.
        min_confidence: Accepted confidence levels. Defaults to
            ("HIGH", "MEDIUM"); pass None to accept all.

    Returns:
        DataFrame indexed by (lot_id, academic_period, day_of_week, hour)
        with columns: baseline_occupancy_rate, coverage_days.
    """
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    # Filter by confidence before windowing so the cutoff reflects clean data
    if min_confidence is not None and "confidence" in df.columns:
        df = df[df["confidence"].isin(min_confidence)]

    if df.empty:
        return pd.DataFrame(
            columns=[
                "lot_id",
                "academic_period",
                "day_of_week",
                "hour",
                "baseline_occupancy_rate",
                "coverage_days",
            ]
        )

    # Restrict to the rolling window
    cutoff = df["timestamp"].max() - timedelta(weeks=baseline_weeks)
    df = df[df["timestamp"] >= cutoff]

    if df.empty:
        return pd.DataFrame(
            columns=[
                "lot_id",
                "academic_period",
                "day_of_week",
                "hour",
                "baseline_occupancy_rate",
                "coverage_days",
            ]
        )

    # Extract time components
    if "hour" not in df.columns or "day_of_week" not in df.columns:
        df = extract_time_components(df, "timestamp")

    # Add unique date for coverage counting
    if "date" not in df.columns:
        df["date"] = df["timestamp"].dt.strftime("%Y-%m-%d")

    group_cols = ["lot_id", "academic_period", "day_of_week", "hour"]

    # Compute baseline occupancy rate
    mean_rates = (
        df.groupby(group_cols)["occupancy_rate"]
        .mean()
        .rename("baseline_occupancy_rate")
    )
    coverage = df.groupby(group_cols)["date"].nunique().rename("coverage_days")
    baseline = pd.concat([mean_rates, coverage], axis=1).reset_index()

    # Compute global (day_of_week, hour) fallback for sparse groups
    global_mean = (
        df.groupby(["day_of_week", "hour"])["occupancy_rate"]
        .mean()
        .rename("global_mean")
        .reset_index()
    )

    # Apply fallback on sparse groups
    sparse_mask = baseline["coverage_days"] < _MIN_COVERAGE_DAYS
    if sparse_mask.any():
        n_sparse = sparse_mask.sum()
        logger.warning(
            "Baseline: %d groups have < %d coverage days; applying global fallback.",
            n_sparse,
            _MIN_COVERAGE_DAYS,
        )
        baseline = baseline.merge(global_mean, on=["day_of_week", "hour"], how="left")
        baseline.loc[sparse_mask, "baseline_occupancy_rate"] = baseline.loc[
            sparse_mask, "global_mean"
        ]
        baseline = baseline.drop(columns=["global_mean"])

    return baseline


def _lookup_baseline(
    df: pd.DataFrame,
    baseline: pd.DataFrame,
    global_mean: pd.Series,
) -> pd.Series:
    """
    Join baseline rates onto df rows using (lot_id, academic_period,
    day_of_week, hour). Falls back to global (day_of_week, hour) mean for
    any row with no baseline entry.

    Args:
        df: Feature DataFrame with lot_id, academic_period, day_of_week, hour.
        baseline: Output of compute_baseline().
        global_mean: Series indexed by (day_of_week, hour).

    Returns:
        Series of baseline_occupancy_rate values aligned to df.index.
    """
    merged = df[["lot_id", "academic_period", "day_of_week", "hour"]].merge(
        baseline[
            [
                "lot_id",
                "academic_period",
                "day_of_week",
                "hour",
                "baseline_occupancy_rate",
            ]
        ],
        on=["lot_id", "academic_period", "day_of_week", "hour"],
        how="left",
    )
    merged.index = df.index

    # Fill any missing baseline with global (day_of_week, hour) mean
    missing = merged["baseline_occupancy_rate"].isna()
    if missing.any():
        key = list(zip(df.loc[missing, "day_of_week"], df.loc[missing, "hour"]))
        fallback = pd.Series(
            [global_mean.get(k, 0.5) for k in key],
            index=df.index[missing],
        )
        merged.loc[missing, "baseline_occupancy_rate"] = fallback

    return merged["baseline_occupancy_rate"]


# =============================================================================
# Training Features
# =============================================================================


def prepare_training_features(
    df: pd.DataFrame,
    baseline: pd.DataFrame,
    min_confidence: Sequence[str] | None = ("HIGH", "MEDIUM"),
    rng: np.random.Generator | None = None,
) -> pd.DataFrame:
    """
    Prepare training data for the long-term XGBoost adjustment model.

    For each snapshot, computes the deviation from the historical baseline
    and assembles the Stage 2 feature set. The ``days_ahead`` feature is
    simulated via uniform random sampling in [1, 7] per row.

    Note on days_ahead simulation: In production inference, days_ahead
    reflects true forecast horizon. During training we don't have paired
    (snapshot, future-prediction) records, so we simulate it as a random
    feature. This teaches the model that accuracy degrades with horizon
    without introducing temporal leakage. Baseline values used here are
    not horizon-adjusted (pragmatic simplification — documented here).

    Args:
        df: Raw OccupancySnapshot DataFrame with columns: lot_id, timestamp,
            occupancy_rate, confidence, semester, academic_period,
            week_of_semester, is_campus_open. May include _source and
            is_cold_start for sample weighting.
        baseline: Output of compute_baseline().
        min_confidence: Accepted confidence levels.
        rng: Optional numpy random Generator for reproducibility.

    Returns:
        DataFrame ready for LongTermModel.train(), containing all Stage 2
        features plus target column ``deviation``.
    """
    if rng is None:
        rng = np.random.default_rng(42)

    df = prepare_base_features(df, min_confidence=min_confidence)
    df = df[df["hour"].isin(PREDICTION_HOURS)].copy()

    if df.empty:
        return _empty_training_df()

    # Build global (day_of_week, hour) fallback for baseline lookup
    global_mean = df.groupby(["day_of_week", "hour"])["occupancy_rate"].mean()
    global_mean.index = list(
        zip(
            global_mean.index.get_level_values(0), global_mean.index.get_level_values(1)
        )
    )

    df["historical_baseline"] = _lookup_baseline(df, baseline, global_mean)
    df["deviation"] = df["occupancy_rate"] - df["historical_baseline"]

    # Simulate days_ahead in [1, 7] — teach the model horizon-dependent degradation
    df["days_ahead"] = rng.integers(1, 8, size=len(df))

    df = add_hour_encoding(df)
    df = add_day_encoding(df)

    # Carry weight-related metadata columns through if present
    _weight_cols = [c for c in ("_source", "is_cold_start") if c in df.columns]

    keep_cols = [
        "lot_id",
        "historical_baseline",
        "days_ahead",
        "day_of_week",
        "hour",
        "week_of_semester",
        "is_campus_open",
        "semester",
        "academic_period",
        "sin_hour",
        "cos_hour",
        "sin_day",
        "cos_day",
        "deviation",
    ] + _weight_cols

    available = [c for c in keep_cols if c in df.columns]
    return df[available].reset_index(drop=True)


def _empty_training_df() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "lot_id",
            "historical_baseline",
            "days_ahead",
            "day_of_week",
            "hour",
            "week_of_semester",
            "is_campus_open",
            "semester",
            "academic_period",
            "sin_hour",
            "cos_hour",
            "sin_day",
            "cos_day",
            "deviation",
        ]
    )


# =============================================================================
# Inference Features
# =============================================================================


def _empty_inference_df() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "lot_id",
            "target_date",
            "target_hour",
            "days_ahead",
            "day_of_week",
            "hour",
            "week_of_semester",
            "is_campus_open",
            "semester",
            "academic_period",
            "is_cold_start",
            "historical_baseline",
            "sin_hour",
            "cos_hour",
            "sin_day",
            "cos_day",
        ]
    )
