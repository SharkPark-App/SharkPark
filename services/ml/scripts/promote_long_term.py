"""
Promotion entrypoint for SharkPark long-term model.

Registers a candidate model in the MLflow Model Registry as
"long-term-production" and sets the production alias.

Usage:
    python scripts/promote_long_term.py --run-id <mlflow-run-id>
    python scripts/promote_long_term.py --run-id <mlflow-run-id> --export-s3
"""

import argparse
import logging
import sys

from src.config import LONG_TERM_MODEL_NAME, LONG_TERM_HORIZON_DAYS
from src.utils.mlflow_utils import promote_model

logger = logging.getLogger(__name__)


def promote(run_id: str, export_s3: bool = False) -> str | None:
    """
    Promote a long-term model to production.

    Returns:
        The registered model version number, or None on failure.
    """
    version, alias_set, run = promote_model(run_id, LONG_TERM_MODEL_NAME, export_s3)
    if version is None:
        return None

    if not alias_set:
        return version

    metrics = run.data.metrics
    if metrics:
        logger.info("Overall MAE: %s", metrics.get("mae", "N/A"))
        for d in range(1, LONG_TERM_HORIZON_DAYS + 1):
            key = f"mae_day_{d}"
            if key in metrics:
                logger.info("  Day %d MAE: %s", d, metrics[key])

    print("\nNext step:")
    print("  python -m scripts.predict_long_term")
    print(
        "  python -m scripts.predict_long_term --write-local  # also write to local file"
    )

    return version


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(
        description="Promote a long-term model to production"
    )
    parser.add_argument(
        "--run-id", required=True, help="MLflow run ID of the model to promote"
    )
    parser.add_argument(
        "--export-s3",
        action="store_true",
        help="Export model to S3 (placeholder — not yet implemented)",
    )
    args = parser.parse_args()

    version = promote(args.run_id, args.export_s3)
    if version is None:
        sys.exit(1)
