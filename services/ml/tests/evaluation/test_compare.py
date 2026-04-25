"""
Tests for model comparison logic (src.evaluation.compare).

Covers:
    - Promotion criteria: no production model, with improvement, insufficient improvement
    - Directional accuracy promotion path
    - Baseline gate: candidate must beat all baselines
    - compare_models: results dict, baseline_passed, pre-computed baseline path
    - build_promotion_reason: reason string for all outcomes
    - Horizon-stratified MAE gate (long-term): per-day targets, missing horizons, custom targets
    - build_horizon_promotion_reason: reason string for horizon gate outcomes
    - compare_against_long_term_baselines: coverage-gated baseline selection

Run from services/ml/:
    python -m pytest tests/evaluation/test_compare.py -v
"""

import pytest

import numpy as np
import pandas as pd

from src.evaluation.compare import (
    HORIZON_MAE_TARGETS,
    beats_baselines,
    build_horizon_promotion_reason,
    build_promotion_reason,
    compare_against_long_term_baselines,
    compare_models,
    meets_horizon_targets,
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
    # with ≥4 obs each). 8 weeks of operating-hours snapshots covers this.
    all_timestamps = pd.date_range("2025-01-06", periods=8 * 7 * 24, freq="h")
    timestamps = all_timestamps[all_timestamps.hour.isin(range(7, 22))]
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

    def test_baseline_passed_when_candidate_wins(self, test_data):
        """Candidate with low MAE should pass the baseline gate."""
        test_features, raw_df = test_data
        candidate = {"mae": 0.05, "rmse": 0.06, "mape": 10.0}

        result = compare_models(candidate, test_features, raw_df, total_lots=1)

        assert result["baseline_passed"] is True
        assert result["failed_baselines"] == []

    def test_baseline_failed_when_candidate_loses(self, test_data):
        """Candidate with high MAE should fail the baseline gate."""
        test_features, raw_df = test_data
        candidate = {"mae": 0.99, "rmse": 0.99, "mape": 99.0}

        result = compare_models(candidate, test_features, raw_df, total_lots=1)

        assert result["baseline_passed"] is False
        assert len(result["failed_baselines"]) > 0

    def test_precomputed_baselines_used_when_provided(self, test_data):
        """Pre-supplied baseline_results are used directly, bypassing coverage-gated computation."""
        test_features, raw_df = test_data
        candidate = {"mae": 0.05, "rmse": 0.06, "mape": 10.0}
        baseline_results = {"CustomBaseline": {"mae": 0.10, "rmse": 0.12, "mape": 15.0}}

        result = compare_models(
            candidate,
            test_features,
            raw_df,
            total_lots=1,
            baseline_results=baseline_results,
        )
        assert "CustomBaseline" in result["results"]

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

        result = compare_models(
            candidate, test_features, raw_df, production, total_lots=1
        )

        assert "Production" in result["results"]


# =============================================================================
# Promotion Reason Builder
# =============================================================================


class TestBuildPromotionReason:
    """Verify build_promotion_reason covers all outcomes."""

    def test_baseline_failed(self):
        reason = build_promotion_reason(
            {"mae": 0.09},
            None,
            should_promote=False,
            baseline_passed=False,
            failed_baselines=["Persistence"],
        )
        assert "Persistence" in reason
        assert "Not promoted" in reason

    def test_first_deployment(self):
        reason = build_promotion_reason(
            {"mae": 0.05},
            None,
            should_promote=True,
            baseline_passed=True,
            failed_baselines=[],
        )
        assert "first deployment" in reason.lower()

    def test_mae_improvement(self):
        reason = build_promotion_reason(
            {"mae": 0.08},
            {"mae": 0.10},
            should_promote=True,
            baseline_passed=True,
            failed_baselines=[],
        )
        assert "MAE improved" in reason

    def test_directional_accuracy_improvement(self):
        reason = build_promotion_reason(
            {"mae": 0.08, "directional_accuracy": 76.0},
            {"mae": 0.08, "directional_accuracy": 72.0},
            should_promote=True,
            baseline_passed=True,
            failed_baselines=[],
        )
        assert "Directional accuracy" in reason

    def test_not_promoted_with_details(self):
        # MAE improved but not by >= 5% — not promoted
        reason = build_promotion_reason(
            {"mae": 0.099},
            {"mae": 0.100},
            should_promote=False,
            baseline_passed=True,
            failed_baselines=[],
        )
        assert "Not promoted" in reason
        assert "MAE improved" in reason


# =============================================================================
# Horizon-stratified gate (long-term)
# =============================================================================


class TestHorizonGate:
    """Verify per-horizon MAE targets gate long-term promotion."""

    def test_all_horizons_pass(self):
        horizon_mae = {d: t - 0.01 for d, t in HORIZON_MAE_TARGETS.items()}
        passed, failed = meets_horizon_targets(horizon_mae)
        assert passed is True
        assert failed == []

    def test_day1_fails(self):
        horizon_mae = {d: HORIZON_MAE_TARGETS[d] - 0.01 for d in HORIZON_MAE_TARGETS}
        horizon_mae[1] = HORIZON_MAE_TARGETS[1] + 0.05
        passed, failed = meets_horizon_targets(horizon_mae)

        assert passed is False
        assert failed == [1]

    def test_multiple_days_fail(self):
        horizon_mae = {d: HORIZON_MAE_TARGETS[d] - 0.01 for d in HORIZON_MAE_TARGETS}
        for d in (1, 2, 3):
            horizon_mae[d] = HORIZON_MAE_TARGETS[d] + 0.05
        passed, failed = meets_horizon_targets(horizon_mae)

        assert passed is False
        assert set(failed) == {1, 2, 3}

    def test_missing_horizon_skipped(self, caplog):
        """Horizons not in horizon_mae should be ignored, not counted as failures."""
        import logging

        horizon_mae = {1: 0.08, 2: 0.09}  # no days 3-7 in dict
        with caplog.at_level(logging.WARNING, logger="src.evaluation.compare"):
            passed, failed = meets_horizon_targets(horizon_mae)

        assert passed is True
        assert failed == []

        missing = [
            int(r.message.split()[2]) for r in caplog.records if "missing" in r.message
        ]
        assert set(missing) == {3, 4, 5, 6, 7}

    def test_custom_targets(self):
        """Caller-supplied targets override the default."""
        horizon_mae = {1: 0.08, 2: 0.08}
        custom_targets = {1: 0.05, 2: 0.05}
        passed, failed = meets_horizon_targets(horizon_mae, targets=custom_targets)

        assert passed is False
        assert set(failed) == {1, 2}

    def test_equal_to_target_passes(self):
        """MAE exactly at target should pass (<=, not strict <)."""
        horizon_mae = HORIZON_MAE_TARGETS.copy()
        passed, failed = meets_horizon_targets(horizon_mae)

        assert passed is True
        assert failed == []


class TestBuildHorizonPromotionReason:
    def test_passed_returns_none(self):
        assert build_horizon_promotion_reason(True, []) is None

    def test_failure_lists_days(self):
        reason = build_horizon_promotion_reason(False, [1, 2])
        assert "Day 1" in reason
        assert "Day 2" in reason
        assert "Not promoted" in reason


# =============================================================================
# Long-term baseline comparison (coverage-gated)
# =============================================================================


@pytest.fixture
def long_term_test_data():
    """Test features and raw_df for long-term baseline comparison tests."""
    np.random.seed(42)

    # Build raw_df with enough coverage to pass all gates
    all_timestamps = pd.date_range("2025-10-01", periods=8 * 7 * 24, freq="h")
    timestamps = all_timestamps[all_timestamps.hour.isin(range(7, 22))]
    raw_df = pd.DataFrame(
        {
            "lot_id": "G1",
            "timestamp": timestamps,
            "occupancy_rate": np.random.uniform(0.2, 0.8, len(timestamps)),
        }
    )

    # Test features with historical_baseline, lot_id, day_of_week, hour
    test_features = pd.DataFrame(
        {
            "lot_id": ["G1"] * 10,
            "day_of_week": [0, 1, 2, 3, 4, 5, 6, 0, 1, 2],
            "hour": [10] * 10,
            "historical_baseline": [0.5] * 10,
        }
    )
    actual_rates = np.array([0.5] * 10)
    return test_features, raw_df, actual_rates


class TestCompareAgainstLongTermBaselines:
    def test_includes_all_baselines_when_coverage_is_high(self, long_term_test_data):
        test_features, raw_df, actuals = long_term_test_data
        candidate = {"mae": 0.05, "rmse": 0.06, "mape": 10.0}

        results = compare_against_long_term_baselines(
            candidate, test_features, raw_df, actuals, total_lots=1
        )

        assert "Candidate" in results
        assert "MajorityClass" in results
        assert "SameDayLastWeek" in results
        assert "HistoricalAverage" in results

    def test_skips_baselines_when_coverage_too_low(self, long_term_test_data):
        test_features, raw_df, actuals = long_term_test_data
        candidate = {"mae": 0.05, "rmse": 0.06, "mape": 10.0}

        # Keep only 2 rows of raw_df == below the 30% skip threshold
        sparse_raw = raw_df.head(2)

        results = compare_against_long_term_baselines(
            candidate, test_features, sparse_raw, actuals, total_lots=1
        )

        # All baselines skipped
        assert results == {"Candidate": candidate}
