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
    "promote_model",
]


def promote_model(
    run_id: str,
    model_name: str,
    export_s3: bool = False,
) -> tuple[str | None, bool, mlflow.entities.Run | None]:
    """
    Register a model version and set the production alias.

    Args:
        run_id: MLflow run ID of the model to promote.
        model_name: Registered model name in the MLflow Model Registry.
        export_s3: If True, log a placeholder message for S3 export.

    Returns:
        (version, alias_set, run).
        version is None on hard failure (run not found, registration failed).
        alias_set is False if the model was registered but the alias could not be set.
    """
    client = mlflow.tracking.MlflowClient()

    try:
        run = client.get_run(run_id)
    except mlflow.exceptions.MlflowException as e:
        if e.error_code == "RESOURCE_DOES_NOT_EXIST":
            logger.error("Run '%s' not found. Check the run ID and try again.", run_id)
            return None, False, None
        logger.error("MLflow error while fetching run '%s' (error_code=%s): %s", run_id, e.error_code, e)
        raise

    artifact_uri = run.info.artifact_uri
    model_uri = f"{artifact_uri}/model"

    logger.info("Registering model from run %s...", run_id)
    try:
        result = mlflow.register_model(model_uri, model_name)
    except mlflow.exceptions.MlflowException as e:
        logger.error("Failed to register model — %s", e)
        return None, False, None

    version = result.version

    try:
        client.set_registered_model_alias(model_name, "production", version)
    except mlflow.exceptions.MlflowException as e:
        logger.error(
            "Model registered as v%s but failed to set production alias — %s",
            version,
            e,
        )
        return version, False, run

    logger.info("Model registered: %s v%s", model_name, version)
    logger.info("Alias: @production")
    logger.info("Run ID: %s", run_id)

    if export_s3:
        logger.info(
            "\n[S3 Export] Not implemented yet. When deployed to Lambda, "
            "this will upload the model artifact to S3 for Lambda-based inference."
        )

    return version, True, run


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
