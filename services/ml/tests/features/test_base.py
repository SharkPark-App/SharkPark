"""
Tests for shared feature engineering utilities (src.features.base).

Covers:
    - Cyclical encoding (encode_cyclical, add_hour_encoding, add_day_encoding)
    - Time extraction
    - Data validation
    - Full base feature pipeline

Run from services/ml/:
    python -m pytest tests/features/test_base.py -v
"""

import pandas as pd
import pytest

from src.features.base import (
    encode_cyclical,
    add_hour_encoding,
    add_day_encoding,
    extract_time_components,
    validate_snapshot_data,
    prepare_base_features,
)


# =============================================================================
# Cyclical Encoding
# =============================================================================


class TestEncodeCyclical:
    """Verify sin/cos cyclical encoding."""

    def test_midnight_hour(self):
        """Hour 0 should produce sin=0, cos=1."""
        sin_val, cos_val = encode_cyclical(0, 24)
        assert abs(sin_val) < 1e-10
        assert abs(cos_val - 1.0) < 1e-10

    def test_six_am(self):
        """Hour 6 (quarter cycle) should produce sin=1, cos~0."""
        sin_val, cos_val = encode_cyclical(6, 24)
        assert abs(sin_val - 1.0) < 1e-10
        assert abs(cos_val) < 1e-10

    def test_noon(self):
        """Hour 12 (half cycle) should produce sin~0, cos=-1."""
        sin_val, cos_val = encode_cyclical(12, 24)
        assert abs(sin_val) < 1e-10
        assert abs(cos_val + 1.0) < 1e-10


class TestAddHourEncoding:
    """Verify DataFrame-level hour encoding."""

    def test_adds_sin_cos_columns(self):
        df = pd.DataFrame({"hour": [0, 6, 12, 18]})
        result = add_hour_encoding(df)
        assert "sin_hour" in result.columns
        assert "cos_hour" in result.columns
        assert len(result) == 4

    def test_does_not_modify_original(self):
        df = pd.DataFrame({"hour": [0, 6]})
        add_hour_encoding(df)
        assert "sin_hour" not in df.columns


class TestAddDayEncoding:
    """Verify DataFrame-level day-of-week encoding."""

    def test_adds_sin_cos_columns(self):
        df = pd.DataFrame({"day_of_week": [0, 1, 2, 3, 4, 5, 6]})
        result = add_day_encoding(df)
        assert "sin_day" in result.columns
        assert "cos_day" in result.columns


# =============================================================================
# Time Extraction
# =============================================================================


class TestExtractTimeComponents:
    """Verify time component extraction from timestamps."""

    def test_extracts_hour_and_day(self):
        df = pd.DataFrame(
            {
                "timestamp": pd.to_datetime(
                    ["2025-10-15T14:30:00", "2025-10-16T09:00:00"]
                ),
            }
        )
        result = extract_time_components(df)
        assert list(result["hour"]) == [14, 9]
        assert list(result["day_of_week"]) == [2, 3]  # Wed, Thu
        assert list(result["date"]) == ["2025-10-15", "2025-10-16"]
        assert list(result["is_weekend"]) == [False, False]

    def test_string_timestamps_converted(self):
        """String timestamps (object dtype) should be parsed."""
        df = pd.DataFrame(
            {
                "timestamp": ["2025-10-15T14:30:00", "2025-10-16T09:00:00"],
            }
        )
        result = extract_time_components(df)
        assert list(result["hour"]) == [14, 9]

    def test_weekend_detection(self):
        """Saturday/Sunday should be flagged as weekend."""
        df = pd.DataFrame(
            {
                "timestamp": pd.to_datetime(
                    [
                        "2025-10-13",  # Monday
                        "2025-10-18",  # Saturday
                        "2025-10-19",  # Sunday
                    ]
                ),
            }
        )
        result = extract_time_components(df)
        assert list(result["is_weekend"]) == [False, True, True]


# =============================================================================
# Validation
# =============================================================================


class TestValidateSnapshotData:
    """Verify data validation and cleaning."""

    def test_valid_data_passes(self, sample_snapshot_df):
        result = validate_snapshot_data(sample_snapshot_df)
        assert len(result) == 3

    def test_missing_required_column_raises(self):
        df = pd.DataFrame({"lot_id": ["G1"], "timestamp": ["2025-10-15"]})
        with pytest.raises(ValueError, match="Missing required columns"):
            validate_snapshot_data(df)

    def test_filters_low_confidence(self, sample_snapshot_df):
        sample_snapshot_df.loc[0, "confidence"] = "LOW"
        result = validate_snapshot_data(sample_snapshot_df)
        assert len(result) == 2

    def test_min_confidence_none_keeps_all(self, sample_snapshot_df):
        """Passing min_confidence=None should skip confidence filtering."""
        sample_snapshot_df.loc[0, "confidence"] = "LOW"
        result = validate_snapshot_data(sample_snapshot_df, min_confidence=None)
        assert len(result) == 3

    def test_min_confidence_custom_levels(self, sample_snapshot_df):
        """Custom confidence levels should be respected."""
        sample_snapshot_df["confidence"] = ["LOW", "MEDIUM", "HIGH"]
        result = validate_snapshot_data(
            sample_snapshot_df, min_confidence=["LOW", "MEDIUM"]
        )
        assert len(result) == 2

    def test_warns_when_majority_dropped(self, sample_snapshot_df, caplog):
        """Should warn when >50% of rows are dropped by confidence filter."""
        import logging

        # Make 2 of 3 rows LOW confidence (67% drop rate)
        sample_snapshot_df["confidence"] = ["LOW", "LOW", "HIGH"]

        with caplog.at_level(logging.WARNING, logger="src.features.base"):
            result = validate_snapshot_data(sample_snapshot_df)
        assert len(result) == 1
        assert "dropped 2 / 3" in caplog.text.lower()

    def test_no_warning_when_minority_dropped(self, sample_snapshot_df, caplog):
        """Should not warn when <=50% of rows are dropped."""
        import logging

        sample_snapshot_df["confidence"] = ["LOW", "HIGH", "HIGH"]
        with caplog.at_level(logging.WARNING, logger="src.features.base"):
            validate_snapshot_data(sample_snapshot_df)
        assert "dropped" not in caplog.text.lower()

    def test_clamps_occupancy_rate(self, sample_snapshot_df):
        sample_snapshot_df.loc[0, "occupancy_rate"] = 1.5
        sample_snapshot_df.loc[1, "occupancy_rate"] = -0.2
        result = validate_snapshot_data(sample_snapshot_df)
        assert result["occupancy_rate"].max() <= 1.0
        assert result["occupancy_rate"].min() >= 0.0

    def test_removes_negative_occupancy(self, sample_snapshot_df):
        sample_snapshot_df.loc[0, "occupancy"] = -1
        result = validate_snapshot_data(sample_snapshot_df)
        assert len(result) == 2


# =============================================================================
# Full Pipeline
# =============================================================================


class TestPrepareBaseFeatures:
    """Verify full base feature pipeline."""

    def test_pipeline_adds_all_expected_columns(self, sample_snapshot_df):
        result = prepare_base_features(sample_snapshot_df)

        expected_new_cols = [
            "hour",
            "day_of_week",
            "date",
            "is_weekend",
        ]
        for col in expected_new_cols:
            assert col in result.columns, f"Missing column: {col}"

    def test_pipeline_normalizes_timestamps(self, sample_snapshot_df):
        sample_snapshot_df = sample_snapshot_df.copy()
        sample_snapshot_df["timestamp"] = pd.to_datetime(
            sample_snapshot_df["timestamp"]
        ).dt.tz_localize("UTC")
        result = prepare_base_features(sample_snapshot_df)
        assert result["timestamp"].dt.tz is None
