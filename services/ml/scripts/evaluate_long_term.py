"""
Evaluation entrypoint for SharkPark long-term model.

Loads a candidate model from MLflow, rebuilds the test set with the same
temporal split, and compares against baselines and production.

Both candidate and production models are evaluated on the same test set
(derived from the candidate's data) for a fair comparison.

Long-term promotion gates (must all pass):
    1. Beat all active baselines (coverage-gated)
    2. Meet per-horizon MAE targets
    3. Improve over production by >=5% MAE or >=3pp directional accuracy
       (auto-pass if no production model exists)

Usage:
    python scripts/evaluate_long_term.py --run-id <mlflow-run-id>
    python scripts/evaluate_long_term.py --run-id <mlflow-run-id> --data-path data/custom.parquet
"""

import argparse
import logging
from datetime import timedelta
from pathlib import Path

import mlflow
import numpy as np
import pandas as pd

from src.config import LONG_TERM_MODEL_NAME
from src.evaluation.compare import (
    HORIZON_MAE_TARGETS,
    build_horizon_promotion_reason,
    build_promotion_reason,
    compare_against_long_term_baselines,
    compare_models,
    meets_horizon_targets,
    meets_promotion_criteria,
    print_horizon_table,
)
from src.evaluation.metrics import compute_metrics
from src.features.long_term import compute_baseline, prepare_training_features
from src.models.long_term import HOLDOUT_DAYS, LongTermModel, TARGET_COL
from src.utils.mlflow_setup import configure_mlflow
from src.utils.mlflow_utils import get_production_run_id, load_run_data

# Apply tracking-URI / experiment defaults at import time so any code path
# that imports this module (CLI, tests, ad-hoc imports) talks to the same
# MLflow backend the training jobs use. Mirrors train_long_term.py.
configure_mlflow()

logger = logging.getLogger(__name__)


def evaluate(run_id: str, data_path: str | None = None) -> dict:
    """
    Evaluate a candidate long-term model against baselines and production.

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
            - horizon_mae: {days_ahead: MAE} for each horizon (1-7)
    """
    if data_path:
        path = Path(data_path)
        if not path.exists():
            raise FileNotFoundError(f"Data file not found: {path}")

    # Load model from mlflow run_id
    logger.info("Loading candidate model from run %s...", run_id)
    model = LongTermModel.load_mlflow(run_id)

    # Load data: from explicit path or run artifact
    if data_path:
        logger.info("Loading data from %s...", path)
        df = pd.read_parquet(path)
    else:
        logger.info("Downloading training data artifact from run...")
        df = load_run_data(run_id)

    df["timestamp"] = pd.to_datetime(df["timestamp"])

    # Reproduce the same temporal split used during training
    split_date = df["timestamp"].max() - timedelta(days=HOLDOUT_DAYS)
    test_raw = df[df["timestamp"] > split_date].copy()
    train_raw = df[df["timestamp"] <= split_date].copy()
    logger.info(
        "Rebuilding baseline from training data (records up to %s)...",
        split_date.date(),
    )

    baseline_df = compute_baseline(train_raw)

    logger.info("Rebuilding test features (records after %s)...", split_date.date())
    test_features = prepare_training_features(test_raw, baseline_df)

    if test_features.empty:
        raise ValueError("No test features produced — check data and split date.")

    # Candidate predictions: convert deviations back to occupancy rates
    candidate_rates, actual_rates = _predict_rates(model, test_features)
    candidate_metrics = compute_metrics(actual_rates, candidate_rates)

    horizon_mae = _compute_horizon_mae(test_features, candidate_rates, actual_rates)

    # Baselines (coverage-gated)
    baseline_results = compare_against_long_term_baselines(
        candidate_metrics=candidate_metrics,
        test_features=test_features,
        raw_df=df,
        actual_rates=actual_rates,
        total_lots=df["lot_id"].nunique(),
    )

    # Production (re-evaluated on candidate's test set)
    production_metrics = _evaluate_production_on_test(test_features)

    baseline_only = {
        k: v for k, v in baseline_results.items() if k != "Candidate"
    }  # compare_model adds another Candidate dict

    # Full comparison (prints table, computes baseline pass/fail)
    print_horizon_table(horizon_mae)
    comparison = compare_models(
        candidate_metrics=candidate_metrics,
        test_features=test_features,
        raw_df=df,
        production_metrics=production_metrics,
        baseline_results=baseline_only,
    )
    baseline_passed = comparison["baseline_passed"]
    failed_baselines = comparison["failed_baselines"]

    # Horizon-stratified gate
    horizon_passed, failed_days = meets_horizon_targets(horizon_mae)
    production_passed = meets_promotion_criteria(candidate_metrics, production_metrics)
    should_promote = baseline_passed and horizon_passed and production_passed

    # Build promotion reason
    if not horizon_passed:
        promotion_reason = build_horizon_promotion_reason(False, failed_days)
    else:
        promotion_reason = build_promotion_reason(
            candidate_metrics,
            production_metrics,
            should_promote=should_promote,
            baseline_passed=baseline_passed,
            failed_baselines=failed_baselines,
        )

    logger.info("")
    if should_promote:
        logger.info("PROMOTE: %s", promotion_reason)
        print(
            f"\nNext step (only if promotion is approved):\n"
            f"  python -m scripts.promote_long_term --run-id {run_id}"
        )
    else:
        logger.info("DO NOT PROMOTE: %s", promotion_reason)

    return {
        "results": comparison["results"],
        "should_promote": should_promote,
        "promotion_reason": promotion_reason,
        "horizon_mae": horizon_mae,
        "horizon_passed": horizon_passed,
        "failed_days": failed_days,
    }


def _predict_rates(
    model: LongTermModel, test_features: pd.DataFrame
) -> tuple[np.ndarray, np.ndarray]:
    """
    Run the candidate model on test features and convert deviation predictions
    back to occupancy rates. Returns (candidate_rates, actual_rates).
    """
    candidate_rates = model.predict(test_features)
    y_dev = test_features[TARGET_COL].values

    baselines = test_features["historical_baseline"].values
    actual_rates = np.clip(baselines + y_dev, 0.0, 1.0)
    return candidate_rates, actual_rates


def _compute_horizon_mae(
    test_features: pd.DataFrame,
    candidate_rates: np.ndarray,
    actual_rates: np.ndarray,
) -> dict[int, float]:
    """Compute per-horizon (1-7 days_ahead) MAE for the candidate predictions."""
    if "days_ahead" not in test_features.columns:
        return {}

    days_ahead = test_features["days_ahead"].values
    horizon_mae: dict[int, float] = {}
    for day in sorted(HORIZON_MAE_TARGETS.keys()):
        mask = days_ahead == day
        if mask.sum() > 0:
            horizon_mae[day] = float(
                np.mean(np.abs(candidate_rates[mask] - actual_rates[mask]))
            )
    return horizon_mae


def _evaluate_production_on_test(test_features: pd.DataFrame) -> dict | None:
    """
    Load the production model and evaluate it on the same test set as the
    candidate for a fair comparison. Returns metrics or None when no
    production model exists.
    """
    try:
        run_id = get_production_run_id(LONG_TERM_MODEL_NAME)
        if not run_id:
            logger.warning(
                "Could not determine production run ID — treating as first deployment."
            )
            return None

        logger.info(
            "Re-evaluating production model (run %s) on candidate test set...", run_id
        )
        prod_model = LongTermModel.load_mlflow(run_id)
        prod_rates, actual_rates = _predict_rates(prod_model, test_features)
        return compute_metrics(actual_rates, prod_rates)

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
    parser = argparse.ArgumentParser(description="Evaluate a candidate long-term model")
    parser.add_argument(
        "--run-id", required=True, help="MLflow run ID of the candidate model"
    )
    parser.add_argument(
        "--data-path",
        default=None,
        help="Path to parquet data file. If omitted, downloads artifact from the run.",
    )
    args = parser.parse_args()

    evaluate(args.run_id, args.data_path)
