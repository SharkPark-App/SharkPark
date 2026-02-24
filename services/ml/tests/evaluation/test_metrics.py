"""
Tests for evaluation metrics (src.evaluation.metrics).

Covers:
    - MAE, RMSE, MAPE computation with known inputs
    - MAE target threshold check
    - Directional accuracy computation

Run from services/ml/:
    python -m pytest tests/evaluation/test_metrics.py -v
"""

import numpy as np
import pytest

from src.evaluation.metrics import (
    compute_metrics,
    meets_mae_target,
    compute_directional_accuracy,
)


class TestComputeMetrics:
    """Verify MAE, RMSE, MAPE computation for known inputs."""

    def test_perfect_predictions(self):
        """All metrics should be zero for perfect predictions."""
        y_true = np.array([0.5, 0.6, 0.7])
        y_pred = np.array([0.5, 0.6, 0.7])

        metrics = compute_metrics(y_true, y_pred)

        assert metrics["mae"] == pytest.approx(0.0)
        assert metrics["rmse"] == pytest.approx(0.0)
        assert metrics["mape"] == pytest.approx(0.0)

    def test_mae_known_values(self):
        """MAE of [0.5, 0.6] vs [0.4, 0.8] = mean(0.1, 0.2) = 0.15."""
        y_true = np.array([0.5, 0.6])
        y_pred = np.array([0.4, 0.8])

        metrics = compute_metrics(y_true, y_pred)

        assert metrics["mae"] == pytest.approx(0.15)

    def test_rmse_known_values(self):
        """RMSE of [1, 0] vs [0, 1] = sqrt(mean(1, 1)) = 1.0."""
        y_true = np.array([1.0, 0.0])
        y_pred = np.array([0.0, 1.0])

        metrics = compute_metrics(y_true, y_pred)

        assert metrics["rmse"] == pytest.approx(1.0)

    def test_mape_known_values(self):
        """MAPE of [0.5] vs [0.6] = |0.5 - 0.6| / 0.5 * 100 = 20%."""
        y_true = np.array([0.5])
        y_pred = np.array([0.6])

        metrics = compute_metrics(y_true, y_pred)

        assert metrics["mape"] == pytest.approx(20.0)

    def test_single_element(self):
        """Metrics should work with single-element arrays."""
        metrics = compute_metrics(np.array([0.8]), np.array([0.7]))

        assert metrics["mae"] == pytest.approx(0.1)
        assert metrics["rmse"] == pytest.approx(0.1)


class TestMeetsMAETarget:
    """Verify MAE target threshold logic."""

    def test_below_target(self):
        assert meets_mae_target(0.05) is True

    def test_above_target(self):
        assert meets_mae_target(0.15) is False

    def test_at_boundary(self):
        """MAE exactly at 0.10 should NOT meet the target"""
        assert meets_mae_target(0.10) is False

    def test_zero_mae(self):
        assert meets_mae_target(0.0) is True


class TestDirectionalAccuracy:
    """Verify directional accuracy computation."""

    def test_perfect_directional_accuracy(self):
        """All predictions match actual direction."""
        y_current = np.array([0.5, 0.5, 0.5])
        y_true = np.array([0.6, 0.4, 0.5])  # up, down, flat
        y_pred = np.array([0.7, 0.3, 0.5])  # up, down, flat

        accuracy = compute_directional_accuracy(y_true, y_pred, y_current)

        assert accuracy == pytest.approx(100.0)

    def test_zero_directional_accuracy(self):
        """All predictions are in the wrong direction."""
        y_current = np.array([0.5, 0.5])
        y_true = np.array([0.6, 0.4])  # up, down
        y_pred = np.array([0.4, 0.6])  # down, up

        accuracy = compute_directional_accuracy(y_true, y_pred, y_current)

        assert accuracy == pytest.approx(0.0)

    def test_partial_accuracy(self):
        """Half correct, half wrong."""
        y_current = np.array([0.5, 0.5])
        y_true = np.array([0.6, 0.4])
        y_pred = np.array([0.7, 0.6])  # correct, wrong

        accuracy = compute_directional_accuracy(y_true, y_pred, y_current)

        assert accuracy == pytest.approx(50.0)

    def test_empty_arrays(self):
        """Empty inputs should return 0."""
        accuracy = compute_directional_accuracy(
            np.array([]), np.array([]), np.array([])
        )
        assert accuracy == 0.0
