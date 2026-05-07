"""
Tests for the prediction script (scripts/predict_short_term.py).

Covers:
    - Prediction output matches expected schema columns
    - Predictions are within valid range

Run from services/ml/:
    python -m pytest tests/scripts/test_predict.py -v
"""

from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import mlflow
import numpy as np
import pandas as pd
import pytest

from scripts.predict_short_term import _build_prediction_df, _load_production_model, predict
from scripts.train_short_term import train
from scripts.promote_short_term import promote
from src.postprocess.weather_adjustment import WeatherSnapshot


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture()
def trained_and_promoted(synthetic_df, tmp_path, isolated_mlflow):
    """Train a model and promote it so predict.py can load it."""
    data_path = tmp_path / "test_data.parquet"
    synthetic_df.to_parquet(data_path, index=False)

    run_id = train(str(data_path))
    promote(run_id)

    return {"data_path": str(data_path), "run_id": run_id, "tmp_path": tmp_path}


# =============================================================================
# Tests
# =============================================================================


EXPECTED_COLUMNS = [
    "lot_id",
    "predicted_at",
    "target_time",
    "predicted_occupancy",
    "confidence_lower",
    "confidence_upper",
    "model_version",
]


class TestBuildPredictionDf:
    """Verify the prediction DataFrame builder."""

    def test_schema_matches(self):
        """Output should have all expected columns."""
        features = pd.DataFrame(
            {
                "lot_id": ["G1", "G1"],
                "target_hour": [10, 11],
            }
        )
        preds = np.array([0.5, 0.7])
        preds_lower = np.array([0.4, 0.6])
        preds_upper = np.array([0.6, 0.8])

        result = _build_prediction_df(
            features=features,
            preds=preds,
            preds_lower=preds_lower,
            preds_upper=preds_upper,
            model_version="test-v1",
            prediction_time=datetime(2025, 10, 15, 9, 0),
        )

        for col in EXPECTED_COLUMNS:
            assert col in result.columns, f"Missing column: {col}"

    def test_predicted_occupancy_is_rate(self):
        """Predicted occupancy is a rate in [0, 1]."""
        features = pd.DataFrame(
            {
                "lot_id": ["G1"],
                "target_hour": [10],
            }
        )
        preds = np.array([0.55])
        preds_lower = np.array([0.45])
        preds_upper = np.array([0.65])

        result = _build_prediction_df(
            features=features,
            preds=preds,
            preds_lower=preds_lower,
            preds_upper=preds_upper,
            model_version="test-v1",
            prediction_time=datetime(2025, 10, 15, 9, 0),
        )

        assert (result["predicted_occupancy"] >= 0).all()
        assert (result["predicted_occupancy"] <= 1).all()

    def test_confidence_bounds_ordered(self):
        """confidence_lower <= predicted_occupancy <= confidence_upper."""
        features = pd.DataFrame(
            {
                "lot_id": ["G1", "E1"],
                "target_hour": [10, 14],
            }
        )
        preds = np.array([0.5, 0.8])
        preds_lower = np.array([0.4, 0.7])
        preds_upper = np.array([0.6, 0.9])

        result = _build_prediction_df(
            features=features,
            preds=preds,
            preds_lower=preds_lower,
            preds_upper=preds_upper,
            model_version="test-v1",
            prediction_time=datetime(2025, 10, 15, 9, 0),
        )

        assert (result["confidence_lower"] <= result["predicted_occupancy"]).all()
        assert (result["predicted_occupancy"] <= result["confidence_upper"]).all()


class TestPredictErrorPaths:
    """Verify predict.py error handling for MLflow failures."""

    def test_no_production_model_raises(self):
        """Missing production model should raise RuntimeError with a clear message."""
        exc = mlflow.exceptions.MlflowException(
            "", error_code=mlflow.exceptions.RESOURCE_DOES_NOT_EXIST
        )
        with patch(
            "mlflow.tracking.MlflowClient.get_model_version_by_alias", side_effect=exc
        ):
            with pytest.raises(RuntimeError, match="Run train.py and promote.py first"):
                predict()

    def test_mlflow_system_error_raises(self):
        """MLflow system errors should propagate, not surface as a misleading RuntimeError."""
        exc = mlflow.exceptions.MlflowException(
            "auth failure", error_code=mlflow.exceptions.UNAUTHENTICATED
        )
        with patch(
            "mlflow.tracking.MlflowClient.get_model_version_by_alias", side_effect=exc
        ):
            with pytest.raises(mlflow.exceptions.MlflowException, match="auth failure"):
                predict()

    def test_load_production_model_prefers_registry_source_uri(self):
        """Production loader should use the registry version's source URI directly."""

        class VersionInfo:
            version = "3"
            run_id = "run-123"
            source = "s3://bucket/mlflow-artifacts/exp/run-123/artifacts/model"

        expected = object()

        with patch(
            "mlflow.tracking.MlflowClient.get_model_version_by_alias",
            return_value=VersionInfo(),
        ), patch(
            "scripts.predict_short_term.ShortTermModel.load_mlflow_artifact_uri",
            return_value=expected,
        ) as load_from_uri:
            model, version = _load_production_model()

        assert model is expected
        assert version == "v3"
        load_from_uri.assert_called_once_with(VersionInfo.source)

    def test_load_production_model_falls_back_to_run_id_when_source_missing(self):
        """Legacy registry rows without source should still load from run_id."""

        class VersionInfo:
            version = "4"
            run_id = "run-456"
            source = None

        expected = object()

        with patch(
            "mlflow.tracking.MlflowClient.get_model_version_by_alias",
            return_value=VersionInfo(),
        ), patch(
            "scripts.predict_short_term.ShortTermModel.load_mlflow",
            return_value=expected,
        ) as load_from_run:
            model, version = _load_production_model()

        assert model is expected
        assert version == "v4"
        load_from_run.assert_called_once_with("run-456")


class TestPredictEndToEnd:
    """Verify predict.py loads production model and generates output."""

    @patch("src.data.db.write_short_term_predictions", return_value=0)
    @patch("src.data.db.fetch_latest_weather", return_value=None)
    @patch("src.data.db.get_school_id_for_lots", return_value="school-1")
    def test_predict_writes_output(
        self, mock_school, mock_weather, mock_write, trained_and_promoted
    ):
        """predict() should write predictions to DB and local file."""
        info = trained_and_promoted
        output_path = str(info["tmp_path"] / "predictions.csv")

        result = predict(
            data_path=info["data_path"],
            output_path=output_path,
            start_of_day=True,
            write_local=True,
        )

        assert not result.empty, "start_of_day=True should always produce predictions"
        for col in EXPECTED_COLUMNS:
            assert col in result.columns

        # Verify DB write was called
        mock_write.assert_called_once()

        # Verify local CSV was written
        assert Path(output_path).exists()

    @patch("src.data.db.write_short_term_predictions", return_value=0)
    @patch("src.data.db.fetch_latest_weather")
    @patch("src.data.db.get_school_id_for_lots", return_value="school-1")
    def test_predict_applies_weather_adjustment(
        self, mock_school, mock_weather, mock_write, trained_and_promoted
    ):
        """End-to-end: fetch_latest_weather output flows into apply_weather_adjustment.

        Catches contract drift between the DB-layer WeatherSnapshot and the
        post-processing layer's expectations. Stubs the DB calls but exercises
        the real adjustment code path.
        """
        info = trained_and_promoted

        # Severe weather should produce a meaningful reduction
        mock_weather.return_value = WeatherSnapshot(
            timestamp=datetime(2025, 10, 15, 8, 0),
            temperature_f=45.0,
            feels_like_f=42.0,
            humidity_percent=80.0,
            wind_speed_mph=10.0,
            conditions="thunderstorm with heavy rain",
            precipitation_probability=0.95,
            is_raining=True,
        )

        baseline = predict(
            data_path=info["data_path"],
            output_path=str(info["tmp_path"] / "preds_baseline.csv"),
            start_of_day=True,
        )

        with patch("scripts.predict_short_term.WEATHER_ADJUSTMENT_ENABLED", False):
            unadjusted = predict(
                data_path=info["data_path"],
                output_path=str(info["tmp_path"] / "preds_unadjusted.csv"),
                start_of_day=True,
            )

        mock_school.assert_called()
        mock_weather.assert_called_with("school-1")

        # SEVERE multiplier is 0.50, so adjusted occupancy should never increase.
        # Some rows can end up equal after downstream post-processing floors,
        # so we require at least one strict reduction rather than all-strict.
        merged = baseline.merge(
            unadjusted,
            on=["lot_id", "target_time"],
            suffixes=("_adj", "_raw"),
        )
        non_zero = merged[merged["predicted_occupancy_raw"] > 0]

        assert not non_zero.empty, "expected at least one non-zero baseline prediction"
        assert (
            non_zero["predicted_occupancy_adj"] <= non_zero["predicted_occupancy_raw"]
        ).all(), "SEVERE weather adjustment should never increase occupancy"
        assert (
            non_zero["predicted_occupancy_adj"] < non_zero["predicted_occupancy_raw"]
        ).any(), "SEVERE weather adjustment should reduce at least one non-zero row"
