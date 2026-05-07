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
    *,
    include_synthetic_v2: bool = False,
    synthetic_v2_school: Optional[str] = None,
    synthetic_v2_term: Optional[str] = None,
    synthetic_v2_weight: float = 1.0,
    real_weight: float = 1.0,
) -> str:
    """
    Train a short-term model and log to MLflow.

    Args:
        data_path: Path or glob pattern for parquet file(s) with synthetic data
            (legacy v1). Pass an empty/non-matching pattern alongside
            ``--include-synthetic-v2`` to train on v2 only.
        include_real: If True, also load real data from PostgreSQL.
        real_start_date: Inclusive lower bound for real data query (ISO date string).
        real_end_date: Exclusive upper bound for real data query (ISO date string).
        synthetic_weight: Tier weight for synthetic v1 (legacy parquet) rows.
            Spec default: 0.1.
        cold_start_weight: Tier weight for real cold-start rows.
        hyperparams: Optional XGBoost overrides (e.g. n_estimators, max_depth, learning_rate).
        include_synthetic_v2: If True, also load v2 catalog-driven synthetic
            rows from the ``synthetic_observations`` table.
        synthetic_v2_school: School short_name filter for v2 loader (required
            when ``include_synthetic_v2=True``).
        synthetic_v2_term: Term filter for v2 loader (e.g. ``"Spring_2026"``).
        synthetic_v2_weight: Tier weight for v2 rows. Spec default: 1.0.
        real_weight: Tier weight for real established rows. Spec default: 10.0.

    Returns:
        MLflow run ID.
    """
    # Load synthetic v1 data (supports glob patterns for multiple parquets).
    # When --include-synthetic-v2 is set we tolerate an empty v1 glob so the
    # caller can train on v2 alone without forging an empty parquet file.
    paths = sorted(glob.glob(data_path))
    v1_frames: list[pd.DataFrame] = []
    if not paths:
        if not include_synthetic_v2:
            path = Path(data_path)
            raise FileNotFoundError(
                f"Data file not found: {path}\n"
                "Run 'python -m src.data.synthetic' first to generate synthetic data,\n"
                "or pass --include-synthetic-v2 to load from synthetic_observations."
            )
        logger.info("No v1 parquet files matched %s — using v2 only.", data_path)
    else:
        for p in paths:
            logger.info("Loading synthetic v1 data from %s...", p)
            v1_frames.append(pd.read_parquet(p))

    if v1_frames:
        df_v1 = pd.concat(v1_frames, ignore_index=True)
        # Tag v1 metadata so 4-tier weighting can distinguish parquet from DB.
        if "_source" not in df_v1.columns:
            df_v1["_source"] = "synthetic"
        df_v1["generator_version"] = "v1"
        if "sample_weight" not in df_v1.columns:
            df_v1["sample_weight"] = 1.0
        logger.info(
            "  Synthetic v1: %s rows, %s lots (%s file%s)",
            f"{len(df_v1):,}",
            df_v1["lot_id"].nunique(),
            len(paths),
            "s" if len(paths) > 1 else "",
        )
    else:
        df_v1 = pd.DataFrame()

    # Load synthetic v2 data from synthetic_observations if requested.
    if include_synthetic_v2:
        if synthetic_v2_school is None:
            raise ValueError(
                "--synthetic-v2-school is required when --include-synthetic-v2 is set."
            )
        from src.data.db import load_synthetic_v2_snapshots

        logger.info(
            "Loading synthetic v2 from synthetic_observations (school=%s, term=%s)...",
            synthetic_v2_school,
            synthetic_v2_term,
        )
        df_v2 = load_synthetic_v2_snapshots(
            school_short_name=synthetic_v2_school,
            term=synthetic_v2_term,
        )
        logger.info(
            "  Synthetic v2: %s rows, %s lots",
            f"{len(df_v2):,}",
            df_v2["lot_id"].nunique() if not df_v2.empty else 0,
        )
    else:
        df_v2 = pd.DataFrame()

    # Prefer v2 rows on overlapping (lot_id, timestamp) keys so we do not
    # double-count the same slot from both synthetic tiers.
    if not df_v1.empty and not df_v2.empty:
        v1_keys = pd.DataFrame(
            {
                "lot_id": df_v1["lot_id"],
                "timestamp": pd.to_datetime(df_v1["timestamp"], utc=True, errors="coerce")
                .dt.tz_localize(None),
            }
        )
        v2_keys = pd.DataFrame(
            {
                "lot_id": df_v2["lot_id"],
                "timestamp": pd.to_datetime(df_v2["timestamp"], utc=True, errors="coerce")
                .dt.tz_localize(None),
            }
        ).drop_duplicates()
        v1_mask = (
            v1_keys.merge(v2_keys, on=["lot_id", "timestamp"], how="left", indicator=True)[
                "_merge"
            ]
            == "left_only"
        )
        dropped_overlap = int((~v1_mask).sum())
        if dropped_overlap:
            logger.info(
                "  Dropped %s overlapping synthetic v1 rows replaced by v2",
                f"{dropped_overlap:,}",
            )
        df_v1 = df_v1.loc[v1_mask].reset_index(drop=True)

    # Concatenate synthetic tiers; align columns so the 4-tier weighter
    # can read generator_version + sample_weight per row.
    if not df_v1.empty and not df_v2.empty:
        df_synthetic = pd.concat([df_v1, df_v2], ignore_index=True, sort=False)
    elif not df_v2.empty:
        df_synthetic = df_v2
    elif not df_v1.empty:
        df_synthetic = df_v1
    else:
        raise ValueError(
            "No synthetic data loaded — neither v1 parquets nor v2 DB rows are available."
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
        real_weight=real_weight,
        synthetic_v2_weight=synthetic_v2_weight,
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
        "include_synthetic_v2": include_synthetic_v2,
        "synthetic_v2_school": synthetic_v2_school,
        "synthetic_v2_term": synthetic_v2_term,
        "real_weight": real_weight,
        "synthetic_weight": synthetic_weight,
        "synthetic_v2_weight": synthetic_v2_weight,
        "cold_start_weight": cold_start_weight,
        "synthetic_v1_rows": int(len(df_v1)),
        "synthetic_v2_rows": int(len(df_v2)),
        "synthetic_rows": int(len(df_synthetic)),
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
        help=(
            "Tier weight for synthetic v1 (parquet) rows. Spec default: 0.1. "
            "Default kept at 1.0 for backward compatibility."
        ),
    )
    parser.add_argument(
        "--cold-start-weight",
        type=float,
        default=1.0,
        metavar="W",
        help="Tier weight for real cold-start rows. Default: 1.0.",
    )
    parser.add_argument(
        "--real-weight",
        type=float,
        default=1.0,
        metavar="W",
        help=(
            "Tier weight for real established rows. Spec default: 10.0. "
            "Default kept at 1.0 for backward compatibility."
        ),
    )
    parser.add_argument(
        "--include-synthetic-v2",
        action="store_true",
        default=False,
        help="Load catalog-driven synthetic v2 rows from synthetic_observations.",
    )
    parser.add_argument(
        "--synthetic-v2-school",
        default=None,
        metavar="SHORT_NAME",
        help="School short_name filter for v2 loader (e.g. CSULB). Required with --include-synthetic-v2.",
    )
    parser.add_argument(
        "--synthetic-v2-term",
        default=None,
        metavar="TERM",
        help="Term filter for v2 loader (e.g. Spring_2026).",
    )
    parser.add_argument(
        "--synthetic-v2-weight",
        type=float,
        default=1.0,
        metavar="W",
        help="Tier weight for synthetic v2 rows. Spec default: 1.0.",
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
        include_synthetic_v2=args.include_synthetic_v2,
        synthetic_v2_school=args.synthetic_v2_school,
        synthetic_v2_term=args.synthetic_v2_term,
        synthetic_v2_weight=args.synthetic_v2_weight,
        real_weight=args.real_weight,
    )
