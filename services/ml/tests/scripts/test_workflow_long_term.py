"""
Integration test: full train → evaluate → promote → predict workflow (long-term).

Verifies the complete long-term ML pipeline end-to-end with isolated MLflow
tracking.

Run from services/ml/:
    python -m pytest tests/scripts/test_workflow_long_term.py -v
"""

from unittest.mock import patch

import mlflow
import pytest

from scripts.train_long_term import train
from scripts.evaluate_long_term import evaluate
from scripts.promote_long_term import promote
from scripts.predict_long_term import predict


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture()
def long_workflow_env(synthetic_df, tmp_path, isolated_mlflow):
    """Set up isolated environment for the long-term workflow."""
    data_path = tmp_path / "test_data.parquet"
    synthetic_df.to_parquet(data_path, index=False)

    return {
        "data_path": str(data_path),
        "tmp_path": tmp_path,
    }


# =============================================================================
# Tests
# =============================================================================


class TestLongTermWorkflow:
    """Verify the complete long-term train → evaluate → promote → predict pipeline."""

    @patch("src.data.db.write_long_term_predictions", return_value=0)
    def test_train_evaluate_promote_predict(self, _mock_write, long_workflow_env):
        """Full long-term workflow should complete without errors."""
        data_path = long_workflow_env["data_path"]
        tmp_path = long_workflow_env["tmp_path"]

        # Step 1: Train
        run_id = train(data_path)
        assert run_id is not None

        # Verify metrics were logged
        client = mlflow.tracking.MlflowClient()
        run = client.get_run(run_id)
        assert "mae" in run.data.metrics

        # Horizon-stratified metrics should also be logged
        assert any(k.startswith("mae_day_") for k in run.data.metrics.keys())

        # Step 2: Evaluate
        result = evaluate(run_id, data_path)
        assert "should_promote" in result
        assert "results" in result
        assert "horizon_mae" in result
        assert "Candidate" in result["results"]

        # Step 3: Promote
        version = promote(run_id)
        assert version is not None

        # Verify model is registered with production alias
        mv = client.get_model_version_by_alias("long-term-production", "production")
        assert mv.version == version

        # Step 4: Predict
        output_path = str(tmp_path / "predictions_long_term.csv")
        predictions = predict(
            data_path=data_path,
            output_path=output_path,
            write_local=True,
        )

        assert not predictions.empty
        assert "lot_id" in predictions.columns
        assert "predicted_occupancy" in predictions.columns
        assert "confidence_lower" in predictions.columns
        assert "confidence_upper" in predictions.columns
        assert "target_date" in predictions.columns
        assert "target_hour" in predictions.columns

    def test_second_model_not_promoted_without_improvement(self, long_workflow_env):
        """A second identical model should not be promoted over the first."""
        data_path = long_workflow_env["data_path"]

        # Train and promote first model
        run_id_1 = train(data_path)
        promote(run_id_1)

        # Train a second identical model
        run_id_2 = train(data_path)
        result = evaluate(run_id_2, data_path)

        # Identical model should not improve MAE by >= 5%
        assert result["should_promote"] is False
        assert result["promotion_reason"] is not None
        assert "Not promoted" in result["promotion_reason"]


class TestEvaluateLongTermErrorPaths:
    """Verify evaluate_long_term error handling."""

    def test_missing_data_file_raises(self, long_workflow_env):
        """Nonexistent data path should raise FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Data file not found"):
            evaluate("fake-run-id", "/nonexistent/path/data.parquet")

    def test_mlflow_system_error_raises(self, long_workflow_env):
        """MLflow system errors during production model lookup should propagate."""
        data_path = long_workflow_env["data_path"]
        run_id = train(data_path)

        exc = mlflow.exceptions.MlflowException(
            "internal error", error_code=mlflow.exceptions.INTERNAL_ERROR
        )
        with patch(
            "mlflow.tracking.MlflowClient.get_model_version_by_alias", side_effect=exc
        ):
            with pytest.raises(
                mlflow.exceptions.MlflowException, match="internal error"
            ):
                evaluate(run_id, data_path)
