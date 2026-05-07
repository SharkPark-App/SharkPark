"""Tests for the low-activity session prediction post-processor."""

from __future__ import annotations

from datetime import date

import numpy as np
import pytest

from src.postprocess.low_activity_scaling import (
    LOW_ACTIVITY_CEILING,
    REASON_NORMAL,
    apply_low_activity_scaling,
    ceiling_for,
)


class TestCeilingFor:
    def test_regular_fall_class_day_uncapped(self):
        # Fall 2025 classes start ~Aug 25 (4th Mon of August).
        ceiling, reason = ceiling_for(date(2025, 9, 15))
        assert ceiling == 1.0
        assert reason == REASON_NORMAL

    def test_winter_intersession_capped_at_10pct(self):
        # Jan 5 2026 is mid winter intersession at CSULB.
        ceiling, reason = ceiling_for(date(2026, 1, 5))
        assert ceiling == LOW_ACTIVITY_CEILING["winter_session"]
        assert "winter_session" in reason

    def test_summer_intersession_capped_at_30pct(self):
        ceiling, reason = ceiling_for(date(2026, 7, 1))
        assert ceiling == LOW_ACTIVITY_CEILING["summer_session"]
        assert "summer_session" in reason

    def test_break_capped_at_5pct(self):
        # Late December — outside any semester.
        ceiling, reason = ceiling_for(date(2025, 12, 28))
        assert ceiling == LOW_ACTIVITY_CEILING["break"]
        assert "break" in reason


class TestApplyLowActivityScaling:
    def test_caps_high_predictions_during_winter(self):
        median = np.array([0.85, 0.40])
        lower = np.array([0.70, 0.30])
        upper = np.array([0.95, 0.55])
        dates = [date(2026, 1, 5), date(2026, 1, 6)]

        m, lo, hi, reasons = apply_low_activity_scaling(median, lower, upper, dates)

        cap = LOW_ACTIVITY_CEILING["winter_session"]
        assert np.all(m <= cap)
        assert np.all(lo <= cap)
        assert np.all(hi <= cap)
        assert all("winter_session" in r for r in reasons)

    def test_leaves_regular_period_untouched(self):
        median = np.array([0.85])
        lower = np.array([0.70])
        upper = np.array([0.95])
        dates = [date(2025, 9, 15)]

        m, lo, hi, reasons = apply_low_activity_scaling(median, lower, upper, dates)

        np.testing.assert_array_equal(m, median)
        np.testing.assert_array_equal(lo, lower)
        np.testing.assert_array_equal(hi, upper)
        assert reasons == [REASON_NORMAL]

    def test_preserves_lower_le_median_le_upper_invariant(self):
        # Capping pulls upper down to the cap but the original median was
        # already higher; verify ordering is restored.
        median = np.array([0.85])
        lower = np.array([0.05])
        upper = np.array([0.95])
        dates = [date(2026, 1, 5)]

        m, lo, hi, _ = apply_low_activity_scaling(median, lower, upper, dates)

        assert lo[0] <= m[0] <= hi[0]

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError):
            apply_low_activity_scaling(
                np.array([0.5, 0.5]),
                np.array([0.4]),
                np.array([0.6, 0.6]),
                [date(2026, 1, 5), date(2026, 1, 6)],
            )

    def test_mixed_periods_apply_per_row_ceilings(self):
        median = np.array([0.9, 0.9, 0.9])
        lower = np.array([0.8, 0.8, 0.8])
        upper = np.array([1.0, 1.0, 1.0])
        dates = [
            date(2025, 9, 15),  # regular fall
            date(2026, 1, 5),   # winter
            date(2026, 7, 1),   # summer
        ]

        m, _, _, reasons = apply_low_activity_scaling(median, lower, upper, dates)

        assert m[0] == 0.9  # untouched
        assert m[1] == LOW_ACTIVITY_CEILING["winter_session"]
        assert m[2] == LOW_ACTIVITY_CEILING["summer_session"]
        assert reasons[0] == REASON_NORMAL
        assert "winter_session" in reasons[1]
        assert "summer_session" in reasons[2]
