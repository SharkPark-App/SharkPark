"""
Naive baseline models for SharkPark ML.

These baselines provide floor benchmarks that trained models must beat.
A new model must reduce MAE by >=5% vs the best baseline to be promoted.

Baselines:
    - PersistenceBaseline: current occupancy stays the same (short-term)
    - MajorityClassBaseline: always predict global median (both)
    - HistoricalAverageBaseline: predict the Stage 1 baseline rate (long-term)
    - SameDayLastWeekBaseline: predict last week's same-slot actual (long-term)
"""

import numpy as np
import pandas as pd

from src.evaluation.metrics import compute_metrics

__all__ = [
    "PersistenceBaseline",
    "MajorityClassBaseline",
    "HistoricalAverageBaseline",
    "SameDayLastWeekBaseline",
]


# =============================================================================
# Persistence Baseline
# =============================================================================


class PersistenceBaseline:
    """
    Predict that current occupancy stays the same for all future hours.
    Use Case: Short-Term
    """

    def predict(self, current_rate: float, horizons: int = 1) -> np.ndarray:
        """Trivial predict: repeat current rate for all future horizons.

        When the API inference path is built, this should accept recent
        snapshots + lot_ids and return per-lot predictions.
        """
        return np.full(horizons, fill_value=current_rate, dtype=float)

    @staticmethod
    def evaluate(test_features: pd.DataFrame) -> dict:
        """
        Evaluate persistence baseline on test features.

        Persistence predicts current occupancy_rate for all future hours.

        Args:
            test_features: Test set with occupancy_rate and target_occupancy_rate.

        Returns:
            Metrics dict from compute_metrics().
        """
        actuals = test_features["target_occupancy_rate"].values

        # Persistence baseline in this sense is for the
        # prediction to be the same as current value
        preds = test_features["occupancy_rate"].values

        # Return neutral results if empty sets
        if len(actuals) == 0:
            return compute_metrics(np.array([0.5]), np.array([0.5]))

        return compute_metrics(actuals, preds)


# =============================================================================
# Majority Class Baseline (Both)
# =============================================================================


class MajorityClassBaseline:
    """
    Always predict the global median occupancy rate.
    Use Case: Short-term, Long-term
    """

    def predict(self, raw_df: pd.DataFrame, horizons: int = 1) -> np.ndarray:
        """Trivial predict: return global median for all future horizons.

        When the API inference path is built, this should accept historical
        snapshots + lot_ids and return per-lot median predictions.
        """
        median_rate = raw_df["occupancy_rate"].median()
        if np.isnan(median_rate):
            median_rate = 0.5
        return np.full(horizons, fill_value=median_rate, dtype=float)

    @staticmethod
    def evaluate(
        test_features: pd.DataFrame,
        raw_df: pd.DataFrame,
        actuals: np.ndarray | None = None,
    ) -> dict:
        """
        Evaluate majority-class baseline on test features.

        Args:
            test_features: Test set with target_occupancy_rate (short-term)
                or used for row count only (long-term, when actuals provided).
            raw_df: Raw snapshot DataFrame used to compute global median.
            actuals: Optional pre-computed actual occupancy rates. If not
                provided, falls back to test_features["target_occupancy_rate"].

        Returns:
            Metrics dict from compute_metrics().
        """
        median_rate = raw_df["occupancy_rate"].median()
        if np.isnan(median_rate):
            median_rate = 0.5

        if actuals is None:
            actuals = test_features["target_occupancy_rate"].values

        preds = np.full_like(actuals, fill_value=median_rate, dtype=float)

        return compute_metrics(actuals, preds)


# =============================================================================
# Historical Average Baseline (long-term)
# =============================================================================


class HistoricalAverageBaseline:
    """
    Predict the historical baseline rate for each (lot_id, academic_period,
    day_of_week, hour) slot — i.e., "typical occupancy for this slot."

    Use Case: Long-term

    For the long-term two-stage model, this is equivalent to "predict deviation
    = 0" — it returns the Stage 1 baseline unchanged. A candidate that fails
    to beat this baseline is not learning useful adjustments.
    """

    @staticmethod
    def evaluate(
        test_features: pd.DataFrame,
        actual_rates: np.ndarray,
    ) -> dict:
        """
        Evaluate historical-average baseline on long-term test features.

        Args:
            test_features: Test set with historical_baseline column.
            actual_rates: Array of actual occupancy rates (0-1 scale).

        Returns:
            Metrics dict from compute_metrics().
        """
        if "historical_baseline" not in test_features.columns:
            raise ValueError("test_features must include historical_baseline column")
        preds = np.clip(test_features["historical_baseline"].values, 0.0, 1.0)
        return compute_metrics(actual_rates, preds)


# =============================================================================
# Same-Day-Last-Week Baseline (long-term)
# =============================================================================


class SameDayLastWeekBaseline:
    """
    Predict that next Thursday 10am = last Thursday 10am for the same lot.

    Use Case: Long-term

    For each (lot_id, day_of_week, hour) slot in the test set, uses the most
    recent observation of that slot in the training window as the prediction.

    Note: long-term features don't store the real target date, so we can't
    do an exact 7-day lookback per row. Instead we use the most recent
    training observation for each (lot_id, dow, hour) slot.
    """

    @staticmethod
    def evaluate(
        test_features: pd.DataFrame,
        raw_df: pd.DataFrame,
        actual_rates: np.ndarray,
    ) -> dict:
        """
        Evaluate same-day-last-week baseline on long-term test features.

        Args:
            test_features: Test set with lot_id, day_of_week, hour columns.
            raw_df: Raw snapshot DataFrame. Used to look up the most recent
                prior occupancy per (lot_id, dow, hour) slot.
            actual_rates: Array of actual occupancy rates (0-1 scale).

        Returns:
            Metrics dict from compute_metrics(). Falls back to the global
            median for any slot with no prior observation.
        """
        required = {"lot_id", "day_of_week", "hour"}
        missing = required - set(test_features.columns)
        if missing:
            raise ValueError(
                f"test_features missing required columns: {sorted(missing)}"
            )

        raw = raw_df.copy()
        raw["timestamp"] = pd.to_datetime(raw["timestamp"])
        raw["_hour"] = raw["timestamp"].dt.hour
        raw["_dow"] = raw["timestamp"].dt.dayofweek

        # Most recent observation per (lot_id, dow, hour) in the raw data
        last_seen = (
            raw.sort_values("timestamp")
            .groupby(["lot_id", "_dow", "_hour"])["occupancy_rate"]
            .last()
            .rename("last_week_rate")
            .reset_index()
            .rename(columns={"_dow": "day_of_week", "_hour": "hour"})
        )

        merged = test_features[["lot_id", "day_of_week", "hour"]].merge(
            last_seen,
            on=["lot_id", "day_of_week", "hour"],
            how="left",
        )

        # Fallback for slots never observed: global median
        global_median = raw["occupancy_rate"].median()
        if np.isnan(global_median):
            global_median = 0.5
        preds = merged["last_week_rate"].fillna(global_median).clip(0.0, 1.0).values

        return compute_metrics(actual_rates, preds)
