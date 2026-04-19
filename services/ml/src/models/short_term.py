"""
Short-term XGBoost regression model for SharkPark ML.

Single global model (all lots, lot_id as categorical feature).
Predicts occupancy_rate for hours 7-21 per lot.

Usage:
    model = ShortTermModel()
    split_info = model.train(snapshot_df)
    predictions = model.predict(features_df)
    model.save("models/short_term_v1")
    model = ShortTermModel.load("models/short_term_v1")
"""

from datetime import timedelta

import numpy as np
import pandas as pd
import xgboost as xgb

from src.config import COLD_START_CI_MULTIPLIER
from src.features.short_term import prepare_training_features
from src.models.base import BaseXGBoostModel

__all__ = [
    "NUMERIC_FEATURES",
    "CATEGORICAL_FEATURES",
    "TARGET_COL",
    "HOLDOUT_DAYS",
    "ShortTermModel",
]


# =============================================================================
# Feature Configuration
# =============================================================================

NUMERIC_FEATURES = [
    "hour",
    "day_of_week",
    "week_of_semester",
    "is_campus_open",
    "occupancy_rate",
    "occupancy_rate_lag_1",
    "occupancy_rate_lag_2",
    "occupancy_rate_lag_3",
    "occupancy_rate_lag_4",
    "momentum",
    "target_hour",
    "hours_ahead",
]

CATEGORICAL_FEATURES = ["lot_id", "semester", "academic_period"]

TARGET_COL = "target_occupancy_rate"

HOLDOUT_DAYS = 14  # Hold out most recent 2 weeks for testing


# =============================================================================
# Model
# =============================================================================


class ShortTermModel(BaseXGBoostModel):
    """
    XGBoost regression model for short-term occupancy prediction.

    Trains on features from src.features.short_term (lags, momentum, time
    context, academic period). Uses lot_id as a categorical feature so a
    single global model serves all lots.

    Includes quantile regression models (10th and 90th percentile) for
    confidence intervals via predict_quantiles().
    """

    NUMERIC_FEATURES = NUMERIC_FEATURES
    CATEGORICAL_FEATURES = CATEGORICAL_FEATURES
    TARGET_COL = TARGET_COL
    MLFLOW_EXPERIMENT = "sharkpark-short-term"
    MLFLOW_RUN_NAME = "short-term-training"

    # -----------------------------------------------------------------
    # Training
    # -----------------------------------------------------------------

    def train(
        self,
        df: pd.DataFrame,
        synthetic_weight: float = 1.0,
        cold_start_weight: float = 1.0,
        hyperparams: dict | None = None,
    ) -> dict:
        """
        Train the model on snapshot data.

        Args:
            df: Raw OccupancySnapshot DataFrame (output of synthetic.py).
                Must include lot_id, timestamp, occupancy, available,
                occupancy_rate, confidence, semester, academic_period,
                week_of_semester, is_campus_open, is_cold_start (bool),
                _source ("synthetic"/"real").
            synthetic_weight: Sample weight for synthetic rows (0.0-1.0).
            cold_start_weight: Sample weight for real cold-start rows (0.0-1.0).
            hyperparams: Optional dict of XGBoost hyperparameters. Merged with
                DEFAULT_HYPERPARAMS (caller values take precedence).

        Returns:
            Dict with train_size, test_size, split_date, feature_columns,
            test_predictions, test_predictions_lower, test_predictions_upper,
            test_actuals, test_features.
        """
        # Temporal train/test split: hold out most recent 2 weeks
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        max_date = df["timestamp"].max()
        split_date = max_date - timedelta(days=HOLDOUT_DAYS)

        has_source = "_source" in df.columns
        use_weights = has_source and (
            synthetic_weight != 1.0 or cold_start_weight != 1.0
        )

        # Split train/test according to split date
        train_raw = df[df["timestamp"] <= split_date]
        test_raw = df[df["timestamp"] > split_date]

        # Do not filter LOW confidence: real cold-start rows are LOW by
        # definition, and cold_start_weight is the mechanism for downweighting
        # them. Filtering here would drop the rows the weights were meant to handle.
        train_features = prepare_training_features(train_raw, min_confidence=None)
        test_features = prepare_training_features(test_raw, min_confidence=None)

        if train_features.empty:
            raise ValueError("No training features after split — need more data.")

        # Build volume-normalized sample weights from _source / is_cold_start
        if use_weights:
            sample_weight = self._build_sample_weights(
                train_features,
                synthetic_weight,
                cold_start_weight,
            )
        else:
            sample_weight = None

        # Encode categoricals
        self._fit_category_mappings(train_features)
        X_train, y_train = self._prepare_xy(train_features)

        # TODO: tune hyperparams with Optuna or similar once we have enough real data
        shared_params = {**self.DEFAULT_HYPERPARAMS, **(hyperparams or {})}
        self.hyperparams = shared_params.copy()

        # Median model (point predictions)
        self.model = xgb.XGBRegressor(
            objective="reg:squarederror",
            **shared_params,
        )
        self.model.fit(X_train, y_train, sample_weight=sample_weight)

        # Quantile models for confidence intervals
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
            test_preds = np.clip(self.model.predict(X_test), 0.0, 1.0)
            test_preds_lower = np.clip(self.model_lower.predict(X_test), 0.0, 1.0)
            test_preds_upper = np.clip(self.model_upper.predict(X_test), 0.0, 1.0)

            # Coverage: fraction of actuals within [lower, upper]
            in_interval = (y_test >= test_preds_lower) & (y_test <= test_preds_upper)
            coverage = float(in_interval.mean())

            # Mean interval width (narrower is better at same coverage)
            mean_interval_width = float((test_preds_upper - test_preds_lower).mean())

            result["test_predictions"] = test_preds
            result["test_predictions_lower"] = test_preds_lower
            result["test_predictions_upper"] = test_preds_upper
            result["quantile_coverage"] = coverage
            result["mean_interval_width"] = mean_interval_width
            result["test_actuals"] = y_test
            result["test_features"] = test_features

        return result

    # -----------------------------------------------------------------
    # Prediction
    # -----------------------------------------------------------------

    def predict(self, features_df: pd.DataFrame) -> np.ndarray:
        """
        Generate median predictions from prepared features.

        Args:
            features_df: DataFrame with the same feature columns used
                during training (output of prepare_training_features or
                prepare_inference_features).

        Returns:
            Array of predicted occupancy rates, clamped to [0, 1].
        """
        if self.model is None:
            raise RuntimeError("Model has not been trained. Call train() first.")

        X, _ = self._prepare_xy(features_df, has_target=False)
        predictions = self.model.predict(X)

        # Clip predictions within valid range [0, 1]
        return np.clip(predictions, 0.0, 1.0)

    def predict_quantiles(
        self, features_df: pd.DataFrame
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Generate median, lower (10th percentile), and upper (90th percentile) predictions.

        Cold-start lots (identified by ``is_cold_start`` column in *features_df*)
        receive widened confidence intervals to reflect higher uncertainty.

        Args:
            features_df: DataFrame with the same feature columns used during training.
                May include an ``is_cold_start`` boolean column (not used as a model
                feature, only for interval widening).

        Returns:
            Tuple of (median, lower, upper) arrays, each clamped to [0, 1].
        """
        if self.model is None or self.model_lower is None or self.model_upper is None:
            raise RuntimeError("Model has not been trained. Call train() first.")

        X, _ = self._prepare_xy(features_df, has_target=False)
        median = np.clip(self.model.predict(X), 0.0, 1.0)
        lower = np.clip(self.model_lower.predict(X), 0.0, 1.0)
        upper = np.clip(self.model_upper.predict(X), 0.0, 1.0)

        # Enforce ordering: lower <= median <= upper
        lower = np.minimum(lower, median)
        upper = np.maximum(upper, median)

        # Widen confidence intervals for cold-start lots
        if "is_cold_start" in features_df.columns:
            cold = features_df["is_cold_start"].values.astype(bool)
            if cold.any():
                m = COLD_START_CI_MULTIPLIER
                spread_lower = median - lower
                spread_upper = upper - median
                lower[cold] = median[cold] - spread_lower[cold] * m
                upper[cold] = median[cold] + spread_upper[cold] * m

                lower = np.clip(lower, 0.0, 1.0)
                upper = np.clip(upper, 0.0, 1.0)

        return median, lower, upper
