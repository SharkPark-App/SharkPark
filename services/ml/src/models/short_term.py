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
from pathlib import Path

import joblib
import mlflow
import numpy as np
import pandas as pd
import xgboost as xgb

from src.features.short_term import prepare_training_features

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
    "sin_hour",
    "cos_hour",
    "sin_day",
    "cos_day",
    "target_hour",
    "hours_ahead",
]

CATEGORICAL_FEATURES = ["lot_id", "academic_period"]

TARGET_COL = "target_occupancy_rate"

HOLDOUT_DAYS = 14  # Hold out most recent 2 weeks for testing


# =============================================================================
# Model
# =============================================================================


class ShortTermModel:
    """
    XGBoost regression model for short-term occupancy prediction.

    Trains on features from src.features.short_term (lags, momentum, time
    context, academic period). Uses lot_id as a categorical feature so a
    single global model serves all lots.

    Includes quantile regression models (10th and 90th percentile) for
    confidence intervals via predict_quantiles().
    """

    def __init__(self):
        self.model: xgb.XGBRegressor | None = None
        self.model_lower: xgb.XGBRegressor | None = None
        self.model_upper: xgb.XGBRegressor | None = None
        self.category_mappings: dict[str, dict[str, int]] = {}
        self.feature_columns: list[str] = []

    # -----------------------------------------------------------------
    # Training
    # -----------------------------------------------------------------

    def train(self, df: pd.DataFrame) -> dict:
        """
        Train the model on snapshot data.

        Args:
            df: Raw OccupancySnapshot DataFrame (output of synthetic.py).
                Must include lot_id, timestamp, occupancy, occupancy_rate,
                academic_period, week_of_semester, is_campus_open.

        Returns:
            Dict with train_size, test_size, split_date, feature_columns,
            test_predictions, test_predictions_lower, test_predictions_upper,
            test_actuals, test_features.
        """
        # Temporal train/test split: hold out most recent 2 weeks
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        max_date = df["timestamp"].max()
        split_date = max_date - timedelta(days=HOLDOUT_DAYS)

        # Split train/test according to split date
        df_sorted = df.sort_values("timestamp")
        train_raw = df_sorted[df_sorted["timestamp"] <= split_date]
        test_raw = df_sorted[df_sorted["timestamp"] > split_date]

        train_features = prepare_training_features(train_raw)
        test_features = prepare_training_features(test_raw)

        if train_features.empty:
            raise ValueError("No training features after split — need more data.")

        # Encode categoricals
        self._fit_category_mappings(train_features)
        X_train, y_train = self._prepare_xy(train_features)

        # Shared hyperparams for all three models
        shared_params = dict(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
        )

        # Median model (point predictions)
        self.model = xgb.XGBRegressor(
            objective="reg:squarederror",
            **shared_params,
        )
        self.model.fit(X_train, y_train)

        # Quantile models for confidence intervals
        self.model_lower = xgb.XGBRegressor(
            objective="reg:quantileerror",
            quantile_alpha=0.1,
            **shared_params,
        )
        self.model_lower.fit(X_train, y_train)

        self.model_upper = xgb.XGBRegressor(
            objective="reg:quantileerror",
            quantile_alpha=0.9,
            **shared_params,
        )
        self.model_upper.fit(X_train, y_train)

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
            result["test_predictions"] = test_preds
            result["test_predictions_lower"] = test_preds_lower
            result["test_predictions_upper"] = test_preds_upper
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

        Args:
            features_df: DataFrame with the same feature columns used during training.

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

        return median, lower, upper

    # -----------------------------------------------------------------
    # Persistence (local files)
    # -----------------------------------------------------------------

    def save(self, path: str) -> None:
        """
        Save model and category mappings to disk.

        Creates a directory at `path` containing:
            - model.json (XGBoost median model)
            - model_lower.json (XGBoost 10th percentile model)
            - model_upper.json (XGBoost 90th percentile model)
            - metadata.joblib (category mappings, feature columns)
        """
        if self.model is None:
            raise RuntimeError("No trained model to save.")

        directory = Path(path)
        directory.mkdir(parents=True, exist_ok=True)

        # Save all three models (quantile regression)
        self.model.save_model(str(directory / "model.json"))
        if self.model_lower is not None:
            self.model_lower.save_model(str(directory / "model_lower.json"))
        if self.model_upper is not None:
            self.model_upper.save_model(str(directory / "model_upper.json"))

        # Save preprocessing metadata for load() to reconstruct feature encoding
        joblib.dump(
            {
                "category_mappings": self.category_mappings,
                "feature_columns": self.feature_columns,
            },
            directory / "metadata.joblib",
        )

    @classmethod
    def load(cls, path: str) -> "ShortTermModel":
        """
        Load a saved model from disk.

        Args:
            path: Directory containing model.json, model_lower.json,
                  model_upper.json, and metadata.joblib.

        Returns:
            ShortTermModel instance ready for prediction.
        """
        directory = Path(path)

        instance = cls()
        instance.model = xgb.XGBRegressor()
        instance.model.load_model(str(directory / "model.json"))

        # Load quantile models if present
        lower_path = directory / "model_lower.json"
        upper_path = directory / "model_upper.json"
        if lower_path.exists() and upper_path.exists():
            instance.model_lower = xgb.XGBRegressor()
            instance.model_lower.load_model(str(lower_path))
            instance.model_upper = xgb.XGBRegressor()
            instance.model_upper.load_model(str(upper_path))

        # Restore saved preprocessing information
        metadata = joblib.load(directory / "metadata.joblib")
        instance.category_mappings = metadata["category_mappings"]
        instance.feature_columns = metadata["feature_columns"]

        return instance

    # -----------------------------------------------------------------
    # MLflow integration
    # -----------------------------------------------------------------

    def save_mlflow(self, metrics: dict, params: dict | None = None) -> str:
        """
        Log model, metrics, and params to an MLflow run.

        Args:
            metrics: Dict of metric name → value (e.g. {"mae": 0.05}).
            params: Optional dict of param name → value.

        Returns:
            MLflow run_id.
        """
        if self.model is None:
            raise RuntimeError("No trained model to log.")

        mlflow.set_experiment("sharkpark-short-term")

        # Generic run name for now; dynamic as we experiment w/ params
        with mlflow.start_run(run_name="short-term-training") as run:
            if params:
                mlflow.log_params(params)
            mlflow.log_metrics(metrics)

            # Save model artifacts
            import tempfile

            # Save via temp dir + MLflow artifacts for backend-agnostic storage
            with tempfile.TemporaryDirectory() as tmp:
                model_dir = Path(tmp) / "model"
                self.save(str(model_dir))
                mlflow.log_artifacts(str(model_dir), artifact_path="model")

            return run.info.run_id

    @classmethod
    def load_mlflow(cls, run_id: str) -> "ShortTermModel":
        """
        Load a model from an MLflow run's artifacts.

        Args:
            run_id: MLflow run ID.

        Returns:
            ShortTermModel instance ready for prediction.
        """
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            local_dir = mlflow.artifacts.download_artifacts(
                run_id=run_id, artifact_path="model", dst_path=tmp
            )
            return cls.load(local_dir)

    # -----------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------

    def _fit_category_mappings(self, df: pd.DataFrame) -> None:
        """Build category → integer mappings from training data."""
        self.category_mappings = {}
        for col in CATEGORICAL_FEATURES:
            if col in df.columns:
                unique_vals = sorted(df[col].dropna().unique())
                self.category_mappings[col] = {
                    val: idx for idx, val in enumerate(unique_vals)
                }

    def _encode_categoricals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply category mappings, using -1 for unseen categories."""
        df = df.copy()
        for col in CATEGORICAL_FEATURES:
            if col in df.columns and col in self.category_mappings:
                mapping = self.category_mappings[col]
                encoded_col = f"{col}_encoded"
                df[encoded_col] = df[col].map(mapping).fillna(-1).astype(int)
        return df

    def _prepare_xy(
        self, df: pd.DataFrame, has_target: bool = True
    ) -> tuple[pd.DataFrame, np.ndarray | None]:
        """
        Encode categoricals and extract X (and y if present).

        Returns:
            (X DataFrame, y array or None)
        """
        df = self._encode_categoricals(df)

        encoded_cats = [
            f"{col}_encoded" for col in CATEGORICAL_FEATURES if col in df.columns
        ]
        self.feature_columns = NUMERIC_FEATURES + encoded_cats

        X = df[self.feature_columns].copy()
        # Convert booleans to int for XGBoost
        for col in X.columns:
            if X[col].dtype == "bool" or X[col].dtype == "object":
                X[col] = X[col].astype(int)

        y = None
        if has_target and TARGET_COL in df.columns:
            y = df[TARGET_COL].values

        return X, y
