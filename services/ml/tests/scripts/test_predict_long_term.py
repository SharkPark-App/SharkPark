"""
Tests for the long-term prediction script (scripts/predict_long_term.py).

Covers:
    - Prediction output matches expected schema columns
    - Predictions are rates in [0, 1]
    - Confidence bounds are ordered: lower <= median <= upper

Run from services/ml/:
    python -m pytest tests/scripts/test_predict_long_term.py -v
"""

import numpy as np
import pandas as pd

from scripts.predict_long_term import _build_prediction_df


EXPECTED_COLUMNS = [
    "lot_id",
    "predicted_at",
    "target_date",
    "target_hour",
    "predicted_occupancy",
    "confidence_lower",
    "confidence_upper",
    "model_version",
]


class TestBuildPredictionDf:
    """Verify the long-term prediction DataFrame builder."""

    def test_schema_matches(self):
        """Output should have all expected columns."""
        features = pd.DataFrame(
            {
                "lot_id": ["G1", "G1"],
                "target_date": ["2026-05-01", "2026-05-01"],
                "target_hour": [10, 11],
            }
        )
        median = np.array([0.5, 0.7])
        lower = np.array([0.4, 0.6])
        upper = np.array([0.6, 0.8])

        result = _build_prediction_df(
            features=features,
            median=median,
            lower=lower,
            upper=upper,
            model_version="test-v1",
        )

        for col in EXPECTED_COLUMNS:
            assert col in result.columns, f"Missing column: {col}"

    def test_predicted_occupancy_is_rate(self):
        """Predicted occupancy is a rate in [0, 1]."""
        features = pd.DataFrame(
            {
                "lot_id": ["G1"],
                "target_date": ["2026-05-01"],
                "target_hour": [10],
            }
        )
        median = np.array([0.55])
        lower = np.array([0.45])
        upper = np.array([0.65])

        result = _build_prediction_df(
            features=features,
            median=median,
            lower=lower,
            upper=upper,
            model_version="test-v1",
        )

        assert (result["predicted_occupancy"] >= 0).all()
        assert (result["predicted_occupancy"] <= 1).all()

    def test_confidence_bounds_ordered(self):
        """confidence_lower <= predicted_occupancy <= confidence_upper."""
        features = pd.DataFrame(
            {
                "lot_id": ["G1", "E1"],
                "target_date": ["2026-05-01", "2026-05-02"],
                "target_hour": [10, 14],
            }
        )
        median = np.array([0.5, 0.8])
        lower = np.array([0.4, 0.7])
        upper = np.array([0.6, 0.9])

        result = _build_prediction_df(
            features=features,
            median=median,
            lower=lower,
            upper=upper,
            model_version="test-v1",
        )

        assert (result["confidence_lower"] <= result["predicted_occupancy"]).all()
        assert (result["predicted_occupancy"] <= result["confidence_upper"]).all()
