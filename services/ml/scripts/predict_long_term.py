"""
Batch inference entrypoint for SharkPark long-term model.

Loads the latest production model from MLflow, computes the historical baseline
from recent snapshots, and writes 7-day rolling predictions to the
predictions_long_term database table.

Usage:
    python scripts/predict_long_term.py                              # read from DB, write to DB
    python scripts/predict_long_term.py --data-path data/custom.parquet
    python scripts/predict_long_term.py --write-local
    python scripts/predict_long_term.py --write-local --output-path data/preds_long_term.csv
    python scripts/predict_long_term.py --days-ahead 3               # only next 3 days
"""

import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import mlflow
import numpy as np
import pandas as pd

from src.config import (
    LONG_TERM_HORIZON_DAYS,
    LONG_TERM_MODEL_NAME,
    LONG_TERM_BASELINE_WEEKS,
)
from src.features.long_term import compute_baseline, prepare_inference_features
from src.models.long_term import LongTermModel

CAMPUS_TZ = ZoneInfo("America/Los_Angeles")

logger = logging.getLogger(__name__)


def predict(
    data_path: str | None = None,
    output_path: str = "data/predictions_long_term.csv",
    days_ahead: int = LONG_TERM_HORIZON_DAYS,
    write_local: bool = False,
) -> pd.DataFrame:
    """
    Run long-term batch inference and write predictions.

    Always writes to the predictions_long_term database table.
    Optionally also writes to a local CSV when write_local is True.

    Args:
        data_path: Path to parquet with snapshot data.
            If None, fetches historical snapshots from PostgreSQL.
        output_path: Path to write local CSV output.
        days_ahead: Number of days to forecast (1-7).
        write_local: Also write predictions to a local CSV file.

    Returns:
        DataFrame of predictions.
    """
    days_ahead = max(1, min(days_ahead, LONG_TERM_HORIZON_DAYS))

    model, model_version = _load_production_model()

    if data_path:
        path = Path(data_path)
        if not path.exists():
            raise FileNotFoundError(f"Data file not found: {path}")
        logger.info("Loading data from %s...", path)
        df = pd.read_parquet(path)
    else:
        from src.data.db import load_historical_snapshots

        logger.info("Fetching historical snapshots from database...")
        df = load_historical_snapshots(lookback_weeks=LONG_TERM_BASELINE_WEEKS)

    df["timestamp"] = pd.to_datetime(df["timestamp"])

    logger.info("Computing historical baseline...")
    baseline_df = compute_baseline(df)

    lot_ids = df["lot_id"].unique().tolist()

    today = datetime.now(CAMPUS_TZ).date()
    target_dates = [today + timedelta(days=d) for d in range(1, days_ahead + 1)]
    logger.info(
        "Building inference features for %d lots x %d days x 15 hours...",
        len(lot_ids),
        len(target_dates),
    )

    features = prepare_inference_features(
        target_dates=target_dates,
        lot_ids=lot_ids,
        baseline=baseline_df,
        snapshot_df=df,
        reference_date=today,
    )
    if features.empty:
        logger.info("No inference features generated. Exiting.")
        return pd.DataFrame()

    median, lower, upper = model.predict_quantiles(features)

    predictions_df = _build_prediction_df(
        features=features,
        median=median,
        lower=lower,
        upper=upper,
        model_version=model_version,
    )

    # Write to database
    from src.data.db import write_long_term_predictions

    n = write_long_term_predictions(predictions_df)
    logger.info("\nWrote %s predictions to database (predictions_long_term)", n)

    # Optionally write to local file
    if write_local:
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        predictions_df.to_csv(output, index=False)
        logger.info("Wrote %s predictions to %s", len(predictions_df), output)

    logger.info("Lots: %s", predictions_df["lot_id"].nunique())
    logger.info(
        "Dates: %s to %s",
        predictions_df["target_date"].min(),
        predictions_df["target_date"].max(),
    )
    logger.info(
        "Predicted occupancy range: %s - %s",
        predictions_df["predicted_occupancy"].min(),
        predictions_df["predicted_occupancy"].max(),
    )

    return predictions_df


def _load_production_model() -> tuple[LongTermModel, str]:
    """Load the latest production long-term model from MLflow registry."""
    client = mlflow.tracking.MlflowClient()

    try:
        version_info = client.get_model_version_by_alias(
            LONG_TERM_MODEL_NAME, "production"
        )
    except mlflow.exceptions.MlflowException as e:
        if e.error_code == "RESOURCE_DOES_NOT_EXIST":
            raise RuntimeError(
                f"No production model found for '{LONG_TERM_MODEL_NAME}'. "
                "Run train_long_term.py and promote_long_term.py first."
            )
        raise

    version = version_info.version
    run_id = version_info.run_id

    if run_id is None:
        source = version_info.source.replace("\\", "/")
        parts = source.split("/")
        if "artifacts" in parts:
            run_id = parts[parts.index("artifacts") - 1]

    if not run_id:
        raise RuntimeError(
            f"Could not determine run ID for {LONG_TERM_MODEL_NAME} v{version}."
        )

    logger.info("Loading production model: %s v%s", LONG_TERM_MODEL_NAME, version)
    model = LongTermModel.load_mlflow(run_id)

    return model, f"v{version}"


def _build_prediction_df(
    features: pd.DataFrame,
    median: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    model_version: str,
) -> pd.DataFrame:
    """
    Build a DataFrame matching the predictions_long_term schema.

    Stores occupancy rates [0, 1] directly. Confidence bounds come from
    quantile regression.
    """
    df = pd.DataFrame(
        {
            "lot_id": features["lot_id"].values,
            "target_date": features["target_date"].values,
            "target_hour": features["target_hour"].values,
            "predicted_occupancy": median,
            "confidence_lower": lower,
            "confidence_upper": upper,
        }
    )
    df["predicted_at"] = pd.Timestamp.now("UTC").isoformat()
    df["model_version"] = model_version
    return df


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Run long-term batch inference")
    parser.add_argument(
        "--data-path",
        default=None,
        help="Path to parquet file with snapshot data. Defaults to fetching live data from PostgreSQL.",
    )
    parser.add_argument(
        "--write-local",
        action="store_true",
        help="Write predictions to a local file in addition to the database.",
    )
    parser.add_argument(
        "--output-path",
        default="data/predictions_long_term.csv",
        help="Where to save the local CSV (requires --write-local). Default: data/predictions_long_term.csv",
    )
    parser.add_argument(
        "--days-ahead",
        type=int,
        default=LONG_TERM_HORIZON_DAYS,
        metavar="N",
        help=f"Number of days to forecast (1-{LONG_TERM_HORIZON_DAYS}). Default: {LONG_TERM_HORIZON_DAYS}",
    )
    args = parser.parse_args()

    predict(
        args.data_path,
        args.output_path,
        args.days_ahead,
        args.write_local,
    )
