"""
Long-term two-stage hybrid model for SharkPark ML.

Stage 1 — Historical Baseline:
    4-week rolling average per (lot_id, academic_period, day_of_week, hour).
    Computed by compute_baseline() in src.features.long_term.

Stage 2 — XGBoost Adjustment:
    Predicts deviation from baseline using calendar and horizon features.
    Final prediction: clip(baseline + xgb_deviation, 0, 1).

Includes quantile regression (10th/90th percentile) for confidence intervals,
with cold-start CI widening identical to the short-term model.

Usage:
    model = LongTermModel()
    split_info = model.train(snapshot_df)
    median, lower, upper = model.predict_quantiles(inference_df)
    model.save("models/long_term_v1")
    model = LongTermModel.load("models/long_term_v1")
"""

from datetime import timedelta

import numpy as np
import pandas as pd
import xgboost as xgb

from src.config import COLD_START_CI_MULTIPLIER, LONG_TERM_HORIZON_DAYS
from src.features.long_term import compute_baseline, prepare_training_features
from src.models.base import BaseXGBoostModel

__all__ = [
    "NUMERIC_FEATURES",
    "CATEGORICAL_FEATURES",
    "TARGET_COL",
    "HOLDOUT_DAYS",
    "LongTermModel",
]


# =============================================================================
# Feature Configuration
# =============================================================================

NUMERIC_FEATURES = [
    "historical_baseline",
    "days_ahead",
    "week_of_semester",
    "is_campus_open",
    "sin_hour",
    "cos_hour",
    "sin_day",
    "cos_day",
]

CATEGORICAL_FEATURES = ["lot_id", "semester", "academic_period"]

TARGET_COL = "deviation"  # actual_occupancy_rate - historical_baseline

HOLDOUT_DAYS = 14  # Hold out most recent 2 weeks for testing


# =============================================================================
# Model
# =============================================================================


class LongTermModel(BaseXGBoostModel):
    """
    Two-stage XGBoost model for long-term occupancy prediction.

    Stage 1 (baseline) is pre-computed by compute_baseline() and passed in
    at training and inference time. Stage 2 XGBoost learns deviations from
    that baseline using calendar and horizon features.

    Three quantile models (median, 10th, 90th percentile) provide confidence
    intervals. Cold-start lots receive widened intervals.
    """

    NUMERIC_FEATURES = NUMERIC_FEATURES
    CATEGORICAL_FEATURES = CATEGORICAL_FEATURES
    TARGET_COL = TARGET_COL
    MLFLOW_EXPERIMENT = "sharkpark-long-term"
    MLFLOW_RUN_NAME = "long-term-training"

    # -----------------------------------------------------------------
    # Training
    # -----------------------------------------------------------------

    def train(
        self,
        df: pd.DataFrame,
        synthetic_weight: float = 1.0,
        cold_start_weight: float = 1.0,
        hyperparams: dict | None = None,
        *,
        real_weight: float = 1.0,
        synthetic_v2_weight: float = 1.0,
    ) -> dict:
        """
        Train the long-term model on snapshot data.

        Computes the historical baseline internally and stores it on the
        instance as ``self.baseline_df`` for later use during prediction.

        Args:
            df: Raw OccupancySnapshot DataFrame (output of synthetic.py).
                Must include lot_id, timestamp, occupancy, available,
                occupancy_rate, confidence, semester, academic_period,
                week_of_semester, is_campus_open, is_cold_start (bool),
                _source ("synthetic"/"real").
            synthetic_weight: Tier weight for synthetic v1 (legacy parquet)
                rows. Spec default at the script layer is ``0.1``.
            cold_start_weight: Tier weight for real cold-start rows.
            hyperparams: Optional dict of XGBoost hyperparameters. Merged with
                DEFAULT_HYPERPARAMS (caller values take precedence).
            real_weight: Tier weight for real established rows. Spec default
                at the script layer is ``10.0``.
            synthetic_v2_weight: Tier weight for catalog-driven synthetic v2
                rows (``generator_version=='v2'``). Spec default ``1.0``.

        Returns:
            Dict with train_size, test_size, split_date, feature_columns,
            horizon_mae (dict of days_ahead -> MAE), and test data for evaluation.
        """
        # Temporal train/test split
        df["timestamp"] = pd.to_datetime(df["timestamp"])

        baseline_df = compute_baseline(df)
        self.baseline_df = baseline_df

        max_date = df["timestamp"].max()
        split_date = max_date - timedelta(days=HOLDOUT_DAYS)

        has_source = "_source" in df.columns
        use_weights = has_source and (
            synthetic_weight != 1.0
            or cold_start_weight != 1.0
            or real_weight != 1.0
            or synthetic_v2_weight != 1.0
        )

        # Split train/test according to split date
        train_raw = df[df["timestamp"] <= split_date]
        test_raw = df[df["timestamp"] > split_date]

        # Do not filter LOW confidence: real cold-start rows are LOW by
        # definition, and cold_start_weight is the mechanism for downweighting
        # them. Filtering here would drop the rows the weights were meant to handle.
        train_features = prepare_training_features(
            train_raw, baseline_df, min_confidence=None
        )
        test_features = prepare_training_features(
            test_raw, baseline_df, min_confidence=None
        )

        if train_features.empty:
            raise ValueError("No training features after split — need more data.")

        # Build volume-normalized sample weights (4 tiers + per-lot decay).
        if use_weights:
            sample_weight = self._build_sample_weights(
                train_features,
                synthetic_weight,
                cold_start_weight,
                real_weight=real_weight,
                synthetic_v2_weight=synthetic_v2_weight,
            )
        else:
            sample_weight = None

        # Encode categoricals
        self._fit_category_mappings(train_features)
        X_train, y_train = self._prepare_xy(train_features)

        # TODO: tune hyperparams with Optuna or similar once we have enough real data
        shared_params = {**self.DEFAULT_HYPERPARAMS, **(hyperparams or {})}
        self.hyperparams = shared_params.copy()

        self.model = xgb.XGBRegressor(
            objective="reg:squarederror",
            **shared_params,
        )
        self.model.fit(X_train, y_train, sample_weight=sample_weight)

        # Quantile models for CI
        self.model_lower = xgb.XGBRegressor(
            objective="reg:quantileerror",
            quantile_alpha=0.1,
            **shared_params,
        )
        self.model_lower.fit(X_train, y_train, sample_weight=sample_weight)

        self.model_upper = xgb.XGBRegressor(
            objective="reg:quantileerror",
            quantile_alpha=0.9,
            **shared_params,
        )
        self.model_upper.fit(X_train, y_train, sample_weight=sample_weight)

        result = {
            "train_size": len(train_features),
            "test_size": len(test_features),
            "split_date": str(split_date.date()),
            "feature_columns": self.feature_columns,
        }

        # Attach test features for evaluation convenience
        if not test_features.empty:
            X_test, y_test = self._prepare_xy(test_features)
            test_preds = self.model.predict(X_test)
            test_baselines = test_features["historical_baseline"].values
            predicted_rates = np.clip(test_baselines + test_preds, 0.0, 1.0)
            actual_rates = np.clip(test_baselines + y_test, 0.0, 1.0)

            # Horizon-stratified MAE
            horizon_mae = {}
            for d in range(1, LONG_TERM_HORIZON_DAYS + 1):
                mask = test_features["days_ahead"].values == d
                if mask.sum() > 0:
                    horizon_mae[d] = float(
                        np.mean(np.abs(predicted_rates[mask] - actual_rates[mask]))
                    )

            # Quantile predictions on test set
            dev_lower = self.model_lower.predict(X_test)
            dev_upper = self.model_upper.predict(X_test)
            predicted_lower = np.clip(test_baselines + dev_lower, 0.0, 1.0)
            predicted_upper = np.clip(test_baselines + dev_upper, 0.0, 1.0)

            # Coverage: fraction of actuals within [lower, upper]
            in_interval = (actual_rates >= predicted_lower) & (
                actual_rates <= predicted_upper
            )
            coverage = float(in_interval.mean())

            # Mean interval width (narrower is better at same coverage)
            mean_interval_width = float((predicted_upper - predicted_lower).mean())

            result["horizon_mae"] = horizon_mae
            result["quantile_coverage"] = coverage
            result["mean_interval_width"] = mean_interval_width
            result["test_predictions"] = predicted_rates
            result["test_predictions_lower"] = predicted_lower
            result["test_predictions_upper"] = predicted_upper
            result["test_actuals"] = actual_rates
            result["test_features"] = test_features

        return result

    # -----------------------------------------------------------------
    # Prediction
    # -----------------------------------------------------------------

    def predict(self, features_df: pd.DataFrame) -> np.ndarray:
        """
        Generate median predictions from prepared features.

        Args:
            features_df: DataFrame with historical_baseline and all Stage 2
                feature columns (output of prepare_training_features or
                prepare_inference_features).

        Returns:
            Array of predicted occupancy rates, clamped to [0, 1].
        """
        if self.model is None:
            raise RuntimeError("Model has not been trained. Call train() first.")

        X, _ = self._prepare_xy(features_df, has_target=False)
        dev_preds = self.model.predict(X)
        baselines = features_df["historical_baseline"].values

        return np.clip(baselines + dev_preds, 0.0, 1.0)

    def predict_quantiles(
        self,
        features_df: pd.DataFrame,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Generate median, lower (10th percentile), and upper (90th percentile) predictions.

        Cold-start lots (identified by ``is_cold_start`` column in *features_df*)
        receive widened confidence intervals to reflect higher uncertainty.

        Args:
            features_df: DataFrame with historical_baseline and all Stage 2
                feature columns (output of prepare_training_features or
                prepare_inference_features). May include an ``is_cold_start``
                boolean column (not used as a model feature, only for interval
                widening).

        Returns:
            Tuple of (median, lower, upper) arrays of occupancy rates,
            each clamped to [0, 1].
        """
        if self.model is None or self.model_lower is None or self.model_upper is None:
            raise RuntimeError("Model has not been trained. Call train() first.")

        X, _ = self._prepare_xy(features_df, has_target=False)
        dev_median = self.model.predict(X)
        dev_lower = self.model_lower.predict(X)
        dev_upper = self.model_upper.predict(X)

        baseline = features_df["historical_baseline"].values

        median = np.clip(baseline + dev_median, 0.0, 1.0)
        lower = np.clip(baseline + dev_lower, 0.0, 1.0)
        upper = np.clip(baseline + dev_upper, 0.0, 1.0)

        # Enforce ordering
        lower = np.minimum(lower, median)
        upper = np.maximum(upper, median)

        # Widen CI for cold-start lots
        if "is_cold_start" in features_df.columns:
            cold = features_df["is_cold_start"].values.astype(bool)
            if cold.any():
                m = COLD_START_CI_MULTIPLIER
                spread_lower = median - lower
                spread_upper = upper - median
                lower[cold] = np.clip(median[cold] - spread_lower[cold] * m, 0.0, 1.0)
                upper[cold] = np.clip(median[cold] + spread_upper[cold] * m, 0.0, 1.0)

        return median, lower, upper
