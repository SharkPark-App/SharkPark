"""
Tests for the long-term two-stage model (src.models.long_term).

Covers:
    - Training and prediction pipeline (train returns horizon_mae)
    - Save/load round-trip (local and MLflow)
    - Error handling for untrained model
    - predict_quantiles returns ordered bounds and widens CI for cold-start

Run from services/ml/:
    python -m pytest tests/models/test_long_term.py -v
"""

import tempfile

import numpy as np
import pandas as pd
import pytest

from src.features.long_term import compute_baseline, prepare_inference_features
from src.models.long_term import LongTermModel


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def _use_isolated_mlflow(isolated_mlflow):
    """Ensure all tests in this module use isolated MLflow tracking."""


@pytest.fixture
def trained_long_term(synthetic_df):
    """Train a long-term model once and return (model, train_result)."""
    model = LongTermModel()
    result = model.train(synthetic_df)
    return model, result


# =============================================================================
# Training and Prediction
# =============================================================================


class TestLongTermModel:
    """Verify the two-stage training and prediction pipeline."""

    def test_train_returns_horizon_mae(self, trained_long_term):
        """train() result should include per-horizon MAE for days 1-7."""
        _, result = trained_long_term

        assert result["train_size"] > 0
        assert len(result["feature_columns"]) > 0
        assert "horizon_mae" in result

        assert len(result["horizon_mae"]) > 0
        for d in result["horizon_mae"].keys():
            assert 1 <= d <= 7

    def test_train_predictions_in_range(self, trained_long_term):
        """Test predictions (baseline + deviation, clipped) stay in [0, 1]."""
        _, result = trained_long_term
        if "test_predictions" not in result:
            pytest.skip("No test predictions produced")

        preds = result["test_predictions"]
        assert (preds >= 0.0).all()
        assert (preds <= 1.0).all()

    def test_save_and_load_roundtrip(self, trained_long_term, synthetic_df):
        """Saved and loaded model should produce identical deviation predictions."""
        model, _ = trained_long_term
        baseline_df = compute_baseline(synthetic_df)

        from datetime import date, timedelta

        target_dates = [date.today() + timedelta(days=d) for d in range(1, 4)]
        lot_ids = synthetic_df["lot_id"].unique().tolist()
        features = prepare_inference_features(
            target_dates=target_dates,
            lot_ids=lot_ids,
            baseline=baseline_df,
            snapshot_df=synthetic_df,
        )
        if features.empty:
            pytest.skip("No inference features produced")

        orig_median, orig_lower, orig_upper = model.predict_quantiles(features)

        # Save and reload model
        with tempfile.TemporaryDirectory() as tmpdir:
            model.save(tmpdir)
            loaded = LongTermModel.load(tmpdir)
            load_median, load_lower, load_upper = loaded.predict_quantiles(features)

        np.testing.assert_array_equal(orig_median, load_median)
        np.testing.assert_array_equal(orig_lower, load_lower)
        np.testing.assert_array_equal(orig_upper, load_upper)

    def test_mlflow_save_and_load(self, trained_long_term, synthetic_df):
        """save_mlflow -> load_mlflow round-trip produces identical predictions."""
        model, _ = trained_long_term
        baseline_df = compute_baseline(synthetic_df)

        from datetime import date, timedelta

        target_dates = [date.today() + timedelta(days=1)]
        lot_ids = synthetic_df["lot_id"].unique().tolist()
        features = prepare_inference_features(
            target_dates=target_dates,
            lot_ids=lot_ids,
            baseline=baseline_df,
            snapshot_df=synthetic_df,
        )
        if features.empty:
            pytest.skip("No inference features produced")

        orig_median, orig_lower, orig_upper = model.predict_quantiles(features)

        # Save model to and load from mflow
        run_id = model.save_mlflow(metrics={"mae": 0.1})
        loaded = LongTermModel.load_mlflow(run_id)

        load_median, load_lower, load_upper = loaded.predict_quantiles(features)

        np.testing.assert_array_equal(orig_median, load_median)
        np.testing.assert_array_equal(orig_lower, load_lower)
        np.testing.assert_array_equal(orig_upper, load_upper)

    def test_predict_quantiles_before_train_raises(self):
        """Calling predict_quantiles without training should raise RuntimeError."""
        model = LongTermModel()
        with pytest.raises(RuntimeError, match="not been trained"):
            model.predict_quantiles(pd.DataFrame())

    def test_save_before_train_raises(self):
        """Saving an untrained model should raise RuntimeError."""
        model = LongTermModel()
        with pytest.raises(RuntimeError, match="No trained model"):
            model.save("/tmp/test_long_term")

    def test_mlflow_save_before_train_raises(self):
        """save_mlflow on an untrained model should raise RuntimeError."""
        model = LongTermModel()
        with pytest.raises(RuntimeError, match="No trained model"):
            model.save_mlflow(metrics={"mae": 0.0})

    def test_predict_quantiles_bounds_ordered(self, trained_long_term, synthetic_df):
        """Lower bound <= median <= upper bound."""
        model, _ = trained_long_term

        baseline_df = compute_baseline(synthetic_df)
        from datetime import date, timedelta

        target_dates = [date.today() + timedelta(days=d) for d in range(1, 4)]
        lot_ids = synthetic_df["lot_id"].unique().tolist()
        features = prepare_inference_features(
            target_dates=target_dates,
            lot_ids=lot_ids,
            baseline=baseline_df,
            snapshot_df=synthetic_df,
        )
        if features.empty:
            pytest.skip("No inference features produced")

        median, lower, upper = model.predict_quantiles(features)

        assert (lower <= median).all()
        assert (median <= upper).all()

    def test_train_includes_low_confidence_rows(self, synthetic_df):
        """LOW-confidence rows must not be filtered — cold_start_weight handles downweighting."""
        df = synthetic_df.copy()
        df["confidence"] = "LOW"

        model = LongTermModel()
        result = model.train(df)
        assert result["train_size"] > 0

    def test_predict_returns_rates_in_range(self, trained_long_term, synthetic_df):
        """predict() should return occupancy rates in [0, 1]."""
        model, _ = trained_long_term
        baseline_df = compute_baseline(synthetic_df)

        from datetime import date, timedelta

        target_dates = [date.today() + timedelta(days=d) for d in range(1, 4)]
        lot_ids = synthetic_df["lot_id"].unique().tolist()
        features = prepare_inference_features(
            target_dates=target_dates,
            lot_ids=lot_ids,
            baseline=baseline_df,
            snapshot_df=synthetic_df,
        )
        if features.empty:
            pytest.skip("No inference features produced")

        preds = model.predict(features)
        assert (preds >= 0.0).all()
        assert (preds <= 1.0).all()
        assert len(preds) == len(features)

    def test_predict_before_train_raises(self):
        """Calling predict without training should raise RuntimeError."""
        model = LongTermModel()
        with pytest.raises(RuntimeError, match="not been trained"):
            model.predict(pd.DataFrame())

    def test_predict_quantiles_cold_start_widens_intervals(
        self, trained_long_term, synthetic_df
    ):
        """Cold-start lots should get wider confidence intervals."""
        model, _ = trained_long_term

        baseline_df = compute_baseline(synthetic_df)
        from datetime import date, timedelta

        target_dates = [date.today() + timedelta(days=1)]
        lot_ids = synthetic_df["lot_id"].unique().tolist()
        features = prepare_inference_features(
            target_dates=target_dates,
            lot_ids=lot_ids,
            baseline=baseline_df,
            snapshot_df=synthetic_df,
        )
        if features.empty:
            pytest.skip("No inference features produced")

        # Baseline: no cold-start flag
        features_no_cs = features.copy()
        features_no_cs["is_cold_start"] = False
        _, lower_base, upper_base = model.predict_quantiles(features_no_cs)

        # Cold start: all rows flagged
        features_cs = features.copy()
        features_cs["is_cold_start"] = True
        _, lower_cs, upper_cs = model.predict_quantiles(features_cs)

        spread_no_cs = upper_base - lower_base
        spread_cs = upper_cs - lower_cs

        # Cold-start spreads should be >= baseline spreads everywhere
        assert (spread_cs >= spread_no_cs - 1e-9).all()
