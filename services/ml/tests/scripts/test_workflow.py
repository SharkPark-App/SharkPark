"""
Integration test: full train → evaluate → promote → predict workflow.

Verifies the complete ML pipeline end-to-end with isolated MLflow tracking.

Run from services/ml/:
    python -m pytest tests/scripts/test_workflow.py -v
"""

from unittest.mock import patch

import mlflow
import pytest

from scripts.train import train
from scripts.evaluate import evaluate
from scripts.promote import promote
from scripts.predict import predict


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture()
def workflow_env(synthetic_df, tmp_path, isolated_mlflow):
    """Set up isolated environment for the full workflow."""
    data_path = tmp_path / "test_data.parquet"
    synthetic_df.to_parquet(data_path, index=False)

    return {
        "data_path": str(data_path),
        "tmp_path": tmp_path,
    }


# =============================================================================
# Tests
# =============================================================================


@patch("src.evaluation.compare.get_total_lot_count", return_value=2)
class TestFullWorkflow:
    """Verify the complete train → evaluate → promote → predict pipeline."""

    @patch("src.data.db.write_predictions", return_value=0)
    def test_train_evaluate_promote_predict(
        self, mock_write, mock_lot_count, workflow_env
    ):
        """Full workflow should complete without errors."""
        data_path = workflow_env["data_path"]
        tmp_path = workflow_env["tmp_path"]

        # Step 1: Train
        run_id = train(data_path)
        assert run_id is not None

        # Verify metrics were logged
        client = mlflow.tracking.MlflowClient()
        run = client.get_run(run_id)
        assert "mae" in run.data.metrics

        # Step 2: Evaluate
        comparison = evaluate(run_id, data_path)
        assert "should_promote" in comparison
        assert "results" in comparison
        assert "Candidate" in comparison["results"]

        # Step 3: Promote
        version = promote(run_id)
        assert version is not None

        # Verify model is registered with production alias
        mv = client.get_model_version_by_alias("short-term-production", "production")
        assert mv.version == version

        # Step 4: Predict
        output_path = str(tmp_path / "predictions.csv")
        predictions = predict(data_path, output_path, start_of_day=True)

        assert not predictions.empty, (
            "start_of_day=True should always produce predictions"
        )
        assert "lot_id" in predictions.columns
        assert "predicted_occupancy" in predictions.columns
        assert "confidence_lower" in predictions.columns
        assert "confidence_upper" in predictions.columns

    def test_evaluate_first_deployment(self, mock_lot_count, workflow_env):
        """First deployment (no production model) should recommend promotion."""
        data_path = workflow_env["data_path"]

        run_id = train(data_path)
        comparison = evaluate(run_id, data_path)

        # No production model exists → should always promote
        assert comparison["should_promote"] is True
        assert (
            comparison["promotion_reason"] == "No production model — first deployment"
        )

    def test_evaluate_do_not_promote(self, mock_lot_count, workflow_env):
        """Candidate that doesn't improve enough should not be promoted."""
        data_path = workflow_env["data_path"]

        # Train and promote a production model
        run_id_1 = train(data_path)
        promote(run_id_1)

        # Train a second model (same data → similar metrics → <5% improvement)
        run_id_2 = train(data_path)
        comparison = evaluate(run_id_2, data_path)

        # Same data/model → no meaningful improvement → should not promote
        assert comparison["should_promote"] is False
        assert "Not promoted" in comparison["promotion_reason"]


class TestEvaluateErrorPaths:
    """Verify evaluate error handling."""

    def test_missing_data_file_raises(self, workflow_env):
        """Nonexistent data path should raise FileNotFoundError."""
        with pytest.raises(FileNotFoundError, match="Data file not found"):
            evaluate("fake-run-id", "/nonexistent/path/data.parquet")
