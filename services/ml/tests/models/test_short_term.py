"""
Tests for the short-term XGBoost model (src.models.short_term).

Covers:
    - Training and prediction pipeline
    - Save/load round-trip (local and MLflow)
    - Error handling for untrained model

Run from services/ml/:
    python -m pytest tests/models/test_short_term.py -v
"""

import tempfile

import numpy as np
import pandas as pd
import pytest

from src.models.short_term import ShortTermModel


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def _use_isolated_mlflow(isolated_mlflow):
    """Ensure all tests in this module use isolated MLflow tracking."""


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

        run_id = model.save_mlflow(metrics={"mae": 0.05})
        loaded_model = ShortTermModel.load_mlflow(run_id)

        # Predictions from loaded model should match the original
        loaded_preds = loaded_model.predict(test_features)
        np.testing.assert_array_almost_equal(original_preds, loaded_preds)

    def test_train_includes_low_confidence_rows(self, synthetic_df):
        """LOW-confidence rows must not be filtered — downweighting handled by cold-start weights"""
        df = synthetic_df.copy()
        df["confidence"] = "LOW"

        model = ShortTermModel()
        result = model.train(df)
        assert result["train_size"] > 0

    def test_predict_quantiles_cold_start_widens_intervals(self, synthetic_df):
        """Cold-start lots should get wider confidence intervals."""
        model = ShortTermModel()
        result = model.train(synthetic_df)

        if "test_features" not in result or result["test_features"].empty:
            pytest.skip("No test features produced")

        test_features = result["test_features"].copy()

        # Baseline: cold-start flag set to False
        test_features["is_cold_start"] = False
        median_base, lower_base, upper_base = model.predict_quantiles(test_features)

        # With cold-start flag set to True for all rows
        test_features["is_cold_start"] = True
        median_cs, lower_cs, upper_cs = model.predict_quantiles(test_features)

        # Median should be unchanged
        np.testing.assert_array_almost_equal(median_base, median_cs)

        # Cold-start intervals should be at least as wide as baseline
        spread_base = upper_base - lower_base
        spread_cs = upper_cs - lower_cs
        assert (spread_cs >= spread_base - 1e-9).all(), (
            "Cold-start intervals should be wider than or equal to baseline"
        )

        # At least some intervals should actually be wider (where spread > 0)
        has_spread = spread_base > 1e-6
        if has_spread.any():
            assert (spread_cs[has_spread] > spread_base[has_spread] + 1e-9).any(), (
                "Expected some cold-start intervals to be strictly wider"
            )

    def test_mlflow_save_before_train_raises(self):
        """save_mlflow on an untrained model should raise RuntimeError."""
        model = ShortTermModel()
        with pytest.raises(RuntimeError, match="No trained model"):
            model.save_mlflow(metrics={"mae": 0.0})

    def test_prepare_xy_handles_nullable_bool_and_object_with_nan(self):
        """_prepare_xy should coerce bool/object columns without crashing on NaN."""
        model = ShortTermModel()
        model.feature_columns = ["is_raining", "temperature_f"]

        df = pd.DataFrame(
            {
                "is_raining": pd.Series([True, False, None], dtype="boolean"),
                "temperature_f": [70.2, "71.5", None],
                "target_occupancy_rate": [0.3, 0.4, 0.5],
            }
        )

        X, y = model._prepare_xy(df)

        assert y is not None and len(y) == 3
        assert pd.api.types.is_float_dtype(X["is_raining"])
        assert pd.api.types.is_numeric_dtype(X["temperature_f"])
        assert np.isnan(X.loc[2, "is_raining"])

    def test_weather_severity_still_encoded_after_fit(self):
        """weather_severity should remain a categorical feature in normal flow."""
        model = ShortTermModel()
        df = pd.DataFrame(
            {
                "lot_id": ["G1", "G2", "G1"],
                "semester": ["spring", "spring", "spring"],
                "academic_period": ["regular", "regular", "regular"],
                "weather_severity": ["clear", "rain", "clear"],
                "is_raining": [0, 1, 0],
            }
        )

        model._fit_category_mappings(df)
        encoded = model._encode_categoricals(df)

        assert "weather_severity_encoded" in encoded.columns
        assert pd.api.types.is_integer_dtype(encoded["weather_severity_encoded"])
