"""Regression tests for BaseXGBoostModel preprocessing helpers."""

import numpy as np
import pandas as pd

from src.models.base import BaseXGBoostModel


class _DummyModel(BaseXGBoostModel):
    NUMERIC_FEATURES = ["is_raining", "value"]
    CATEGORICAL_FEATURES = ["lot_id"]
    TARGET_COL = "target"


def test_prepare_xy_handles_bool_like_nulls_without_crashing():
    """Mixed bool/object + NaN values should coerce to numeric safely."""
    model = _DummyModel()

    df = pd.DataFrame(
        {
            "is_raining": [True, False, np.nan],
            "value": [1.0, 2.0, 3.0],
            "lot_id": ["A", "B", "A"],
            "target": [0.1, 0.2, 0.3],
        }
    )

    model._fit_category_mappings(df)
    X, y = model._prepare_xy(df)

    assert len(y) == 3
    assert pd.api.types.is_numeric_dtype(X["is_raining"])
    assert X["is_raining"].isna().sum() == 1
    assert pd.api.types.is_numeric_dtype(X["lot_id_encoded"])
