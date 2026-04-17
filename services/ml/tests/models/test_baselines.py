"""
Tests for naive baseline models (src.models.baselines).

Covers:
    - PersistenceBaseline: evaluate and predict scaffolding (short-term)
    - MajorityClassBaseline: evaluate and predict scaffolding (both)
    - HistoricalAverageBaseline: predict the Stage 1 baseline (long-term)
    - SameDayLastWeekBaseline: carry last week's same-slot actual (long-term)

Run from services/ml/:
    python -m pytest tests/models/test_baselines.py -v
"""

import numpy as np
import pandas as pd
import pytest

from src.models.baselines import (
    HistoricalAverageBaseline,
    MajorityClassBaseline,
    PersistenceBaseline,
    SameDayLastWeekBaseline,
)


# =============================================================================
# PersistenceBaseline
# =============================================================================


class TestPersistenceBaseline:
    def test_evaluate_returns_metrics(self):
        test_features = pd.DataFrame(
            {
                "occupancy_rate": [0.5, 0.6, 0.7],
                "target_occupancy_rate": [0.5, 0.6, 0.7],
            }
        )
        result = PersistenceBaseline.evaluate(test_features)
        assert "mae" in result
        assert result["mae"] == pytest.approx(0.0)

    def test_evaluate_empty_features(self):
        """Empty test set should return neutral metrics."""
        test_features = pd.DataFrame(
            {
                "occupancy_rate": pd.Series([], dtype=float),
                "target_occupancy_rate": pd.Series([], dtype=float),
            }
        )
        result = PersistenceBaseline.evaluate(test_features)
        assert "mae" in result


# =============================================================================
# MajorityClassBaseline
# =============================================================================


class TestMajorityClassBaseline:
    def test_evaluate_returns_metrics(self):
        raw_df = pd.DataFrame(
            {
                "occupancy_rate": [0.5, 0.5, 0.5],
            }
        )
        test_features = pd.DataFrame(
            {
                "target_occupancy_rate": [0.5, 0.5, 0.5],
            }
        )
        result = MajorityClassBaseline.evaluate(test_features, raw_df)
        assert "mae" in result
        assert result["mae"] == pytest.approx(0.0)

    def test_evaluate_uses_median(self):
        """Predictions should be the global median of raw data."""
        raw_df = pd.DataFrame(
            {
                "occupancy_rate": [0.2, 0.4, 0.6, 0.8, 1.0],
            }
        )
        test_features = pd.DataFrame(
            {
                "target_occupancy_rate": [0.6],
            }
        )
        result = MajorityClassBaseline.evaluate(test_features, raw_df)
        # Median of raw is 0.6, target is 0.6, so MAE should be 0
        assert result["mae"] == pytest.approx(0.0)

    def test_evaluate_accepts_explicit_actuals(self):
        """Long-term path: caller provides pre-computed actuals."""
        raw_df = pd.DataFrame({"occupancy_rate": [0.5, 0.5, 0.5]})
        test_features = pd.DataFrame({"lot_id": ["G1", "G1", "G1"]})
        actuals = np.array([0.5, 0.5, 0.5])
        result = MajorityClassBaseline.evaluate(test_features, raw_df, actuals=actuals)
        assert result["mae"] == pytest.approx(0.0)


# =============================================================================
# HistoricalAverageBaseline
# =============================================================================


class TestHistoricalAverageBaseline:
    def test_evaluate_predicts_baseline(self):
        """Predictions should equal the historical_baseline column."""
        test_features = pd.DataFrame(
            {
                "historical_baseline": [0.3, 0.5, 0.7],
            }
        )
        actuals = np.array([0.3, 0.5, 0.7])
        result = HistoricalAverageBaseline.evaluate(test_features, actuals)
        assert result["mae"] == pytest.approx(0.0)

    def test_evaluate_mae_when_actuals_differ(self):
        """MAE should equal mean absolute error between baseline and actuals."""
        test_features = pd.DataFrame(
            {
                "historical_baseline": [0.5, 0.5, 0.5],
            }
        )
        actuals = np.array([0.4, 0.5, 0.6])
        result = HistoricalAverageBaseline.evaluate(test_features, actuals)
        assert result["mae"] == pytest.approx(0.0667, abs=1e-3)

    def test_evaluate_missing_column_raises(self):
        """Missing historical_baseline column should raise."""
        test_features = pd.DataFrame({"other": [0.5]})
        with pytest.raises(ValueError, match="historical_baseline"):
            HistoricalAverageBaseline.evaluate(test_features, np.array([0.5]))

    def test_evaluate_clips_predictions_to_unit_range(self):
        """Predictions should be clipped to [0, 1]."""
        test_features = pd.DataFrame(
            {
                "historical_baseline": [-0.2, 0.5, 1.5],
            }
        )
        actuals = np.array([0.0, 0.5, 1.0])
        result = HistoricalAverageBaseline.evaluate(test_features, actuals)
        assert result["mae"] == pytest.approx(0.0)


# =============================================================================
# SameDayLastWeekBaseline
# =============================================================================


class TestSameDayLastWeekBaseline:
    def test_evaluate_uses_last_observation_per_slot(self):
        """Predictions should equal the most recent same-slot occupancy in raw."""
        # Two weeks of Mondays at 10am for G1
        raw_df = pd.DataFrame(
            {
                "lot_id": ["G1", "G1"],
                "timestamp": pd.to_datetime(
                    ["2026-01-05T10:00:00", "2026-01-12T10:00:00"]
                ),
                "occupancy_rate": [0.4, 0.6],
            }
        )
        test_features = pd.DataFrame(
            {
                "lot_id": ["G1"],
                "day_of_week": [0],  # Monday
                "hour": [10],
            }
        )

        actuals = np.array([0.6])
        result = SameDayLastWeekBaseline.evaluate(test_features, raw_df, actuals)
        assert result["mae"] == pytest.approx(0.0)

    def test_evaluate_falls_back_to_global_median_for_missing_slot(self):
        """Slots never observed should fall back to the global median."""
        raw_df = pd.DataFrame(
            {
                "lot_id": ["G1"],
                "timestamp": pd.to_datetime(["2026-01-05T10:00:00"]),
                "occupancy_rate": [0.5],
            }
        )
        test_features = pd.DataFrame(
            {
                "lot_id": ["G2"],  # different lot, no history
                "day_of_week": [0],
                "hour": [10],
            }
        )
        actuals = np.array([0.5])
        result = SameDayLastWeekBaseline.evaluate(test_features, raw_df, actuals)
        assert result["mae"] == pytest.approx(0.0)

    def test_evaluate_missing_columns_raises(self):
        """Missing required columns should raise."""
        test_features = pd.DataFrame({"lot_id": ["G1"]})
        raw_df = pd.DataFrame(
            {
                "lot_id": ["G1"],
                "timestamp": pd.to_datetime(["2026-01-05T10:00:00"]),
                "occupancy_rate": [0.5],
            }
        )
        with pytest.raises(ValueError, match="missing required columns"):
            SameDayLastWeekBaseline.evaluate(test_features, raw_df, np.array([0.5]))
