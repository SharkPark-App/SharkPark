"""
Promotion entrypoint for SharkPark short-term model.

Registers a candidate model in the MLflow Model Registry as
"short-term-production" and transitions it to the Production stage.

Usage:
    python scripts/promote.py --run-id <mlflow-run-id>
    python scripts/promote.py --run-id <mlflow-run-id> --export-s3

Note: Currently short-term only. When long-term is implemented, add a
--model-type flag to select features, model class, and baselines.
"""

import argparse
import logging

import mlflow

from src.config import SHORT_TERM_MODEL_NAME

logger = logging.getLogger(__name__)


def promote(run_id: str, export_s3: bool = False) -> str | None:
    """
    Register a model version and promote it to Production.

    Args:
        run_id: MLflow run ID of the model to promote.
        export_s3: If True, print a placeholder message for S3 export.

    Returns:
        The registered model version number.
    """
    client = mlflow.tracking.MlflowClient()

    # Verify the run exists
    try:
        run = client.get_run(run_id)
    except mlflow.exceptions.MlflowException:
        logger.error("Run '%s' not found. Check the run ID and try again.", run_id)
        return None

    artifact_uri = run.info.artifact_uri
    model_uri = f"{artifact_uri}/model"

    # Register model to mlflow
    logger.info("Registering model from run %s...", run_id)
    try:
        result = mlflow.register_model(model_uri, SHORT_TERM_MODEL_NAME)
    except mlflow.exceptions.MlflowException as e:
        logger.error("Failed to register model — %s", e)
        return None

    version = result.version

    # Set production alias (automatically removes it from any previous version)
    try:
        client.set_registered_model_alias(SHORT_TERM_MODEL_NAME, "production", version)
    except mlflow.exceptions.MlflowException as e:
        logger.error(
            "Model registered as v%s but failed to set production alias — %s",
            version,
            e,
        )
        return version

    logger.info("Model registered: %s v%s", SHORT_TERM_MODEL_NAME, version)
    logger.info("Alias: @production")
    logger.info("Run ID: %s", run_id)

    # Print promotion metrics from the run
    metrics = run.data.metrics
    if metrics:
        logger.info("MAE:  %s", metrics.get("mae", "N/A"))
        logger.info("RMSE: %s", metrics.get("rmse", "N/A"))

    if export_s3:
        logger.info(
            "\n[S3 Export] Not implemented yet. When deployed to Lambda, "
            "this will upload the model artifact to S3 for Lambda-based inference."
        )

    print("\nNext step:")
    print("  python -m scripts.predict")
    print("  python -m scripts.predict --start-of-day    # all hours (dev)")
    print("  python -m scripts.predict --write-local      # also write to local file")

    return version


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Promote a model to production")
    parser.add_argument(
        "--run-id",
        required=True,
        help="MLflow run ID of the model to promote",
    )
    parser.add_argument(
        "--export-s3",
        action="store_true",
        help="Export model to S3 (placeholder — not yet implemented)",
    )
    args = parser.parse_args()

    promote(args.run_id, args.export_s3)
