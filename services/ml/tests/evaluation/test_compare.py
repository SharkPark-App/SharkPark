"""
Tests for model comparison logic (src.evaluation.compare).

Covers:
    - Promotion criteria: no production model, with improvement, insufficient improvement
    - Directional accuracy promotion path

Run from services/ml/:
    python -m pytest tests/evaluation/test_compare.py -v
"""

import pytest

import numpy as np
import pandas as pd

from src.evaluation.compare import (
    beats_baselines,
    compare_models,
    meets_promotion_criteria,
)


class TestPromotionCriteria:
    """Verify promotion decision logic."""

    def test_no_production_model_always_promotes(self):
        """First model deployment: always promote."""
        candidate = {"mae": 0.08, "rmse": 0.10, "mape": 12.0}

        assert meets_promotion_criteria(candidate, production_metrics=None) is True

    def test_mae_improved_by_5_percent(self):
        """MAE improved by exactly 5% — should promote."""
        production = {"mae": 0.100}
        candidate = {"mae": 0.095}  # 5% improvement

        assert meets_promotion_criteria(candidate, production) is True

    def test_mae_improved_by_more_than_5_percent(self):
        """MAE improved by >5% — should promote."""
        production = {"mae": 0.100}
        candidate = {"mae": 0.080}  # 20% improvement

        assert meets_promotion_criteria(candidate, production) is True

    def test_mae_not_improved_enough(self):
        """MAE improved by <5% — should NOT promote."""
        production = {"mae": 0.100}
        candidate = {"mae": 0.098}  # 2% improvement

        assert meets_promotion_criteria(candidate, production) is False

    def test_mae_worse(self):
        """MAE is worse — should NOT promote."""
        production = {"mae": 0.08}
        candidate = {"mae": 0.10}

        assert meets_promotion_criteria(candidate, production) is False

    def test_directional_accuracy_improved_by_3pp(self):
        """Directional accuracy improved by >=3 pp — should promote even if MAE didn't improve."""
        production = {"mae": 0.08, "directional_accuracy": 70.0}
        candidate = {"mae": 0.08, "directional_accuracy": 73.0}

        assert meets_promotion_criteria(candidate, production) is True

    def test_directional_accuracy_not_enough(self):
        """Directional accuracy improved by <3 pp, MAE same — should NOT promote."""
        production = {"mae": 0.08, "directional_accuracy": 70.0}
        candidate = {"mae": 0.08, "directional_accuracy": 72.0}

        assert meets_promotion_criteria(candidate, production) is False


class TestBaselineGate:
    """Verify candidate must beat all baselines on MAE."""

    def test_candidate_beats_all_baselines(self):
        """Candidate MAE lower than all baselines — passes."""
        candidate = {"mae": 0.05}
        results = {
            "Candidate": candidate,
            "Persistence": {"mae": 0.08},
            "MajorityClass": {"mae": 0.10},
        }

        passed, failed = beats_baselines(candidate, results)
        assert passed is True
        assert failed == []

    def test_candidate_worse_than_persistence(self):
        """Candidate MAE >= persistence — fails."""
        candidate = {"mae": 0.09}
        results = {
            "Candidate": candidate,
            "Persistence": {"mae": 0.08},
            "MajorityClass": {"mae": 0.10},
        }

        passed, failed = beats_baselines(candidate, results)
        assert passed is False
        assert "Persistence" in failed

    def test_candidate_worse_than_all_baselines(self):
        """Candidate MAE >= all baselines — fails with both listed."""
        candidate = {"mae": 0.12}
        results = {
            "Candidate": candidate,
            "Persistence": {"mae": 0.08},
            "MajorityClass": {"mae": 0.10},
        }

        passed, failed = beats_baselines(candidate, results)
        assert passed is False
        assert "Persistence" in failed
        assert "MajorityClass" in failed

    def test_candidate_equal_to_baseline_does_not_pass(self):
        """Candidate MAE exactly equal to baseline — does not pass (must be strictly lower)."""
        candidate = {"mae": 0.08}
        results = {
            "Candidate": candidate,
            "Persistence": {"mae": 0.08},
        }

        passed, failed = beats_baselines(candidate, results)
        assert passed is False

    def test_production_entry_is_skipped(self):
        """Production entry in results should not be treated as a baseline."""
        candidate = {"mae": 0.05}
        results = {
            "Candidate": candidate,
            "Production": {"mae": 0.04},
            "Persistence": {"mae": 0.08},
        }

        passed, _ = beats_baselines(candidate, results)
        assert passed is True


# =============================================================================
# Full Comparison (compare_models)
# =============================================================================


@pytest.fixture
def test_data():
    """Minimal test features and raw DataFrame for compare_models."""
    np.random.seed(42)
    n = 50
    test_features = pd.DataFrame(
        {
            "lot_id": ["G1"] * n,
            "occupancy_rate": np.random.uniform(0.3, 0.7, n),
            "target_occupancy_rate": np.random.uniform(0.3, 0.7, n),
        }
    )
    # Build raw_df with timestamp and lot_id so compute_data_coverage works.
    # Need enough data to exceed full coverage threshold (60% of 7 days × 15 hours
    # with ≥4 obs each). 8 weeks of hourly data during operating hours covers this.
    timestamps = pd.date_range("2025-01-06", periods=8 * 7 * 24, freq="h")
    raw_df = pd.DataFrame(
        {
            "lot_id": "G1",
            "timestamp": timestamps,
            "occupancy_rate": np.random.uniform(0.2, 0.8, len(timestamps)),
        }
    )
    return test_features, raw_df


class TestCompareModels:
    """Verify full comparison pipeline."""

    def test_first_deployment_promotes(self, test_data):
        """No production model — should promote."""
        test_features, raw_df = test_data
        candidate = {"mae": 0.05, "rmse": 0.06, "mape": 10.0}

        result = compare_models(
            candidate, test_features, raw_df, production_metrics=None, total_lots=1
        )

        assert result["should_promote"] is True
        assert "first deployment" in result["promotion_reason"].lower()

    def test_candidate_beats_production(self, test_data):
        """Candidate significantly better than production — should promote."""
        test_features, raw_df = test_data
        candidate = {"mae": 0.05, "rmse": 0.06, "mape": 10.0}
        production = {"mae": 0.10, "rmse": 0.12, "mape": 18.0}

        result = compare_models(candidate, test_features, raw_df, production, total_lots=1)

        assert result["should_promote"] is True
        assert "MAE improved" in result["promotion_reason"]

    def test_candidate_not_enough_improvement(self, test_data):
        """Candidate only marginally better — should NOT promote."""
        test_features, raw_df = test_data
        candidate = {"mae": 0.049, "rmse": 0.06, "mape": 10.0}
        production = {"mae": 0.050, "rmse": 0.06, "mape": 10.0}

        result = compare_models(candidate, test_features, raw_df, production, total_lots=1)

        assert result["should_promote"] is False
        assert "Not promoted" in result["promotion_reason"]

    def test_directional_accuracy_promotion(self, test_data):
        """Directional accuracy improvement triggers promotion."""
        test_features, raw_df = test_data
        candidate = {
            "mae": 0.05,
            "rmse": 0.06,
            "mape": 10.0,
            "directional_accuracy": 78.0,
        }
        production = {
            "mae": 0.05,
            "rmse": 0.06,
            "mape": 10.0,
            "directional_accuracy": 74.0,
        }

        result = compare_models(candidate, test_features, raw_df, production, total_lots=1)

        assert result["should_promote"] is True
        assert "Directional accuracy" in result["promotion_reason"]

    def test_results_include_baselines(self, test_data):
        """Results dict should include Candidate, Persistence, MajorityClass."""
        test_features, raw_df = test_data
        candidate = {"mae": 0.05, "rmse": 0.06, "mape": 10.0}

        result = compare_models(candidate, test_features, raw_df, total_lots=1)

        assert "Candidate" in result["results"]
        assert "Persistence" in result["results"]
        assert "MajorityClass" in result["results"]

    def test_results_include_production_when_provided(self, test_data):
        """Production metrics should appear in results when given."""
        test_features, raw_df = test_data
        candidate = {"mae": 0.05, "rmse": 0.06, "mape": 10.0}
        production = {"mae": 0.10, "rmse": 0.12, "mape": 18.0}

        result = compare_models(candidate, test_features, raw_df, production, total_lots=1)

        assert "Production" in result["results"]
