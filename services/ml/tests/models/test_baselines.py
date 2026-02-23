"""
Tests for naive baseline models (src.models.baselines).

Covers:
    - PersistenceBaseline: evaluate and predict scaffolding
    - MajorityClassBaseline: evaluate and predict scaffolding

Run from services/ml/:
    python -m pytest tests/models/test_baselines.py -v
"""

import pandas as pd
import pytest

from src.models.baselines import MajorityClassBaseline, PersistenceBaseline


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
