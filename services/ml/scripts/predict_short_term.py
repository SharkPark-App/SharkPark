"""
Batch inference entrypoint for SharkPark short-term model.

Loads the latest production model from MLflow, builds inference
features from recent snapshot data, and writes predictions to the
predictions_short_term database table (default) and optionally to a local file.

Usage:
    python scripts/predict_short_term.py                                        # read from DB, write to DB
    python scripts/predict_short_term.py --data-path data/custom.parquet        # use parquet instead of DB
    python scripts/predict_short_term.py --start-of-day                         # predict all hours (7-21)
    python scripts/predict_short_term.py --write-local                            # also write to local CSV
    python scripts/predict_short_term.py --write-local --output-path data/preds.csv

"""

import argparse
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import mlflow
import numpy as np
import pandas as pd

from collections import Counter

from src.config import (
    SHORT_TERM_MODEL_NAME,
    OPERATING_START_HOUR,
    WEATHER_ADJUSTMENT_ENABLED,
)

CAMPUS_TZ = ZoneInfo("America/Los_Angeles")
UTC = ZoneInfo("UTC")

from src.features.short_term import prepare_inference_features
from src.models.short_term import ShortTermModel
from src.postprocess.weather_adjustment import apply_weather_adjustment

logger = logging.getLogger(__name__)


def predict(
    data_path: str | None = None,
    output_path: str = "data/predictions_short_term.csv",
    start_of_day: bool = False,
    write_local: bool = False,
) -> pd.DataFrame:
    """
    Run batch inference and write predictions.

    Always writes to the predictions_short_term database table.
    Optionally also writes to a local CSV when write_local is True.

    Args:
        data_path: Path to parquet with recent snapshot data.
            If None, fetches recent snapshots from PostgreSQL.
        output_path: Path to write local CSV output.
        start_of_day: Predict for all operating hours regardless of current time.
        write_local: Also write predictions to a local CSV file.

    Returns:
        DataFrame of predictions.
    """
    # Load production model
    model, model_version = _load_production_model()

    # Load snapshot data: from parquet file or directly from DB
    if data_path:
        path = Path(data_path)
        if not path.exists():
            raise FileNotFoundError(f"Data file not found: {path}")
        logger.info("Loading data from %s...", path)
        df = pd.read_parquet(path)
    else:
        from src.data.db import fetch_recent_snapshots

        logger.info("Fetching recent snapshots from database...")
        df = fetch_recent_snapshots()

    df["timestamp"] = pd.to_datetime(df["timestamp"])

    lot_ids = df["lot_id"].unique().tolist()
    # Anchor "now" in campus tz explicitly — datetime.now() depends on the host's
    # TZ env, which is correct on Fly today but silently wrong on a UTC host.
    if start_of_day:
        prediction_time = datetime.now(CAMPUS_TZ).replace(
            hour=OPERATING_START_HOUR - 1, minute=0, second=0, microsecond=0
        )
    else:
        prediction_time = datetime.now(CAMPUS_TZ)

    logger.info("Building inference features for %s lots...", len(lot_ids))
    features = prepare_inference_features(df, lot_ids, prediction_time)

    if features.empty:
        logger.info("No prediction hours remaining for today. Exiting.")
        return pd.DataFrame()

    # Generate predictions with quantile confidence intervals
    preds, preds_lower, preds_upper = model.predict_quantiles(features)

    # Rule-based weather adjustment
    if WEATHER_ADJUSTMENT_ENABLED:
        from src.data.db import fetch_latest_weather, get_school_id_for_lots

        school_id = get_school_id_for_lots(lot_ids)
        weather = fetch_latest_weather(school_id)
        preds, preds_lower, preds_upper, weather_reasons = apply_weather_adjustment(
            preds,
            preds_lower,
            preds_upper,
            features,
            weather,
        )

        reason_counts = Counter(weather_reasons)
        summary = ", ".join(
            f"{reason}={count}" for reason, count in sorted(reason_counts.items())
        )
        logger.info(
            "Weather adjustment: %s (rows=%d)", summary or "NORMAL=all", len(features)
        )

    # Build output matching predictions_short_term schema
    predictions = _build_prediction_df(
        features=features,
        preds=preds,
        preds_lower=preds_lower,
        preds_upper=preds_upper,
        model_version=model_version,
        prediction_time=prediction_time,
    )

    # Write to database (default)
    from src.data.db import write_short_term_predictions

    n = write_short_term_predictions(predictions)
    logger.info("\nWrote %s predictions to database (predictions_short_term)", n)

    # Optionally write to local file
    if write_local:
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        predictions.to_csv(output, index=False)
        logger.info("Wrote %s predictions to %s", len(predictions), output)

    logger.info("Lots: %s", predictions["lot_id"].nunique())
    target_times = pd.to_datetime(predictions["target_time"])
    logger.info("Hours: %s", [int(h) for h in sorted(target_times.dt.hour.unique())])
    logger.info(
        "Predicted occupancy range: %s - %s",
        predictions["predicted_occupancy"].min(),
        predictions["predicted_occupancy"].max(),
    )

    return predictions


def _load_production_model() -> tuple[ShortTermModel, str]:
    """
    Load the latest production model from MLflow registry.

    Returns:
        (model, model_version_string)
    """
    client = mlflow.tracking.MlflowClient()

    try:
        version_info = client.get_model_version_by_alias(
            SHORT_TERM_MODEL_NAME, "production"
        )
    except mlflow.exceptions.MlflowException as e:
        if e.error_code == "RESOURCE_DOES_NOT_EXIST":
            raise RuntimeError(
                f"No production model found for '{SHORT_TERM_MODEL_NAME}'. "
                "Run train.py and promote.py first."
            )
        logger.error(
            "MLflow error while loading production model (error_code=%s): %s",
            e.error_code,
            e,
        )
        raise

    version = version_info.version
    run_id = version_info.run_id

    if run_id is None:
        # File-based registry may not populate run_id; extract from source path
        source = version_info.source.replace("\\", "/")
        parts = source.split("/")
        if "artifacts" in parts:
            run_id = parts[parts.index("artifacts") - 1]

    if not run_id:
        raise RuntimeError(
            f"Could not determine run ID for {SHORT_TERM_MODEL_NAME} v{version}."
        )

    logger.info("Loading production model: %s v%s", SHORT_TERM_MODEL_NAME, version)
    model = ShortTermModel.load_mlflow(run_id)

    return model, f"v{version}"


def _build_prediction_df(
    features: pd.DataFrame,
    preds: np.ndarray,
    preds_lower: np.ndarray,
    preds_upper: np.ndarray,
    model_version: str,
    prediction_time: datetime,
) -> pd.DataFrame:
    """
    Build a DataFrame matching the predictions_short_term schema.

    Stores occupancy rates [0, 1] directly. Confidence bounds come from
    quantile regression (10th/90th percentile).
    """
    # Persist as UTC — backend writes via Prisma store naive UTC in
    # TIMESTAMP WITHOUT TIME ZONE columns (verified: snapshots, weather).
    # Writing PT here mis-aligns prediction rows from the rest of the schema.
    base_time = prediction_time.replace(minute=0, second=0, microsecond=0, tzinfo=None)
    target_times_local = pd.to_datetime(
        features["target_hour"].astype(int), unit="h", origin=base_time.replace(hour=0)
    )
    target_times_utc = (
        target_times_local.dt.tz_localize(
            CAMPUS_TZ, ambiguous="NaT", nonexistent="shift_forward"
        )
        .dt.tz_convert(UTC)
        .dt.tz_localize(None)
    )
    predicted_at_utc = prediction_time.astimezone(UTC).replace(tzinfo=None)

    return pd.DataFrame(
        {
            "lot_id": features["lot_id"],
            "predicted_at": predicted_at_utc.isoformat(),
            "target_time": target_times_utc.dt.strftime("%Y-%m-%dT%H:%M:%S"),
            "predicted_occupancy": preds,
            "confidence_lower": preds_lower,
            "confidence_upper": preds_upper,
            "model_version": model_version,
        }
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Run batch inference")
    parser.add_argument(
        "--data-path",
        default=None,
        help="Path to parquet file with recent snapshots. Defaults to fetching live data from PostgreSQL.",
    )
    parser.add_argument(
        "--write-local",
        action="store_true",
        help="Write predictions to a local file in addition to the database.",
    )
    parser.add_argument(
        "--output-path",
        default="data/predictions_short_term.csv",
        help="Where to save the local CSV (requires --write-local). Default: data/predictions_short_term.csv",
    )
    parser.add_argument(
        "--start-of-day",
        action="store_true",
        help="Predict all operating hours (7-21) regardless of current time. Use for scheduled runs (e.g. nightly cron) so the full day's predictions are available before operating hours.",
    )
    args = parser.parse_args()

    predict(
        args.data_path,
        args.output_path,
        args.start_of_day,
        args.write_local,
    )
