"""
Training entrypoint for SharkPark short-term model.

Loads synthetic data from parquet (and optionally real data from PostgreSQL),
trains the XGBoost model, and logs the run (params + metrics) to MLflow.

Usage:
    python scripts/train_short_term.py
    python scripts/train_short_term.py --data-path data/custom.parquet
    python scripts/train_short_term.py --data-path "data/synthetic_*.parquet"   # multiple semesters
    python scripts/train_short_term.py --include-real
    python scripts/train_short_term.py --include-real --synthetic-weight 0.3

"""

import argparse
import glob
import logging
import tempfile
from pathlib import Path
from typing import Optional

import pandas as pd

from src.evaluation.metrics import compute_metrics
from src.features.base import merge_real_synthetic
from src.models.short_term import ShortTermModel

logger = logging.getLogger(__name__)


def train(
    data_path: str,
    include_real: bool = False,
    real_start_date: Optional[str] = None,
    real_end_date: Optional[str] = None,
    synthetic_weight: float = 1.0,
    cold_start_weight: float = 1.0,
    hyperparams: dict | None = None,
) -> str:
    """
    Train a short-term model and log to MLflow.

    Args:
        data_path: Path or glob pattern for parquet file(s) with synthetic data.
        include_real: If True, also load real data from PostgreSQL.
        real_start_date: Inclusive lower bound for real data query (ISO date string).
        real_end_date: Exclusive upper bound for real data query (ISO date string).
        synthetic_weight: Group weight for synthetic rows (0.0-1.0). Default: 1.0 (uniform).
        cold_start_weight: Group weight for real cold-start rows (0.0-1.0). Default: 1.0 (uniform).
        hyperparams: Optional XGBoost overrides (e.g. n_estimators, max_depth, learning_rate).

    Returns:
        MLflow run ID.
    """
    # Load synthetic data (supports glob patterns for multiple parquets)
    paths = sorted(glob.glob(data_path))
    if not paths:
        # No glob match — treat as literal path for a clear error message
        path = Path(data_path)
        raise FileNotFoundError(
            f"Data file not found: {path}\n"
            "Run 'python -m src.data.synthetic' first to generate synthetic data."
        )

    frames = []
    for p in paths:
        logger.info("Loading synthetic data from %s...", p)
        frames.append(pd.read_parquet(p))
    df_synthetic = pd.concat(frames, ignore_index=True)

    logger.info(
        "  Synthetic: %s rows, %s lots (%s file%s)",
        f"{len(df_synthetic):,}",
        df_synthetic["lot_id"].nunique(),
        len(paths),
        "s" if len(paths) > 1 else "",
    )

    # Mix real + synthetic data: real data replaces synthetic for overlapping dates
    df = df_synthetic
    if include_real:
        from src.data.db import load_real_snapshots

        logger.info("Loading real data from PostgreSQL...")
        df_real = load_real_snapshots(
            start_date=real_start_date, end_date=real_end_date
        )
        logger.info(
            "  Real: %s rows, %s lots", f"{len(df_real):,}", df_real["lot_id"].nunique()
        )

        if not df_real.empty:
            df = merge_real_synthetic(df_real, df_synthetic)
        else:
            logger.info("  No real data found — using synthetic only.")

    logger.info("Training on %s rows, %s lots", f"{len(df):,}", df["lot_id"].nunique())

    # Train model
    model = ShortTermModel()
    logger.info("Training model...")
    result = model.train(
        df,
        synthetic_weight=synthetic_weight,
        cold_start_weight=cold_start_weight,
        hyperparams=hyperparams,
    )

    logger.info("Train size: %s", f"{result['train_size']:,}")
    logger.info("Test size:  %s", f"{result['test_size']:,}")
    logger.info("Split date: %s", result["split_date"])

    # Compute metrics on test set
    if "test_predictions" not in result:
        raise ValueError("No test predictions — not enough data for temporal split.")
    metrics = compute_metrics(result["test_actuals"], result["test_predictions"])
    if "quantile_coverage" in result:
        metrics["quantile_coverage"] = result["quantile_coverage"]
        metrics["mean_interval_width"] = result["mean_interval_width"]

    params = {
        **model.hyperparams,
        "train_size": result["train_size"],
        "test_size": result["test_size"],
        "split_date": result["split_date"],
        "data_path": data_path,
        "include_real": include_real,
        "synthetic_weight": synthetic_weight,
        "cold_start_weight": cold_start_weight,
        "synthetic_rows": len(df_synthetic),
    }

    # Log the combined (real + synthetic) dataframe as the artifact
    with tempfile.TemporaryDirectory() as tmp:
        combined_path = Path(tmp) / "training_data.parquet"
        df.to_parquet(combined_path)
        run_id = model.save_mlflow(metrics, params, data_path=str(combined_path))

    # Display mlflow run id and metrics
    logger.info("\nMLflow run ID: %s", run_id)
    logger.info("MAE:  %.4f", metrics["mae"])
    logger.info("RMSE: %.4f", metrics["rmse"])
    logger.info("MAPE: %.1f%%", metrics["mape"])
    if "quantile_coverage" in result:
        logger.info(
            "Quantile coverage (10-90): %.1f%%  |  Mean interval width: %.4f",
            result["quantile_coverage"] * 100,
            result["mean_interval_width"],
        )
    print(f"\nNext step:\n  python -m scripts.evaluate_short_term --run-id {run_id}")

    return run_id


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Train short-term occupancy model")
    parser.add_argument(
        "--data-path",
        default="data/synthetic_*.parquet",
        help="Path or glob pattern for parquet data file(s) (default: data/synthetic_*.parquet)",
    )
    parser.add_argument(
        "--include-real",
        action="store_true",
        default=False,
        help="Include real occupancy data from PostgreSQL alongside synthetic data.",
    )
    parser.add_argument(
        "--real-start-date",
        default=None,
        metavar="DATE",
        help="Start date for real data query (ISO format: YYYY-MM-DD). Default: no lower bound.",
    )
    parser.add_argument(
        "--real-end-date",
        default=None,
        metavar="DATE",
        help="End date for real data query (ISO format: YYYY-MM-DD). Default: no upper bound.",
    )
    parser.add_argument(
        "--synthetic-weight",
        type=float,
        default=1.0,
        metavar="W",
        help="Sample weight for synthetic rows (0.0-1.0). Default: 1.0 (uniform).",
    )
    parser.add_argument(
        "--cold-start-weight",
        type=float,
        default=1.0,
        metavar="W",
        help="Sample weight for real cold-start rows (0.0-1.0). Default: 1.0 (uniform).",
    )
    parser.add_argument(
        "--n-estimators", type=int, default=None, help="Number of boosting rounds."
    )
    parser.add_argument(
        "--max-depth", type=int, default=None, help="Maximum tree depth."
    )
    parser.add_argument(
        "--learning-rate", type=float, default=None, help="Boosting learning rate."
    )
    parser.add_argument(
        "--subsample", type=float, default=None, help="Row subsample ratio (0.0-1.0)."
    )
    parser.add_argument(
        "--colsample-bytree",
        type=float,
        default=None,
        help="Column subsample ratio (0.0-1.0).",
    )
    args = parser.parse_args()

    hp = {}
    if args.n_estimators is not None:
        hp["n_estimators"] = args.n_estimators
    if args.max_depth is not None:
        hp["max_depth"] = args.max_depth
    if args.learning_rate is not None:
        hp["learning_rate"] = args.learning_rate
    if args.subsample is not None:
        hp["subsample"] = args.subsample
    if args.colsample_bytree is not None:
        hp["colsample_bytree"] = args.colsample_bytree

    train(
        data_path=args.data_path,
        include_real=args.include_real,
        real_start_date=args.real_start_date,
        real_end_date=args.real_end_date,
        synthetic_weight=args.synthetic_weight,
        cold_start_weight=args.cold_start_weight,
        hyperparams=hp or None,
    )
