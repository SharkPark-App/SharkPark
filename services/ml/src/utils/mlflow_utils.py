"""
Shared MLflow utilities for SharkPark ML.
"""

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import mlflow
import pandas as pd

from src.utils.mlflow_setup import configure_mlflow

logger = logging.getLogger(__name__)

# Idempotent: applies MLFLOW_TRACKING_URI + R2 artifact env exactly once per
# process. Tests override via the ``isolated_mlflow`` fixture, which calls
# ``mlflow.set_tracking_uri`` after this import — last writer wins.
configure_mlflow()

__all__ = [
    "load_run_data",
    "get_production_run_id",
    "promote_model",
    "upload_model_to_r2",
]

# Matches BaseXGBoostModel.save() in services/ml/src/models/base.py
_MODEL_ARTIFACT_FILES = (
    "model.json",
    "model_lower.json",
    "model_upper.json",
    "metadata.joblib",
)
_DEFAULT_R2_BUCKET = "sharkpark-ml-exports"


def promote_model(
    run_id: str,
    model_name: str,
    export_s3: bool = False,
) -> tuple[str | None, bool, mlflow.entities.Run | None]:
    """
    Register a model version and set the production alias.

    Idempotent: if the run is already registered, the existing version is reused.
    Re-promoting an already-registered run will (re-)point the @production alias
    to that version. If @production currently points elsewhere, a warning is
    logged. To re-publish artifacts without moving the alias, use the
    --upload-only flag in the promote scripts (which calls upload_model_to_r2
    directly and skips this function).

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
        logger.error(
            "MLflow error while fetching run '%s' (error_code=%s): %s",
            run_id,
            e.error_code,
            e,
        )
        raise

    # Idempotent: reuse the existing version if this run is already registered.
    # Note: re-promoting a previously-registered run will ALSO re-point the
    # @production alias to that version (see alias-set call below). If the
    # current @production points elsewhere, a warning is logged so the operator
    # is aware. Use --upload-only to re-publish artifacts without changing the alias.
    try:
        registered_versions = client.search_model_versions(f"name='{model_name}'")
    except mlflow.exceptions.MlflowException:
        registered_versions = []

    existing = next(
        (mv for mv in registered_versions if _resolve_run_id(mv) == run_id),
        None,
    )
    if existing is not None:
        version = existing.version
        logger.info(
            "Run %s already registered as %s v%s — reusing existing version.",
            run_id,
            model_name,
            version,
        )
        # Warn if reusing this version would move @production backwards.
        try:
            current_prod = client.get_model_version_by_alias(model_name, "production")
            if current_prod.version != version:
                logger.warning(
                    "Re-promoting %s v%s will move @production from v%s to v%s. "
                    "Use --upload-only %s to re-publish artifacts without changing the alias.",
                    model_name,
                    version,
                    current_prod.version,
                    version,
                    version,
                )
        except mlflow.exceptions.MlflowException:
            # No @production alias set yet — nothing to warn about.
            pass
    else:
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
        try:
            _upload_to_r2(model_name=model_name, version=version, run_id=run_id)
        except Exception as e:
            logger.warning(
                "R2 upload failed for %s v%s — model is registered locally but "
                "not yet published to R2. Retry with --upload-only %s. (%s)",
                model_name,
                version,
                version,
                e,
            )

    return version, True, run


def upload_model_to_r2(model_name: str, version: str) -> None:
    """
    Upload an already-registered model version to R2 without re-registering.

    Raises:
        mlflow.exceptions.MlflowException: If the version does not exist.
        RuntimeError: If R2 env vars are missing or run_id is unresolvable.
        FileNotFoundError: If a required artifact is missing from the run.
    """
    client = mlflow.tracking.MlflowClient()
    mv = client.get_model_version(name=model_name, version=str(version))

    run_id = _resolve_run_id(mv)
    if not run_id:
        raise RuntimeError(f"Could not resolve run_id for {model_name} v{version}")

    _upload_to_r2(model_name=model_name, version=str(version), run_id=run_id)


def _resolve_run_id(mv: mlflow.entities.model_registry.ModelVersion) -> str | None:
    """
    Resolve a run_id from a ModelVersion, parsing the source URI as a fallback.

    `mv.run_id` is None when models are saved via `log_artifacts()` instead of
    the typed `log_model()` API. The run_id still appears as the parent of
    `artifacts/` in the source URI, so we parse it out.
    """
    if mv.run_id:
        return mv.run_id

    parts = (mv.source or "").replace("\\", "/").split("/")
    if "artifacts" in parts:
        return parts[parts.index("artifacts") - 1]
    return None


def _upload_to_r2(model_name: str, version: str, run_id: str) -> None:
    """
    Publish a registered model's artifacts to Cloudflare R2.

    Downloads the run's `model` artifact directory from MLflow, uploads each file
    to ``s3://<bucket>/models/<model_name>/<version>/<filename>``

    Required env vars: R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
    Optional: R2_BUCKET (defaults to ``sharkpark-ml-exports``).
    """
    import boto3

    endpoint_url = os.environ.get("R2_ENDPOINT_URL")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket = os.environ.get("R2_BUCKET") or _DEFAULT_R2_BUCKET

    missing = [
        name
        for name, val in (
            ("R2_ENDPOINT_URL", endpoint_url),
            ("R2_ACCESS_KEY_ID", access_key),
            ("R2_SECRET_ACCESS_KEY", secret_key),
        )
        if not val
    ]
    if missing:
        raise RuntimeError(f"Missing required R2 env vars: {', '.join(missing)}")

    # R2 ignores region; "auto" just satisfies boto3's signing requirement.
    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    artifact_prefix = f"models/{model_name}/{version}"
    pointer_key = f"models/{model_name}/production.json"

    logger.info(
        "Publishing %s v%s to R2 (s3://%s/%s/)",
        model_name,
        version,
        bucket,
        artifact_prefix,
    )

    # Upload mlflow artifacts to R2
    with tempfile.TemporaryDirectory() as tmp:
        local_dir = mlflow.artifacts.download_artifacts(
            run_id=run_id, artifact_path="model", dst_path=tmp
        )
        local_path = Path(local_dir)

        for filename in _MODEL_ARTIFACT_FILES:
            src = local_path / filename

            if not src.exists():
                raise FileNotFoundError(
                    f"Required artifact {filename} missing from run {run_id}"
                )

            key = f"{artifact_prefix}/{filename}"
            content_type = (
                "application/json"
                if filename.endswith(".json")
                else "application/octet-stream"
            )
            client.upload_file(
                str(src),
                bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            )
            logger.info("  uploaded s3://%s/%s", bucket, key)

    # Write pointer last to avoid reading partial uploads.
    pointer = {
        "model_name": model_name,
        "version": str(version),
        "run_id": run_id,
        "promoted_at": datetime.now(timezone.utc).isoformat(),
        "artifact_path": f"s3://{bucket}/{artifact_prefix}/",
        "files": list(_MODEL_ARTIFACT_FILES),
    }

    client.put_object(
        Bucket=bucket,
        Key=pointer_key,
        Body=json.dumps(pointer, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    logger.info("  wrote pointer s3://%s/%s → v%s", bucket, pointer_key, version)


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

    Args:
        model_name: Registered model name.

    Returns:
        run_id string, or None if it cannot be determined.

    Raises:
        mlflow.exceptions.MlflowException: For errors other than model not found.
    """
    client = mlflow.tracking.MlflowClient()
    mv = client.get_model_version_by_alias(model_name, "production")
    return _resolve_run_id(mv)
