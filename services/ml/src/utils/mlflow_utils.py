"""
Shared MLflow utilities for SharkPark ML.
"""

import logging
import tempfile
from pathlib import Path

import mlflow
import pandas as pd

logger = logging.getLogger(__name__)

__all__ = [
    "load_run_data",
    "get_production_run_id",
]


def load_run_data(run_id: str, artifact_path: str = "data") -> pd.DataFrame:
    """
    Download a parquet data artifact from an MLflow run and return as a DataFrame.

    Args:
        run_id: MLflow run ID.
        artifact_path: Artifact subdirectory containing the parquet file.

    Returns:
        DataFrame loaded from the first parquet file found in the artifact path.

    Raises:
        FileNotFoundError: If no parquet file exists at the artifact path.
    """
    with tempfile.TemporaryDirectory() as tmp:
        data_dir = mlflow.artifacts.download_artifacts(
            run_id=run_id, artifact_path=artifact_path, dst_path=tmp
        )
        parquet_files = list(Path(data_dir).glob("*.parquet"))
        if not parquet_files:
            raise FileNotFoundError(
                "No data artifact found in run. Pass --data-path manually."
            )
        return pd.read_parquet(parquet_files[0])


def get_production_run_id(model_name: str) -> str | None:
    """
    Look up the run_id for the production-aliased version of a registered model.

    Falls back to parsing the artifact source URI if run_id is not directly
    set on the model version (can happen with older MLflow registrations).

    Args:
        model_name: Registered model name.

    Returns:
        run_id string, or None if it cannot be determined.

    Raises:
        mlflow.exceptions.MlflowException: For errors other than model not found.
    """
    client = mlflow.tracking.MlflowClient()
    mv = client.get_model_version_by_alias(model_name, "production")

    # Get the run that produced this model version
    run_id = mv.run_id
    if run_id is None:
        # Fallback: parse run_id from the artifact URI
        source = mv.source.replace("\\", "/")
        parts = source.split("/")
        if "artifacts" in parts:
            run_id = parts[parts.index("artifacts") - 1]

    return run_id or None
