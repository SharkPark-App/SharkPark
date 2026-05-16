"""Tests for the cold-start floor post-processor."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pytest

from src.config import OPERATING_END_HOUR, OPERATING_START_HOUR
from src.postprocess.cold_start_floor import (
    LOW_ACTIVITY_FLOOR_RATE,
    MIN_FLOOR_RATE,
    REASON_FLOOR,
    REASON_NORMAL,
    apply_cold_start_floor,
    is_cold_start_window,
)


# Fall 2025 mid-semester weekday — outside any low-activity period.
NORMAL_DATE = date(2025, 9, 15)
# Mid winter intersession.
WINTER_DATE = date(2026, 1, 5)


class TestIsColdStartWindow:
    def test_empty_dataframe_treated_as_cold_start(self):
        assert is_cold_start_window(pd.DataFrame()) is True

    def test_missing_column_treated_as_cold_start(self):
        df = pd.DataFrame({"lot_id": ["A"], "occupancy": [0]})
        assert is_cold_start_window(df) is True

    def test_all_cold_returns_true(self):
        df = pd.DataFrame({"is_cold_start": [True, True, True]})
        assert is_cold_start_window(df) is True

    def test_any_real_row_flips_to_false(self):
        df = pd.DataFrame({"is_cold_start": [True, False, True]})
        assert is_cold_start_window(df) is False

    def test_nan_treated_as_cold(self):
        df = pd.DataFrame({"is_cold_start": [True, None, True]})
        assert is_cold_start_window(df) is True


class TestApplyColdStartFloor:
    def test_noop_when_not_cold_start(self):
        median = np.array([0.01, 0.02])
        lower = np.array([0.0, 0.0])
        upper = np.array([0.05, 0.05])
        out_med, out_lo, out_hi, reasons = apply_cold_start_floor(
            median,
            lower,
            upper,
            target_dates=[NORMAL_DATE, NORMAL_DATE],
            target_hours=[10, 11],
            is_cold_start=False,
        )
        np.testing.assert_array_equal(out_med, median)
        np.testing.assert_array_equal(out_lo, lower)
        np.testing.assert_array_equal(out_hi, upper)
        assert reasons == [REASON_NORMAL, REASON_NORMAL]

    def test_floors_low_predictions_during_operating_hours(self):
        median = np.array([0.01, 0.05])
        lower = np.array([0.0, 0.0])
        upper = np.array([0.02, 0.10])
        out_med, out_lo, out_hi, reasons = apply_cold_start_floor(
            median,
            lower,
            upper,
            target_dates=[NORMAL_DATE, NORMAL_DATE],
            target_hours=[10, 14],
            is_cold_start=True,
        )
        assert out_med.tolist() == [MIN_FLOOR_RATE, MIN_FLOOR_RATE]
        # lower/upper raised to floor too, then clamped to maintain invariant
        assert (out_lo <= out_med).all()
        assert (out_hi >= out_med).all()
        assert reasons == [REASON_FLOOR, REASON_FLOOR]

    def test_does_not_lower_already_high_predictions(self):
        median = np.array([0.42])
        lower = np.array([0.30])
        upper = np.array([0.55])
        out_med, _, _, reasons = apply_cold_start_floor(
            median,
            lower,
            upper,
            target_dates=[NORMAL_DATE],
            target_hours=[12],
            is_cold_start=True,
        )
        assert out_med[0] == 0.42
        # Reason still records that the floor was *attempted* (op-hour, normal date).
        assert reasons == [REASON_FLOOR]

    def test_no_floor_outside_operating_hours(self):
        median = np.array([0.0])
        lower = np.array([0.0])
        upper = np.array([0.0])
        out_med, _, _, reasons = apply_cold_start_floor(
            median,
            lower,
            upper,
            target_dates=[NORMAL_DATE],
            target_hours=[OPERATING_START_HOUR - 1],
            is_cold_start=True,
        )
        assert out_med[0] == 0.0
        assert reasons == [REASON_NORMAL]

    def test_no_floor_after_operating_hours(self):
        median = np.array([0.0])
        out_med, _, _, _ = apply_cold_start_floor(
            median,
            np.array([0.0]),
            np.array([0.0]),
            target_dates=[NORMAL_DATE],
            target_hours=[OPERATING_END_HOUR + 1],
            is_cold_start=True,
        )
        assert out_med[0] == 0.0

    def test_low_activity_uses_lower_floor(self):
        median = np.array([0.0])
        out_med, _, _, reasons = apply_cold_start_floor(
            median,
            np.array([0.0]),
            np.array([0.0]),
            target_dates=[WINTER_DATE],
            target_hours=[10],
            is_cold_start=True,
        )
        assert out_med[0] == LOW_ACTIVITY_FLOOR_RATE
        assert reasons == [REASON_FLOOR]

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError):
            apply_cold_start_floor(
                np.array([0.0, 0.0]),
                np.array([0.0]),
                np.array([0.0, 0.0]),
                target_dates=[NORMAL_DATE, NORMAL_DATE],
                target_hours=[10, 11],
                is_cold_start=True,
            )
