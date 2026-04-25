"""
Tests for long-term feature engineering (src.features.long_term).

Covers:
    - compute_baseline confidence filtering (default and opt-out)
    - compute_baseline coverage fallback
    - prepare_training_features output columns and behavior

Run from services/ml/:
    python -m pytest tests/features/test_long_term.py -v
"""

import pandas as pd
import pytest

from src.config import PREDICTION_HOURS
from src.features.long_term import compute_baseline, prepare_training_features


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mixed_confidence_df():
    """Snapshot DataFrame with mixed HIGH/LOW confidence rows."""
    rows = []
    for week in range(4):
        ts = pd.Timestamp("2025-10-01 10:00:00") + pd.Timedelta(weeks=week)
        rows.append(
            {
                "lot_id": "G1",
                "timestamp": ts,
                "occupancy_rate": 0.50,
                "confidence": "HIGH",
                "academic_period": "regular",
            }
        )
        rows.append(
            {
                "lot_id": "G1",
                "timestamp": ts + pd.Timedelta(hours=1),
                "occupancy_rate": 0.10,
                "confidence": "LOW",
                "academic_period": "regular",
            }
        )
    return pd.DataFrame(rows)


@pytest.fixture
def sparse_df():
    """
    Snapshot DataFrame where one group has 1 unique date (< 2 coverage days)
    and another has 3 unique dates. The sparse group should fall back to the
    global (day_of_week, hour) mean.
    """
    rows = []
    base = pd.Timestamp("2026-03-02 10:00:00")

    # Dense group: G1 — 3 unique dates
    for week in range(3):
        rows.append(
            {
                "lot_id": "G1",
                "timestamp": base + pd.Timedelta(weeks=week),
                "occupancy_rate": 0.60,
                "confidence": "HIGH",
                "academic_period": "regular",
            }
        )

    # Sparse group: G2 — 1 unique date
    rows.append(
        {
            "lot_id": "G2",
            "timestamp": base,
            "occupancy_rate": 0.20,
            "confidence": "HIGH",
            "academic_period": "regular",
        }
    )

    return pd.DataFrame(rows)


@pytest.fixture
def training_df():
    """
    Minimal snapshot DataFrame covering 4 weeks so that compute_baseline
    produces usable entries. Two lots, regular period, fall semester.
    """
    rows = []
    base = pd.Timestamp("2025-10-06 10:00:00")
    for week in range(4):
        for lot_id in ("G1", "G2"):
            rows.append(
                {
                    "lot_id": lot_id,
                    "timestamp": base + pd.Timedelta(weeks=week),
                    "occupancy": 90,
                    "occupancy_rate": 0.50,
                    "confidence": "HIGH",
                    "academic_period": "regular",
                    "semester": "fall",
                    "week_of_semester": 5 + week,
                    "is_campus_open": True,
                }
            )
    return pd.DataFrame(rows)


# =============================================================================
# compute_baseline confidence filtering
# =============================================================================


class TestComputeBaselineConfidence:
    """Verify that compute_baseline respects min_confidence."""

    def test_default_filters_low_confidence(self, mixed_confidence_df):
        """Default min_confidence=('HIGH','MEDIUM') should drop LOW rows."""
        baseline = compute_baseline(mixed_confidence_df)
        row = baseline.query("lot_id == 'G1' and day_of_week == 2 and hour == 10")

        assert len(row) == 1
        assert row["baseline_occupancy_rate"].iloc[0] == pytest.approx(0.50)

    def test_none_keeps_low_confidence(self, mixed_confidence_df):
        """min_confidence=None should include LOW rows in the mean."""
        baseline = compute_baseline(mixed_confidence_df, min_confidence=None)

        row = baseline.query("lot_id == 'G1' and day_of_week == 2 and hour == 10")
        assert len(row) == 1
        assert row["baseline_occupancy_rate"].iloc[0] == pytest.approx(0.50)

        row_11 = baseline.query("lot_id == 'G1' and day_of_week == 2 and hour == 11")
        assert len(row_11) == 1
        assert row_11["baseline_occupancy_rate"].iloc[0] == pytest.approx(0.10)

    def test_default_drops_low_only_groups(self, mixed_confidence_df):
        """Groups containing only LOW rows should be absent under default filter."""
        baseline = compute_baseline(mixed_confidence_df)

        # LOW-only: so it should not exist after filtering
        row_11 = baseline.query("lot_id == 'G1' and day_of_week == 2 and hour == 11")
        assert len(row_11) == 0

    def test_custom_confidence_levels(self, mixed_confidence_df):
        """Explicit min_confidence list should be respected."""
        baseline = compute_baseline(mixed_confidence_df, min_confidence=("LOW",))

        row_10 = baseline.query("lot_id == 'G1' and day_of_week == 2 and hour == 10")
        assert len(row_10) == 0

        row_11 = baseline.query("lot_id == 'G1' and day_of_week == 2 and hour == 11")
        assert len(row_11) == 1
        assert row_11["baseline_occupancy_rate"].iloc[0] == pytest.approx(0.10)


# =============================================================================
# compute_baseline — coverage fallback
# =============================================================================


class TestComputeBaselineFallback:
    """Verify that groups with < 2 coverage days fall back to the global mean."""

    def test_sparse_group_gets_global_fallback(self, sparse_df):
        """G2 (1 unique date) should use the global (dow, hour) mean, not 0.20."""
        baseline = compute_baseline(sparse_df)

        g1 = baseline.query("lot_id == 'G1' and hour == 10")
        g2 = baseline.query("lot_id == 'G2' and hour == 10")

        assert len(g1) == 1
        assert len(g2) == 1

        # G1 should have its own mean (0.60)
        assert g1["baseline_occupancy_rate"].iloc[0] == pytest.approx(0.60)
        # G2 falls back to global (dow, hour) mean across all lots
        global_mean = sparse_df["occupancy_rate"].mean()

        assert g2["baseline_occupancy_rate"].iloc[0] == pytest.approx(
            global_mean, abs=0.01
        )

    def test_sparse_group_coverage_days_is_one(self, sparse_df):
        """Sparse group should report coverage_days=1."""
        baseline = compute_baseline(sparse_df)
        g2 = baseline.query("lot_id == 'G2' and hour == 10")
        assert g2["coverage_days"].iloc[0] == 1


# =============================================================================
# prepare_training_features
# =============================================================================


class TestPrepareTrainingFeatures:
    """Verify that prepare_training_features produces the correct feature set."""

    def test_output_columns(self, training_df):
        """Output should contain all required Stage 2 feature columns."""
        baseline = compute_baseline(training_df)
        features = prepare_training_features(training_df, baseline, min_confidence=None)

        required = [
            "lot_id",
            "historical_baseline",
            "days_ahead",
            "day_of_week",
            "hour",
            "week_of_semester",
            "is_campus_open",
            "semester",
            "academic_period",
            "sin_hour",
            "cos_hour",
            "sin_day",
            "cos_day",
            "deviation",
        ]
        for col in required:
            assert col in features.columns, f"Missing column: {col}"

    def test_days_ahead_in_range(self, training_df):
        """days_ahead should be in [1, 7] for every row."""
        baseline = compute_baseline(training_df)
        features = prepare_training_features(training_df, baseline, min_confidence=None)

        assert (features["days_ahead"] >= 1).all()
        assert (features["days_ahead"] <= 7).all()

    def test_only_prediction_hours(self, training_df):
        """Output should only contain rows for PREDICTION_HOURS."""
        baseline = compute_baseline(training_df)
        features = prepare_training_features(training_df, baseline, min_confidence=None)

        assert set(features["hour"].unique()).issubset(set(PREDICTION_HOURS))

    def test_deviation_equals_rate_minus_baseline(self, training_df):
        """deviation should equal occupancy_rate - historical_baseline for every row."""
        baseline = compute_baseline(training_df)
        features = prepare_training_features(training_df, baseline, min_confidence=None)

        original_rates = training_df.loc[features.index, "occupancy_rate"]
        expected = original_rates - features["historical_baseline"]
        assert (features["deviation"] == expected).all()

    def test_low_confidence_excluded_by_default(self, training_df):
        """LOW-confidence rows should be excluded from features by default."""
        df = training_df.copy()
        df["confidence"] = "LOW"
        baseline = compute_baseline(training_df)
        features = prepare_training_features(df, baseline)
        assert features.empty

    def test_source_and_cold_start_carried_through(self, training_df):
        """_source and is_cold_start columns should be preserved when present."""
        df = training_df.copy()
        df["_source"] = "synthetic"
        df["is_cold_start"] = True
        baseline = compute_baseline(training_df)
        features = prepare_training_features(df, baseline, min_confidence=None)

        assert "_source" in features.columns
        assert "is_cold_start" in features.columns
