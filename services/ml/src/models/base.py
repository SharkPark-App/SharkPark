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

from src.utils.mlflow_setup import ensure_experiment

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

        ensure_experiment(self.MLFLOW_EXPERIMENT)

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

    @classmethod
    def load_mlflow_artifact_uri(cls, artifact_uri: str) -> "BaseXGBoostModel":
        """Load a model from a concrete MLflow artifact URI.

        This is a resilient fallback when ``run_id`` lookup works but the
        run-level ``artifact_path='model'`` download no longer resolves in a
        given environment. Typical source URIs come from Model Registry
        versions (e.g. ``version_info.source``).
        """
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            local_dir = mlflow.artifacts.download_artifacts(
                artifact_uri=artifact_uri,
                dst_path=tmp,
            )
            local_path = Path(local_dir)

            # Most sources point directly at the model directory, but some
            # stores may resolve to a parent folder containing `model/`.
            if (local_path / "model.json").exists():
                return cls.load(str(local_path))
            nested_model_dir = local_path / "model"
            if (nested_model_dir / "model.json").exists():
                return cls.load(str(nested_model_dir))

            raise FileNotFoundError(
                f"Could not find model artifacts at URI: {artifact_uri}"
            )

    # -----------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------

    @staticmethod
    def _build_sample_weights(
        train_features: pd.DataFrame,
        synthetic_weight: float,
        cold_start_weight: float,
        *,
        real_weight: float = 1.0,
        synthetic_v2_weight: float = 1.0,
        per_lot_decay: bool = True,
    ) -> np.ndarray:
        """Build volume-normalized per-row XGBoost sample weights.

        Four mutually-exclusive tiers (post-D5):

        * **real_clean** — real rows from established lots (``_source=='real'``,
          ``is_cold_start==False``); reference tier with weight ``real_weight``.
        * **real_cold**  — real rows from cold-start lots; weight
          ``cold_start_weight``.
        * **synthetic_v2** — catalog-driven synthetic rows
          (``_source=='synthetic'`` AND ``generator_version=='v2'``); weight
          ``synthetic_v2_weight`` × per-row ``sample_weight`` from the
          ``synthetic_observations`` table (mean-normalized within tier so the
          tier total equals ``synthetic_v2_weight * ref_size``).
        * **synthetic_v1** — legacy parquet synthetic rows
          (``_source=='synthetic'`` AND no v2 generator_version); weight
          ``synthetic_weight``.

        Each tier is volume-normalized so its total influence is
        ``weight * ref_size`` regardless of row count, where ``ref_size`` is
        the highest-priority non-empty tier (real_clean > real_cold >
        synthetic_v2 > synthetic_v1). This decouples the relative weight
        knobs from the absolute row counts of each tier.

        Per-lot decay (D5 spec): when both real and synthetic rows are
        present and ``per_lot_decay=True``, every synthetic row is further
        scaled by ``1 / (1 + n_real_obs_for_lot / 100)``. Lots with rich
        real coverage (>>100 obs) effectively erase synthetic influence;
        lots with no real data keep synthetic weight at 1×. This causes the
        model to organically prefer real signal where it exists.

        Args:
            train_features: Training DataFrame. Should expose ``_source`` and
                ``is_cold_start`` for tier classification, ``generator_version``
                to split synthetic v1/v2, ``sample_weight`` for per-row v2
                scaling, and ``lot_id`` for per-lot decay. Missing columns
                degrade gracefully (uniform weights, no decay, etc.).
            synthetic_weight: Tier weight for synthetic v1 (legacy parquet).
            cold_start_weight: Tier weight for real cold-start rows.
            real_weight: Tier weight for real established rows (the
                reference tier). Default 1.0 keeps backward compatibility
                with the pre-D5 calling convention.
            synthetic_v2_weight: Tier weight for synthetic v2 (DB) rows.
            per_lot_decay: Apply ``1/(1+n_real/100)`` per-lot decay to all
                synthetic rows. Disable only for tests / weight diagnostics.

        Returns:
            ``np.ndarray`` of per-row weights (one float per row), passed
            directly to ``XGBRegressor.fit(sample_weight=…)``.
        """
        n = len(train_features)
        source = train_features.get("_source")
        if source is None:
            return np.ones(n)

        is_synthetic = source == "synthetic"

        is_cold = train_features.get("is_cold_start")
        if is_cold is None:
            is_cold = pd.Series(False, index=train_features.index)
        else:
            is_cold = is_cold.fillna(False).astype(bool)

        gen_ver = train_features.get("generator_version")
        if gen_ver is None:
            gen_ver_series = pd.Series("", index=train_features.index)
        else:
            gen_ver_series = gen_ver.fillna("").astype(str)

        is_v2 = is_synthetic & (gen_ver_series == "v2")
        is_v1 = is_synthetic & ~is_v2
        is_real_cold = ~is_synthetic & is_cold
        is_real_clean = ~is_synthetic & ~is_cold

        n_real_clean = int(is_real_clean.sum())
        n_real_cold = int(is_real_cold.sum())
        n_v2 = int(is_v2.sum())
        n_v1 = int(is_v1.sum())

        if n_real_clean > 0:
            ref_size = n_real_clean
        elif n_real_cold > 0:
            ref_size = n_real_cold
        elif n_v2 > 0:
            ref_size = n_v2
        elif n_v1 > 0:
            ref_size = n_v1
        else:
            return np.ones(n)

        weights = np.ones(n)
        if n_real_clean > 0:
            weights[is_real_clean.values] = real_weight * ref_size / n_real_clean
        if n_real_cold > 0:
            weights[is_real_cold.values] = cold_start_weight * ref_size / n_real_cold
        if n_v1 > 0:
            weights[is_v1.values] = synthetic_weight * ref_size / n_v1
        if n_v2 > 0:
            base_v2 = synthetic_v2_weight * ref_size / n_v2
            per_row = train_features.get("sample_weight")
            if per_row is None:
                per_row_v2 = np.ones(n_v2, dtype=np.float64)
            else:
                per_row_v2 = (
                    per_row.fillna(1.0).astype(float).values[is_v2.values]
                )
                mean_pr = float(per_row_v2.mean()) if per_row_v2.size > 0 else 1.0
                # Guard against degenerate weights (all zero) — fall back to
                # uniform per-row scaling rather than emitting NaN/0 weights.
                if mean_pr > 0:
                    per_row_v2 = per_row_v2 / mean_pr
                else:
                    per_row_v2 = np.ones(n_v2, dtype=np.float64)
            weights[is_v2.values] = base_v2 * per_row_v2

        # Per-lot decay (D5 spec): synthetic rows shrink by
        # 1/(1 + n_real_obs_for_lot / 100). Applied AFTER tier normalization
        # so the decay is multiplicative on the per-row weight.
        synthetic_mask_arr = (is_v1 | is_v2).values
        has_real = (n_real_clean + n_real_cold) > 0
        has_synth = (n_v1 + n_v2) > 0
        lot_col = train_features.get("lot_id")
        if (
            per_lot_decay
            and has_real
            and has_synth
            and lot_col is not None
        ):
            real_mask = is_real_clean | is_real_cold
            real_counts_per_lot = lot_col[real_mask].value_counts()
            decay = 1.0 / (
                1.0
                + lot_col.map(real_counts_per_lot).fillna(0.0).astype(float) / 100.0
            )
            weights[synthetic_mask_arr] = (
                weights[synthetic_mask_arr] * decay.values[synthetic_mask_arr]
            )

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

        # Only list encoded cats whose encoded column was actually produced.
        # `_encode_categoricals` skips columns missing from `category_mappings`
        # (e.g. a model trained before a new categorical was added), and we
        # must not require those columns at inference time — otherwise an
        # older registered model breaks the moment a new categorical is
        # appended to `CATEGORICAL_FEATURES` in code.
        encoded_cats = [
            f"{col}_encoded"
            for col in self.CATEGORICAL_FEATURES
            if f"{col}_encoded" in df.columns
        ]
        self.feature_columns = list(self.NUMERIC_FEATURES) + encoded_cats

        # Allow optional numeric features (e.g. weather columns added in E2)
        # to be missing for legacy training fixtures or synthetic-only data;
        # fill with NaN so XGBoost's native missing-value handling kicks in.
        df = df.copy()
        for col in self.NUMERIC_FEATURES:
            if col not in df.columns:
                df[col] = np.nan

        X = df[self.feature_columns].copy()
        for col in X.columns:
            if pd.api.types.is_bool_dtype(X[col]):
                # Keep NaN as NaN (XGBoost handles missing values natively)
                X[col] = X[col].astype(float)
            elif not pd.api.types.is_numeric_dtype(X[col]):
                X[col] = pd.to_numeric(X[col], errors="coerce")

        y = None
        if has_target and self.TARGET_COL in df.columns:
            y = df[self.TARGET_COL].values

        return X, y
