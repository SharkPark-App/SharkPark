"""
Tests for src/utils/promotion_guard.py.

Verifies the four-rule decision matrix:
    1. Candidate must have a finite mae/mae_holdout.
    2. Candidate mae must be below the absolute floor.
    3. Candidate must beat current @production by min_improvement_pct
       (or pass automatically if no @production exists — cold start).
    4. coverage_80 (when logged) must be in [0.70, 0.90].

Run from services/ml/:
    python -m pytest tests/utils/test_promotion_guard.py -v
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import mlflow
import pytest

from src.utils.promotion_guard import (
    PromotionDecision,
    evaluate_promotion_candidate,
)


def _make_run(metrics: dict[str, float], run_id: str = "run-x") -> MagicMock:
    run = MagicMock()
    run.info.run_id = run_id
    run.data.metrics = metrics
    return run


def _make_client(
    candidate_metrics: dict[str, float],
    *,
    current_metrics: dict[str, float] | None = None,
    current_version: str | None = None,
    current_run_id: str | None = "prod-run",
) -> MagicMock:
    """Build a MagicMock MlflowClient that returns the requested fixture state."""
    client = MagicMock()
    client.get_run.side_effect = lambda rid: _make_run(
        candidate_metrics if rid == "candidate-run" else (current_metrics or {}),
        run_id=rid,
    )
    if current_metrics is None:
        client.get_model_version_by_alias.side_effect = mlflow.exceptions.MlflowException(
            "no alias"
        )
    else:
        mv = MagicMock()
        mv.version = current_version or "7"
        mv.run_id = current_run_id
        client.get_model_version_by_alias.return_value = mv
    return client


@pytest.fixture(autouse=True)
def _patch_configure_mlflow():
    """promotion_guard calls configure_mlflow at decision time; bypass it."""
    with patch("src.utils.promotion_guard.configure_mlflow"):
        yield


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    for var in (
        "ML_PROMOTE_MIN_IMPROVEMENT_PCT",
        "ML_PROMOTE_MAX_MAE_SHORT_TERM",
        "ML_PROMOTE_MAX_MAE_LONG_TERM",
    ):
        monkeypatch.delenv(var, raising=False)


class TestRule1MissingMetric:
    def test_no_mae_means_no_promotion(self):
        client = _make_client({})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is False
        assert "no finite mae" in d.reason

    def test_nan_mae_means_no_promotion(self):
        client = _make_client({"mae": float("nan")})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is False

    def test_mae_holdout_preferred_over_mae(self):
        # mae=999 (would fail floor) but mae_holdout=0.10 (passes everything).
        client = _make_client({"mae": 999.0, "mae_holdout": 0.10})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is True


class TestRule2AbsoluteFloor:
    def test_short_term_floor_default(self):
        # default short-term floor = 0.20
        client = _make_client({"mae": 0.25})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is False
        assert "floor" in d.reason

    def test_long_term_floor_default(self):
        # default long-term floor = 0.25 — 0.22 passes.
        client = _make_client({"mae": 0.22})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "long-term-production")
        assert d.promote is True

    def test_floor_overridable_via_env(self, monkeypatch):
        monkeypatch.setenv("ML_PROMOTE_MAX_MAE_SHORT_TERM", "0.30")
        client = _make_client({"mae": 0.25})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is True


class TestRule3RelativeImprovement:
    def test_cold_start_promotes_anything_passing_floor(self):
        client = _make_client({"mae": 0.10}, current_metrics=None)
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is True
        assert "cold start" in d.reason

    def test_better_by_more_than_threshold_promotes(self):
        # current 0.100 → threshold = 0.099 (1%); candidate 0.090 wins.
        client = _make_client(
            {"mae": 0.090}, current_metrics={"mae": 0.100}, current_version="3"
        )
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is True
        assert "v3" in d.reason

    def test_marginal_improvement_below_threshold_rejected(self):
        # current 0.100, candidate 0.0995 → 0.5% improvement, below 1% threshold.
        client = _make_client(
            {"mae": 0.0995}, current_metrics={"mae": 0.100}, current_version="3"
        )
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is False

    def test_regression_rejected(self):
        client = _make_client(
            {"mae": 0.110}, current_metrics={"mae": 0.100}, current_version="3"
        )
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is False

    def test_threshold_pct_overridable(self, monkeypatch):
        monkeypatch.setenv("ML_PROMOTE_MIN_IMPROVEMENT_PCT", "10")
        # 5% improvement, but threshold now demands 10%.
        client = _make_client(
            {"mae": 0.095}, current_metrics={"mae": 0.100}, current_version="3"
        )
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is False

    def test_current_without_mae_falls_back_to_promote(self):
        # @production exists but its run lacks mae — promote candidate to restore baseline.
        client = _make_client(
            {"mae": 0.10}, current_metrics={"some_other_metric": 1.0}, current_version="3"
        )
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is True
        assert "restore baseline" in d.reason


class TestRule4CoverageBand:
    def test_coverage_in_band_passes(self):
        client = _make_client({"mae": 0.10, "coverage_80": 0.82})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is True

    def test_coverage_too_low_rejected(self):
        client = _make_client({"mae": 0.10, "coverage_80": 0.50})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is False
        assert "coverage_80" in d.reason

    def test_coverage_too_high_rejected(self):
        # Over-covering means intervals are too wide — also miscalibrated.
        client = _make_client({"mae": 0.10, "coverage_80": 0.99})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is False

    def test_missing_coverage_does_not_block(self):
        client = _make_client({"mae": 0.10})
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert d.promote is True


class TestDecisionShape:
    def test_returns_promotion_decision_with_full_context(self):
        client = _make_client(
            {"mae": 0.090, "rmse": 0.12},
            current_metrics={"mae": 0.100},
            current_version="3",
        )
        with patch("src.utils.promotion_guard.MlflowClient", return_value=client):
            d = evaluate_promotion_candidate("candidate-run", "short-term-production")
        assert isinstance(d, PromotionDecision)
        assert d.candidate_run_id == "candidate-run"
        assert d.current_version == "3"
        assert d.candidate_metrics["mae"] == 0.090
        assert d.candidate_metrics["rmse"] == 0.12
        assert d.current_metrics == {"mae": 0.100}
