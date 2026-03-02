"""
Tests for the short-term XGBoost model (src.models.short_term).

Covers:
    - Training and prediction pipeline
    - Save/load round-trip (local and MLflow)
    - Error handling for untrained model

Run from services/ml/:
    python -m pytest tests/models/test_short_term.py -v
"""

import os
import tempfile

import mlflow
import numpy as np
import pytest

from src.models.short_term import ShortTermModel


# =============================================================================
# Training and Prediction
# =============================================================================


class TestShortTermModel:
    """Verify the XGBoost training and prediction pipeline."""

    def test_train_and_predict(self, synthetic_df):
        """Model trains without error and predictions are in [0, 1]."""
        model = ShortTermModel()
        result = model.train(synthetic_df)

        assert result["train_size"] > 0
        assert result["test_size"] >= 0
        assert len(result["feature_columns"]) > 0

        # If we have test predictions, verify range
        if "test_predictions" in result:
            preds = result["test_predictions"]
            assert (preds >= 0.0).all()
            assert (preds <= 1.0).all()

    def test_predict_before_train_raises(self):
        """Calling predict without training should raise RuntimeError."""
        import pandas as pd

        model = ShortTermModel()
        with pytest.raises(RuntimeError, match="not been trained"):
            model.predict(pd.DataFrame())

    def test_save_and_load(self, synthetic_df):
        """Saved and loaded model should produce identical predictions."""
        model = ShortTermModel()
        result = model.train(synthetic_df)

        if "test_features" not in result or result["test_features"].empty:
            pytest.skip("No test features produced for save/load test")

        test_features = result["test_features"]
        original_preds = model.predict(test_features)

        with tempfile.TemporaryDirectory() as tmpdir:
            model.save(tmpdir)
            loaded_model = ShortTermModel.load(tmpdir)
            loaded_preds = loaded_model.predict(test_features)

        np.testing.assert_array_almost_equal(original_preds, loaded_preds)

    def test_predict_quantiles(self, synthetic_df):
        """predict_quantiles returns three arrays with lower <= median <= upper."""
        model = ShortTermModel()
        result = model.train(synthetic_df)

        if "test_features" not in result or result["test_features"].empty:
            pytest.skip("No test features produced")

        median, lower, upper = model.predict_quantiles(result["test_features"])

        # All in [0, 1]
        for arr in (median, lower, upper):
            assert (arr >= 0.0).all()
            assert (arr <= 1.0).all()

        # Ordering: lower <= median <= upper
        assert (lower <= median + 1e-9).all()
        assert (median <= upper + 1e-9).all()

    def test_train_returns_quantile_predictions(self, synthetic_df):
        """train() result includes test_predictions_lower and test_predictions_upper."""
        model = ShortTermModel()
        result = model.train(synthetic_df)

        if "test_predictions" not in result:
            pytest.skip("No test predictions produced")

        assert "test_predictions_lower" in result
        assert "test_predictions_upper" in result
        assert len(result["test_predictions_lower"]) == len(result["test_predictions"])
        assert len(result["test_predictions_upper"]) == len(result["test_predictions"])

    def test_save_and_load_quantiles(self, synthetic_df):
        """Saved and loaded model should produce identical quantile predictions."""
        model = ShortTermModel()
        result = model.train(synthetic_df)

        if "test_features" not in result or result["test_features"].empty:
            pytest.skip("No test features produced")

        test_features = result["test_features"]
        orig_median, orig_lower, orig_upper = model.predict_quantiles(test_features)

        # Round-trip through save/load and compare all three quantile outputs
        with tempfile.TemporaryDirectory() as tmpdir:
            model.save(tmpdir)
            loaded = ShortTermModel.load(tmpdir)
            load_median, load_lower, load_upper = loaded.predict_quantiles(
                test_features
            )

        np.testing.assert_array_almost_equal(orig_median, load_median)
        np.testing.assert_array_almost_equal(orig_lower, load_lower)
        np.testing.assert_array_almost_equal(orig_upper, load_upper)

    def test_predict_quantiles_before_train_raises(self):
        """Calling predict_quantiles without training should raise RuntimeError."""
        import pandas as pd

        model = ShortTermModel()
        with pytest.raises(RuntimeError, match="not been trained"):
            model.predict_quantiles(pd.DataFrame())

    def test_save_before_train_raises(self):
        """Saving an untrained model should raise RuntimeError."""
        model = ShortTermModel()
        with pytest.raises(RuntimeError, match="No trained model"):
            model.save("/tmp/test_model")

    def test_mlflow_save_and_load(self, synthetic_df):
        """save_mlflow → load_mlflow round-trip produces identical predictions."""
        model = ShortTermModel()
        result = model.train(synthetic_df)

        if "test_features" not in result or result["test_features"].empty:
            pytest.skip("No test features produced")

        # Capture predictions from the original in-memory model
        test_features = result["test_features"]
        original_preds = model.predict(test_features)

        # Point MLflow at a temp directory so artifacts don't
        # pollute the real mlruns/ used during development
        with tempfile.TemporaryDirectory() as tmpdir:
            mlflow.set_tracking_uri(f"file:///{tmpdir.replace(os.sep, '/')}")

            run_id = model.save_mlflow(metrics={"mae": 0.05})
            loaded_model = ShortTermModel.load_mlflow(run_id)

        # Predictions from loaded model should match the original
        loaded_preds = loaded_model.predict(test_features)
        np.testing.assert_array_almost_equal(original_preds, loaded_preds)

    def test_mlflow_save_before_train_raises(self):
        """save_mlflow on an untrained model should raise RuntimeError."""
        model = ShortTermModel()
        with pytest.raises(RuntimeError, match="No trained model"):
            model.save_mlflow(metrics={"mae": 0.0})
