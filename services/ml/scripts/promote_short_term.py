"""
Promotion entrypoint for SharkPark short-term model.

Registers a candidate model in the MLflow Model Registry as
"short-term-production" and sets the production alias.

Usage:
    python scripts/promote_short_term.py --run-id <mlflow-run-id>
    python scripts/promote_short_term.py --run-id <mlflow-run-id> --export-s3
    python scripts/promote_short_term.py --upload-only <version>

"""

import argparse
import logging
import sys

from src.config import SHORT_TERM_MODEL_NAME
from src.utils.mlflow_utils import promote_model, upload_model_to_r2
from src.utils.promotion_guard import evaluate_promotion_candidate

logger = logging.getLogger(__name__)


def promote(run_id: str, export_s3: bool = False) -> str | None:
    """
    Promote a short-term model to production.

    Returns:
        The registered model version number, or None on failure.
    """
    version, alias_set, run = promote_model(run_id, SHORT_TERM_MODEL_NAME, export_s3)
    if version is None:
        return None

    if not alias_set:
        return version

    metrics = run.data.metrics
    if metrics:
        logger.info("MAE:  %s", metrics.get("mae", "N/A"))
        logger.info("RMSE: %s", metrics.get("rmse", "N/A"))

    print("\nNext step:")
    print("  python -m scripts.predict_short_term")
    print("  python -m scripts.predict_short_term --start-of-day    # all hours (dev)")
    print("  python -m scripts.predict_short_term --write-local      # also write to local file")

    return version


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Promote a model to production")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--run-id",
        "--candidate-run-id",
        dest="run_id",
        help="MLflow run ID of the model to promote",
    )
    group.add_argument(
        "--upload-only",
        metavar="VERSION",
        help="Upload an already-registered version to R2 without re-promoting",
    )
    parser.add_argument(
        "--export-s3",
        action="store_true",
        help="Publish artifacts to R2 in addition to local MLflow registration",
    )
    parser.add_argument(
        "--auto-only",
        action="store_true",
        help=(
            "Only promote if promotion_guard.evaluate_promotion_candidate() "
            "returns promote=True. No-op (exit 0) otherwise. Used by the "
            "ml-retrain GitHub Actions workflow."
        ),
    )
    args = parser.parse_args()

    if args.upload_only:
        upload_model_to_r2(SHORT_TERM_MODEL_NAME, args.upload_only)
        sys.exit(0)

    if args.auto_only:
        decision = evaluate_promotion_candidate(args.run_id, SHORT_TERM_MODEL_NAME)
        logger.info("Promotion guard: %s", decision.reason)
        if not decision.promote:
            logger.info(
                "Skipping promotion. Candidate run %s remains in MLflow as a non-production version.",
                args.run_id,
            )
            sys.exit(0)

    version = promote(args.run_id, args.export_s3)
    if version is None:
        sys.exit(1)
