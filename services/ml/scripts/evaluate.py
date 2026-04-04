"""
Evaluation entrypoint for SharkPark short-term model.

Loads a candidate model from MLflow, rebuilds the test set with the same
temporal split, and compares against baselines and production.

Both candidate and production models are evaluated on the same test set
(derived from the candidate's data) for a fair comparison.

Usage:
    python scripts/evaluate.py --run-id <mlflow-run-id>
    python scripts/evaluate.py --run-id <mlflow-run-id> --data-path data/custom.parquet

By default, downloads the training data artifact from the MLflow run.
Use --data-path to override with a different dataset.

Note: Currently short-term only. When long-term is implemented, add a
--model-type flag to select features, model class, and baselines.
"""

import argparse
import logging
import tempfile
from datetime import timedelta
from pathlib import Path

import mlflow
import pandas as pd

from src.config import SHORT_TERM_MODEL_NAME
from src.evaluation.compare import compare_models
from src.evaluation.metrics import compute_metrics
from src.features.short_term import prepare_training_features
from src.models.short_term import HOLDOUT_DAYS, ShortTermModel

logger = logging.getLogger(__name__)


def evaluate(run_id: str, data_path: str | None = None) -> dict:
    """
    Evaluate a candidate model against baselines and production.

    Args:
        run_id: MLflow run ID of the candidate model.
        data_path: Optional path to parquet file. If not provided, downloads
            the training data artifact logged with the run.

    Returns:
        Dict with:
            - results: {model_name: metrics_dict} for Candidate, baselines,
              and Production (if exists)
            - should_promote: bool indicating whether candidate should replace production
            - promotion_reason: str explaining the decision
    """
    if data_path:
        path = Path(data_path)
        if not path.exists():
            raise FileNotFoundError(f"Data file not found: {path}")

    # Load model from mlflow run_id
    logger.info("Loading candidate model from run %s...", run_id)
    model = ShortTermModel.load_mlflow(run_id)

    # Load data: from explicit path or from run artifact
    if data_path:
        logger.info("Loading data from %s...", path)
        df = pd.read_parquet(path)
    else:
        logger.info("Downloading training data artifact from run...")
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = mlflow.artifacts.download_artifacts(
                run_id=run_id, artifact_path="data", dst_path=tmp
            )
            parquet_files = list(Path(data_dir).glob("*.parquet"))
            if not parquet_files:
                raise FileNotFoundError(
                    "No data artifact found in run. Pass --data-path manually."
                )
            df = pd.read_parquet(parquet_files[0])
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    # Reproduce the same temporal split used during training
    split_date = df["timestamp"].max() - timedelta(days=HOLDOUT_DAYS)
    test_raw = df[df["timestamp"] > split_date].copy()

    logger.info("Rebuilding test features (records after %s)...", split_date.date())
    test_features = prepare_training_features(test_raw)

    if test_features.empty:
        raise ValueError("No test features produced — check data and split date.")

    # Generate candidate predictions on test set
    preds = model.predict(test_features)
    actuals = test_features["target_occupancy_rate"].values

    candidate_metrics = compute_metrics(actuals, preds)

    # Evaluate on the same test set as candidate (avoids data drift bias)
    production_metrics = _evaluate_production_on_test(test_features)

    # Run full comparison
    comparison = compare_models(
        candidate_metrics=candidate_metrics,
        test_features=test_features,
        raw_df=df,
        production_metrics=production_metrics,
        total_lots=df["lot_id"].nunique(),
    )

    logger.info("")
    if comparison["should_promote"]:
        logger.info("PROMOTE: %s", comparison["promotion_reason"])
        print(
            f"\nNext step (only if promotion is approved):\n  python -m scripts.promote --run-id {run_id}"
        )
    else:
        logger.info("DO NOT PROMOTE: Candidate does not meet promotion criteria.")

    return comparison


def _evaluate_production_on_test(test_features: pd.DataFrame) -> dict | None:
    """
    Load the production model and evaluate it on the same test set as the
    candidate for a fair apples-to-apples comparison.

    Args:
        test_features: Test set DataFrame with target_occupancy_rate column,
            same data used to evaluate the candidate model.

    Returns:
        Metrics dict (mae, rmse, mape, etc.) from production model predictions,
        or None if no production model is registered.
    """
    try:
        client = mlflow.tracking.MlflowClient()
        mv = client.get_model_version_by_alias(SHORT_TERM_MODEL_NAME, "production")

        # Get the run that produced this model version
        run_id = mv.run_id
        if run_id is None:
            # Fallback: parse run_id from the artifact URI
            source = mv.source
            parts = source.replace("\\", "/").split("/")
            if "artifacts" in parts:
                run_id = parts[parts.index("artifacts") - 1]

        if not run_id:
            logger.warning(
                "Could not determine production run ID — treating as first deployment."
            )
            return None

        # Load production model and score it on the candidate's test set
        logger.info(
            "Re-evaluating production model (run %s) on candidate test set...", run_id
        )
        prod_model = ShortTermModel.load_mlflow(run_id)
        prod_preds = prod_model.predict(test_features)
        actuals = test_features["target_occupancy_rate"].values
        return compute_metrics(actuals, prod_preds)

    except mlflow.exceptions.MlflowException as e:
        if e.error_code == "RESOURCE_DOES_NOT_EXIST":
            logger.info("No production model registered — first deployment.")
            return None
        logger.error(
            "MLflow error while loading production model (error_code=%s): %s",
            e.error_code,
            e,
        )
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Evaluate a candidate model")
    parser.add_argument(
        "--run-id",
        required=True,
        help="MLflow run ID of the candidate model",
    )
    parser.add_argument(
        "--data-path",
        default=None,
        help="Path to parquet data file. If omitted, downloads the data artifact from the run.",
    )
    args = parser.parse_args()

    evaluate(args.run_id, args.data_path)
