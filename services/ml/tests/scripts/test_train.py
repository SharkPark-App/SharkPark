"""
Tests for the training script (scripts/train.py).

Covers:
    - Training produces an MLflow run with expected metrics
    - Training fails gracefully with missing data file

Run from services/ml/:
    python -m pytest tests/scripts/test_train.py -v
"""

from unittest.mock import patch

import mlflow
import pandas as pd
import pytest

from scripts.train import train


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def _use_isolated_mlflow(isolated_mlflow):
    """Ensure all tests in this module use isolated MLflow tracking."""


# =============================================================================
# Tests
# =============================================================================


class TestTrain:
    """Verify training script produces valid MLflow runs."""

    def test_train_produces_mlflow_run(self, data_parquet):
        """Training should create an MLflow run with mae, rmse, mape metrics."""
        run_id = train(data_parquet)

        assert run_id is not None
        assert len(run_id) > 0

        # Verify metrics were logged
        client = mlflow.tracking.MlflowClient()
        run = client.get_run(run_id)
        metrics = run.data.metrics

        assert "mae" in metrics
        assert "rmse" in metrics
        assert "mape" in metrics

        # Sanity check metric ranges
        assert 0.0 <= metrics["mae"] <= 1.0
        assert 0.0 <= metrics["rmse"] <= 1.0
        assert metrics["mape"] >= 0.0

    def test_train_logs_params(self, data_parquet):
        """Training should log model hyperparameters."""
        run_id = train(data_parquet)

        client = mlflow.tracking.MlflowClient()
        run = client.get_run(run_id)
        params = run.data.params

        # XGBoost hyperparameters
        assert "n_estimators" in params
        assert "max_depth" in params
        assert "learning_rate" in params
        assert "subsample" in params
        assert "colsample_bytree" in params
        assert "random_state" in params

        # Training metadata
        assert "train_size" in params
        assert "test_size" in params
        assert "split_date" in params
        assert "data_path" in params
        assert "include_real" in params
        assert "synthetic_weight" in params
        assert "cold_start_weight" in params
        assert "synthetic_rows" in params

    def test_train_multi_file_glob(self, synthetic_df, tmp_path):
        """Training with a glob pattern should concatenate multiple parquets."""
        # Split synthetic data into two "semester" files
        half = len(synthetic_df) // 2
        synthetic_df.iloc[:half].to_parquet(tmp_path / "synthetic_fall-2025.parquet", index=False)
        synthetic_df.iloc[half:].to_parquet(tmp_path / "synthetic_spring-2026.parquet", index=False)

        run_id = train(str(tmp_path / "synthetic_*.parquet"))

        assert run_id is not None
        client = mlflow.tracking.MlflowClient()
        run = client.get_run(run_id)
        assert "mae" in run.data.metrics

    def test_train_missing_file_raises(self, tmp_path):
        """Training with a non-existent file should raise FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            train(str(tmp_path / "nonexistent.parquet"))

    def test_train_include_real_with_data(self, data_parquet, synthetic_df):
        """Training with include_real should merge real rows and still produce a valid run."""
        # Simulate real data: take a small slice of synthetic_df as "real"
        df_real = synthetic_df.head(20).copy()
        df_real["_source"] = "real"

        with patch(
            "src.data.db.load_real_snapshots", return_value=df_real
        ) as mock_load:
            run_id = train(data_parquet, include_real=True)

        mock_load.assert_called_once()
        assert run_id is not None

        client = mlflow.tracking.MlflowClient()
        run = client.get_run(run_id)
        assert "mae" in run.data.metrics
        assert run.data.params["include_real"] == "True"

    def test_train_include_real_empty(self, data_parquet):
        """When real data is empty, training should fall back to synthetic only."""
        empty_df = pd.DataFrame(
            columns=[
                "lot_id",
                "timestamp",
                "occupancy",
                "available",
                "occupancy_rate",
                "confidence",
                "is_cold_start",
                "academic_period",
                "week_of_semester",
                "is_campus_open",
                "semester",
            ]
        )
        with patch(
            "src.data.db.load_real_snapshots", return_value=empty_df
        ) as mock_load:
            run_id = train(data_parquet, include_real=True)

        mock_load.assert_called_once()
        assert run_id is not None

        # Verify training completed with synthetic data only
        client = mlflow.tracking.MlflowClient()
        run = client.get_run(run_id)
        assert "mae" in run.data.metrics
        assert run.data.params["include_real"] == "True"
