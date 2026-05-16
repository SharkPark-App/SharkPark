"""
Backward-compatibility tests for `BaseXGBoostModel._prepare_xy`.

When `CATEGORICAL_FEATURES` is extended in code (e.g. a new column like
``weather_severity`` is added later), older models registered in MLflow
will not have that key in their ``category_mappings``. The encoder must
silently skip missing categoricals at inference time rather than raising
``KeyError`` — and prediction must still work on data that contains the
unmapped raw column.

Run from services/ml/:
    python -m pytest tests/models/test_backward_compat.py -v
"""

import numpy as np
import pandas as pd
import pytest

from src.models.short_term import ShortTermModel, prepare_training_features


@pytest.fixture(autouse=True)
def _use_isolated_mlflow(isolated_mlflow):
    """Isolate MLflow for any side-effects."""


def _retrain_after_dropping_mapping(
    model: ShortTermModel, train_df: pd.DataFrame, dropped_col: str
) -> pd.DataFrame:
    """Helper: drop ``dropped_col`` from category_mappings and re-fit the
    boosters on the trimmed feature set so XGBoost feature counts line up.

    Returns the prepared training features (caller may slice for inference).
    """
    train_features = prepare_training_features(train_df, min_confidence=None)
    del model.category_mappings[dropped_col]
    encoded_col = f"{dropped_col}_encoded"
    model.feature_columns = [c for c in model.feature_columns if c != encoded_col]
    X_full, y = model._prepare_xy(train_features)  # noqa: SLF001
    X_trimmed = X_full.drop(columns=[encoded_col], errors="ignore")
    model.model.fit(X_trimmed, y)
    if model.model_lower is not None:
        model.model_lower.fit(X_trimmed, y)
    if model.model_upper is not None:
        model.model_upper.fit(X_trimmed, y)
    return train_features


class TestBackwardCompatCategoricals:
    """Older models lacking newly-added categoricals must still predict."""

    def test_encode_categoricals_skips_missing_mapping(self, synthetic_df):
        """`_encode_categoricals` produces NO encoded column for entries in
        CATEGORICAL_FEATURES that are absent from `category_mappings`."""
        model = ShortTermModel()
        model.train(synthetic_df)

        dropped = next(
            c
            for c in ShortTermModel.CATEGORICAL_FEATURES
            if c in model.category_mappings
        )
        del model.category_mappings[dropped]

        encoded = model._encode_categoricals(synthetic_df.head(20))  # noqa: SLF001
        assert f"{dropped}_encoded" not in encoded.columns

    def test_prepare_xy_excludes_encoded_col_when_mapping_missing(self, synthetic_df):
        """`_prepare_xy` must not list `<col>_encoded` in feature_columns
        when the underlying mapping was never trained — otherwise inference
        on an older registered model raises KeyError on the column select.

        This guards the regression fixed in services/ml/src/models/base.py:
        the comprehension uses ``if f"{col}_encoded" in df.columns`` rather
        than ``if col in df.columns``.
        """
        model = ShortTermModel()
        model.train(synthetic_df)

        dropped = next(
            c
            for c in ShortTermModel.CATEGORICAL_FEATURES
            if c in model.category_mappings
        )
        _retrain_after_dropping_mapping(model, synthetic_df, dropped)

        test_features = prepare_training_features(
            synthetic_df.tail(50), min_confidence=None
        )
        if test_features.empty:
            pytest.skip("Not enough rows for inference slice")

        # Raw column STILL exists in test data (simulating new pipeline code
        # writing it), but model has no mapping for it.
        assert dropped in test_features.columns
        X, _ = model._prepare_xy(test_features, has_target=False)  # noqa: SLF001
        assert f"{dropped}_encoded" not in X.columns
        assert dropped not in X.columns  # raw col never goes to X either

    def test_predict_succeeds_when_category_mapping_missing(self, synthetic_df):
        """End-to-end: predict() returns a valid array when an older model's
        category_mappings is missing a key still listed in CATEGORICAL_FEATURES."""
        model = ShortTermModel()
        model.train(synthetic_df)

        dropped = next(
            c
            for c in ShortTermModel.CATEGORICAL_FEATURES
            if c in model.category_mappings
        )
        _retrain_after_dropping_mapping(model, synthetic_df, dropped)

        test_features = prepare_training_features(
            synthetic_df.tail(50), min_confidence=None
        )
        if test_features.empty:
            pytest.skip("Not enough rows for inference slice")

        preds = model.predict(test_features)
        assert isinstance(preds, np.ndarray)
        assert len(preds) == len(test_features)
        assert (preds >= 0.0).all() and (preds <= 1.0).all()

    def test_brand_new_categorical_in_code_but_not_in_data(self, synthetic_df):
        """If CATEGORICAL_FEATURES contains a key (e.g. `weather_severity`)
        that the SYNTHETIC fixture data never produced, training silently
        skips it and prediction still works.

        This is the actual production scenario for E2 weather features:
        code declared the categorical before the data pipeline supplies it.
        """
        assert "weather_severity" in ShortTermModel.CATEGORICAL_FEATURES
        assert "weather_severity" not in synthetic_df.columns

        model = ShortTermModel()
        model.train(synthetic_df)

        # Mapping was never created for weather_severity; encoded col absent.
        assert "weather_severity" not in model.category_mappings
        assert "weather_severity_encoded" not in model.feature_columns

        test_features = prepare_training_features(
            synthetic_df.tail(50), min_confidence=None
        )
        if test_features.empty:
            pytest.skip("Not enough rows for inference slice")
        preds = model.predict(test_features)
        assert len(preds) == len(test_features)
