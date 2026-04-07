"""
Tests for the prediction script (scripts/predict.py).

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

from scripts.predict import _build_prediction_df, predict
from scripts.train import train
from scripts.promote import promote


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
        capacities = {"G1": 180}

        result = _build_prediction_df(
            features=features,
            preds=preds,
            preds_lower=preds_lower,
            preds_upper=preds_upper,
            lot_capacities=capacities,
            model_version="test-v1",
            prediction_time=datetime(2025, 10, 15, 9, 0),
        )

        for col in EXPECTED_COLUMNS:
            assert col in result.columns, f"Missing column: {col}"

    def test_predicted_occupancy_is_int(self):
        """Predicted occupancy should be integer counts."""
        features = pd.DataFrame(
            {
                "lot_id": ["G1"],
                "target_hour": [10],
            }
        )
        preds = np.array([0.55])
        preds_lower = np.array([0.45])
        preds_upper = np.array([0.65])
        capacities = {"G1": 180}

        result = _build_prediction_df(
            features=features,
            preds=preds,
            preds_lower=preds_lower,
            preds_upper=preds_upper,
            lot_capacities=capacities,
            model_version="test-v1",
            prediction_time=datetime(2025, 10, 15, 9, 0),
        )

        assert result["predicted_occupancy"].dtype in [np.int64, np.int32, int]

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
        capacities = {"G1": 180, "E1": 185}

        result = _build_prediction_df(
            features=features,
            preds=preds,
            preds_lower=preds_lower,
            preds_upper=preds_upper,
            lot_capacities=capacities,
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


class TestPredictEndToEnd:
    """Verify predict.py loads production model and generates output."""

    @patch("src.data.db.write_predictions", return_value=0)
    def test_predict_writes_output(self, mock_write, trained_and_promoted):
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
