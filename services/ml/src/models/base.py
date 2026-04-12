"""
Shared base class for SharkPark XGBoost prediction models.

Contains persistence (save/load, MLflow), sample weighting, and
categorical encoding logic common to both short-term and long-term models.
Subclasses override class attributes (feature lists, target column, MLflow
experiment name) and implement their own train() / predict*() methods.
"""

from pathlib import Path

import joblib
import mlflow
import numpy as np
import pandas as pd
import xgboost as xgb

__all__ = ["BaseXGBoostModel"]


class BaseXGBoostModel:
    """
    Base class for SharkPark XGBoost models.

    Subclasses must set these class attributes:
        NUMERIC_FEATURES: list[str]
        CATEGORICAL_FEATURES: list[str]
        TARGET_COL: str
        MLFLOW_EXPERIMENT: str
        MLFLOW_RUN_NAME: str
    """

    # -- Subclass overrides ------------------------------------------------
    NUMERIC_FEATURES: list[str] = []
    CATEGORICAL_FEATURES: list[str] = []
    TARGET_COL: str = ""
    MLFLOW_EXPERIMENT: str = ""
    MLFLOW_RUN_NAME: str = ""

    # -- Default XGBoost hyperparameters -----------------------------------
    DEFAULT_HYPERPARAMS = {
        "n_estimators": 200,
        "max_depth": 6,
        "learning_rate": 0.1,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "random_state": 42,
    }

    def __init__(self):
        self.model: xgb.XGBRegressor | None = None
        self.model_lower: xgb.XGBRegressor | None = None
        self.model_upper: xgb.XGBRegressor | None = None
        self.category_mappings: dict[str, dict[str, int]] = {}
        self.feature_columns: list[str] = []
        self.hyperparams: dict = {}

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
    def load(cls, path: str) -> "BaseXGBoostModel":
        """
        Load a saved model from disk.

        Args:
            path: Directory containing model.json, model_lower.json,
                  model_upper.json, and metadata.joblib.

        Returns:
            Model instance ready for prediction.
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

    def save_mlflow(
        self,
        metrics: dict,
        params: dict | None = None,
        data_path: str | None = None,
    ) -> str:
        """
        Log model, metrics, and params to an MLflow run.

        Args:
            metrics: Dict of metric name -> value (e.g. {"mae": 0.05}).
            params: Optional dict of param name -> value.
            data_path: Optional path to training data file to log as artifact.

        Returns:
            MLflow run_id.
        """
        if self.model is None:
            raise RuntimeError("No trained model to log.")

        mlflow.set_experiment(self.MLFLOW_EXPERIMENT)

        with mlflow.start_run(run_name=self.MLFLOW_RUN_NAME) as run:
            if params:
                mlflow.log_params(params)
            mlflow.log_metrics(metrics)

            import tempfile

            with tempfile.TemporaryDirectory() as tmp:
                model_dir = Path(tmp) / "model"
                self.save(str(model_dir))
                mlflow.log_artifacts(str(model_dir), artifact_path="model")

            # TODO: When training data outgrows MLflow artifact storage,
            # switch to content-addressed S3 (key by data hash) and log
            # only the hash as a param for deduplication across runs.
            if data_path:
                data_file = Path(data_path)
                if data_file.exists():
                    mlflow.log_artifact(str(data_file), artifact_path="data")

            return run.info.run_id

    @classmethod
    def load_mlflow(cls, run_id: str) -> "BaseXGBoostModel":
        """
        Load a model from an MLflow run's artifacts.

        Args:
            run_id: MLflow run ID.

        Returns:
            Model instance ready for prediction.
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

    @staticmethod
    def _build_sample_weights(
        train_features: pd.DataFrame,
        synthetic_weight: float,
        cold_start_weight: float,
    ) -> np.ndarray:
        """Build volume-normalized sample weights from source/cold-start metadata.

        Groups rows into 3 mutually exclusive tiers — synthetic, real cold-start,
        and real established — then normalizes per-row weights so each group's
        total influence is proportional to its weight parameter, regardless of
        row count.

        Args:
            train_features: Training DataFrame. May contain ``_source`` and
                ``is_cold_start`` columns for group classification. If either
                is missing, rows default to the unweighted group.
            synthetic_weight: Desired influence ratio of synthetic data relative
                to real data (e.g. 0.3 = 30% of real data's influence).
            cold_start_weight: Desired influence ratio of real cold-start data
                relative to real established data.

        Returns:
            NumPy array of per-row weights (one float per row in
            train_features), passed to XGBoost's ``sample_weight``.
        """
        # Classify each feature row into a group
        source = train_features.get("_source")
        if source is None:  # return uniform weight
            return np.ones(len(train_features))

        is_synthetic = source == "synthetic"
        is_cold = train_features.get("is_cold_start")

        if is_cold is None:
            is_cold = pd.Series(False, index=train_features.index)
        else:
            is_cold = is_cold.fillna(False).astype(bool)

        # Synthetic data marked as cold; mutually exclusive groups
        is_real_cold = ~is_synthetic & is_cold  # real data from cold-start lots
        is_real_clean = ~is_synthetic & ~is_cold  # real data from established lots

        n_synthetic = is_synthetic.sum()
        n_real_cold = is_real_cold.sum()
        n_real_clean = is_real_clean.sum()

        # Pick reference group (highest-priority non-empty group)
        if n_real_clean > 0:
            ref_size = n_real_clean
        elif n_real_cold > 0:
            ref_size = n_real_cold
        else:
            # All synthetic — no weighting needed
            return np.ones(len(train_features))

        # Compute per-row weight so total_influence = weight * ref_size
        weights = np.ones(len(train_features))
        if n_synthetic > 0:
            weights[is_synthetic.values] = synthetic_weight * ref_size / n_synthetic
        if n_real_cold > 0:
            weights[is_real_cold.values] = cold_start_weight * ref_size / n_real_cold
        if n_real_clean > 0:
            weights[is_real_clean.values] = 1.0 * ref_size / n_real_clean

        return weights

    def _fit_category_mappings(self, df: pd.DataFrame) -> None:
        """Build category -> integer mappings from training data."""
        self.category_mappings = {}
        for col in self.CATEGORICAL_FEATURES:
            if col in df.columns:
                unique_vals = sorted(df[col].dropna().unique())
                self.category_mappings[col] = {
                    val: idx for idx, val in enumerate(unique_vals)
                }

    def _encode_categoricals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply category mappings, using -1 for unseen categories."""
        df = df.copy()
        for col in self.CATEGORICAL_FEATURES:
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
            f"{col}_encoded" for col in self.CATEGORICAL_FEATURES if col in df.columns
        ]
        self.feature_columns = list(self.NUMERIC_FEATURES) + encoded_cats

        X = df[self.feature_columns].copy()
        for col in X.columns:
            if X[col].dtype == "bool" or X[col].dtype == "object":
                X[col] = X[col].astype(int)

        y = None
        if has_target and self.TARGET_COL in df.columns:
            y = df[self.TARGET_COL].values

        return X, y
