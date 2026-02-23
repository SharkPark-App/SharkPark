"""
Naive baseline models for SharkPark ML.

These baselines provide floor benchmarks that trained models must beat.
A new model must reduce MAE by >=5% vs the best baseline to be promoted.

Baselines:
    - PersistenceBaseline: current occupancy stays the same
    - MajorityClassBaseline: always predict global median
"""

import numpy as np
import pandas as pd

from src.evaluation.metrics import compute_metrics


# =============================================================================
# Persistence Baseline
# =============================================================================


class PersistenceBaseline:
    """
    Predict that current occupancy stays the same for all future hours.
    Use Case: Short-Term

    Note: predict() is scaffolding for future API inference use.
    Currently only evaluate() is wired up (via compare.py).
    """

    def predict(self, *args, **kwargs):
        # TODO: Wire up for real-time API inference.
        # Should take recent snapshots + lot_ids, return the latest
        # occupancy_rate repeated for each remaining PREDICTION_HOURS.
        raise NotImplementedError("predict() not yet wired up for inference")

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
# Majority Class Baseline
# =============================================================================


class MajorityClassBaseline:
    """
    Always predict the global median occupancy rate.
    Use Case: Short-term, Long-term

    Note: predict() is scaffolding for future API inference use.
    Currently only evaluate() is wired up (via compare.py).
    """

    def predict(self, *args, **kwargs):
        # TODO: Wire up for real-time API inference.
        # Should take historical snapshots + lot_ids, return global median
        # occupancy_rate for each lot × each PREDICTION_HOURS slot.
        raise NotImplementedError("predict() not yet wired up for inference")

    @staticmethod
    def evaluate(test_features: pd.DataFrame, raw_df: pd.DataFrame) -> dict:
        """
        Evaluate majority-class baseline on test features.

        Args:
            test_features: Test set with target_occupancy_rate.
            raw_df: Raw snapshot DataFrame used to compute global median.

        Returns:
            Metrics dict from compute_metrics().
        """
        median_rate = raw_df["occupancy_rate"].median()
        if np.isnan(median_rate):
            median_rate = 0.5
        actuals = test_features["target_occupancy_rate"].values

        preds = np.full_like(actuals, fill_value=median_rate, dtype=float)

        return compute_metrics(actuals, preds)
