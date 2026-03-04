"""
Tests for academic calendar config (src.academic_calendar).

Covers:
    - get_week_of_semester: week numbering, academic period (early/regular/midterms/late/dead_week/finals/break)
    - is_class_day: weekday/weekend, breaks, reading days, finals
    - get_semester_progress: boundaries, midpoint, outside semester
    - ACADEMIC_CALENDARS data structure integrity

Run from services/ml/:
    python -m pytest tests/features/test_academic_calendar.py -v
"""

from datetime import date
from datetime import datetime
import pytest


from src.academic_calendar import (
    ACADEMIC_CALENDARS,
    get_week_of_semester,
    is_class_day,
    get_semester_progress,
    get_semester,
    is_campus_open,
)


# =============================================================================
# DATA INTEGRITY
# =============================================================================


class TestCalendarDataIntegrity:
    """Verify the ACADEMIC_CALENDARS dict has valid structure."""

    def test_has_2025_2026(self):
        # _CalendarCache uses __missing__; access the key to populate it
        cal = ACADEMIC_CALENDARS["2025-2026"]
        assert cal is not None
        assert "2025-2026" in ACADEMIC_CALENDARS

    def test_semesters_present(self):
        cal = ACADEMIC_CALENDARS["2025-2026"]
        assert "fall" in cal
        assert "spring" in cal
        assert "winter" in cal
        assert "may_intersession" in cal
        assert "summer" in cal

    @pytest.mark.parametrize("sem", ["fall", "spring"])
    def test_required_keys(self, sem):
        data = ACADEMIC_CALENDARS["2025-2026"][sem]
        for key in (
            "classes_start",
            "classes_end",
            "finals_start",
            "finals_end",
            "breaks",
            "reading_days",
        ):
            assert key in data, f"Missing key: {key}"

    @pytest.mark.parametrize("sem", ["fall", "spring"])
    def test_dates_are_ordered(self, sem):
        data = ACADEMIC_CALENDARS["2025-2026"][sem]
        assert data["classes_start"] < data["classes_end"]
        assert data["classes_end"] < data["finals_start"]
        assert data["finals_start"] <= data["finals_end"]

    def test_breaks_have_required_keys(self):
        for year_data in ACADEMIC_CALENDARS.values():
            for sem in ("fall", "spring", "winter", "may_intersession", "summer"):
                for brk in year_data[sem]["breaks"]:
                    assert "name" in brk
                    assert "dates" in brk
                    assert "campus_closed" in brk
                    assert len(brk["dates"]) > 0

    @pytest.mark.parametrize("sem", ["winter", "may_intersession", "summer"])
    def test_intersession_required_keys(self, sem):
        data = ACADEMIC_CALENDARS["2025-2026"][sem]
        for key in ("classes_start", "classes_end", "breaks"):
            assert key in data, f"Missing key: {key}"


# =============================================================================
# get_week_of_semester
# =============================================================================


class TestGetWeekOfSemester:
    """Test week_of_semester computation and period classification."""

    def test_first_day_of_fall_classes(self):
        week, period = get_week_of_semester(date(2025, 8, 25))
        assert week == 1
        assert period == "early"

    def test_second_week(self):
        week, period = get_week_of_semester(date(2025, 9, 2))
        assert week == 2
        assert period == "early"

    def test_labor_day_is_break(self):
        _, period = get_week_of_semester(date(2025, 9, 1))
        assert period == "break"

    def test_reading_day_is_dead_week(self):
        _, period = get_week_of_semester(date(2025, 12, 11))
        assert period == "dead_week"

    def test_finals_period(self):
        _, period = get_week_of_semester(date(2025, 12, 15))
        assert period == "finals"

    def test_between_semesters_is_break(self):
        # Dec 25 falls between fall end (Dec 24) and winter start (Jan 2)
        week, period = get_week_of_semester(date(2025, 12, 25))
        assert week == 0
        assert period == "break"

    def test_pre_classes_is_break(self):
        # Aug 20 is semester_start but before classes_start (Aug 25)
        week, period = get_week_of_semester(date(2025, 8, 20))
        assert period == "break"
        assert week == 0

    def test_spring_first_week(self):
        week, period = get_week_of_semester(date(2026, 1, 20))
        assert week == 1
        assert period == "early"

    def test_spring_finals(self):
        _, period = get_week_of_semester(date(2026, 5, 12))
        assert period == "finals"

    def test_veterans_day_break(self):
        _, period = get_week_of_semester(date(2025, 11, 11))
        assert period == "break"

    def test_thanksgiving_break(self):
        _, period = get_week_of_semester(date(2025, 11, 27))
        assert period == "break"

    def test_winter_session_regular(self):
        week, period = get_week_of_semester(date(2026, 1, 5))
        assert period == "regular"

    def test_may_intersession_regular(self):
        week, period = get_week_of_semester(date(2026, 5, 20))
        assert period == "regular"

    def test_summer_session_regular(self):
        week, period = get_week_of_semester(date(2026, 7, 1))
        assert period == "regular"

    def test_intersession_break_is_break(self):
        # Memorial Day during May Intersession
        _, period = get_week_of_semester(date(2026, 5, 25))
        assert period == "break"

    def test_independence_day_break(self):
        # Independence Day during Summer Session
        _, period = get_week_of_semester(date(2026, 7, 3))
        assert period == "break"

    def test_midterms_week_8(self):
        week, period = get_week_of_semester(date(2025, 10, 15))
        assert week == 8
        assert period == "midterms"

    def test_midterms_week_9(self):
        week, period = get_week_of_semester(date(2025, 10, 20))
        assert week == 9
        assert period == "midterms"

    def test_regular_after_early(self):
        # Week 3 should be regular, not early
        week, period = get_week_of_semester(date(2025, 9, 8))
        assert week == 3
        assert period == "regular"

    def test_late_after_midterms(self):
        # Week 10 should be late, not regular
        week, period = get_week_of_semester(date(2025, 10, 27))
        assert week == 10
        assert period == "late"

    def test_late_week_13(self):
        # Week 13 should be late
        week, period = get_week_of_semester(date(2025, 11, 17))
        assert week == 13
        assert period == "late"

    def test_dead_week_15(self):
        # Week 15 — dead week before finals
        week, period = get_week_of_semester(date(2025, 12, 1))
        assert week == 15
        assert period == "dead_week"

    def test_dead_week_16(self):
        # Week 16 (partial, last class days before reading/finals) — also dead_week
        week, period = get_week_of_semester(date(2025, 12, 8))
        assert week == 16
        assert period == "dead_week"

    def test_accepts_datetime(self):
        _, period = get_week_of_semester(datetime(2025, 9, 3, 10, 30, 0))
        assert period == "early"


# =============================================================================
# is_class_day
# =============================================================================


class TestIsClassDay:
    """Test class-day detection."""

    def test_regular_weekday(self):
        # Wednesday Sep 3, 2025 — normal class day
        assert is_class_day(date(2025, 9, 3)) is True

    def test_weekend(self):
        # Saturday Aug 30, 2025
        assert is_class_day(date(2025, 8, 30)) is False

    def test_labor_day(self):
        assert is_class_day(date(2025, 9, 1)) is False

    def test_reading_day(self):
        assert is_class_day(date(2025, 12, 11)) is False

    def test_finals_day(self):
        assert is_class_day(date(2025, 12, 15)) is False

    def test_between_semesters(self):
        # Dec 25 is between fall end and winter start
        assert is_class_day(date(2025, 12, 25)) is False

    def test_last_day_of_classes(self):
        assert is_class_day(date(2025, 12, 10)) is True

    def test_fall_break(self):
        assert is_class_day(date(2025, 11, 24)) is False

    def test_spring_class_day(self):
        # Tuesday Feb 3, 2026
        assert is_class_day(date(2026, 2, 3)) is True

    def test_spring_recess(self):
        assert is_class_day(date(2026, 3, 31)) is False

    def test_winter_session_weekday(self):
        # Monday Jan 5, 2026 — winter session class day
        assert is_class_day(date(2026, 1, 5)) is True

    def test_may_intersession_weekday(self):
        # Wednesday May 20, 2026
        assert is_class_day(date(2026, 5, 20)) is True

    def test_summer_session_weekday(self):
        # Wednesday Jul 1, 2026
        assert is_class_day(date(2026, 7, 1)) is True

    def test_memorial_day_not_class_day(self):
        # Memorial Day during May Intersession
        assert is_class_day(date(2026, 5, 25)) is False

    def test_independence_day_not_class_day(self):
        assert is_class_day(date(2026, 7, 3)) is False


# =============================================================================
# get_semester_progress
# =============================================================================


class TestGetSemesterProgress:
    """Test semester progress calculation."""

    def test_at_start(self):
        progress = get_semester_progress(date(2025, 8, 25))
        assert progress == 0.0

    def test_at_end(self):
        progress = get_semester_progress(date(2025, 12, 18))
        assert progress == 1.0

    def test_midpoint_is_roughly_half(self):
        progress = get_semester_progress(date(2025, 10, 15))
        assert 0.3 < progress < 0.6

    def test_outside_semester(self):
        # Dec 25 is between fall end and winter start
        progress = get_semester_progress(date(2025, 12, 25))
        assert progress == 0.0

    def test_spring_progress(self):
        progress = get_semester_progress(date(2026, 3, 1))
        assert 0.2 < progress < 0.5

    def test_day_before_end_is_less_than_one(self):
        # Dec 17 is one day before finals_end (Dec 18)
        progress = get_semester_progress(date(2025, 12, 17))
        assert 0.9 < progress < 1.0

    def test_monotonically_increasing(self):
        """Progress should increase over the semester."""
        dates = [
            date(2025, 9, 1),
            date(2025, 10, 1),
            date(2025, 11, 1),
            date(2025, 12, 1),
        ]
        values = [get_semester_progress(d) for d in dates]
        assert values == sorted(values)
        assert values[0] < values[-1]


# =============================================================================
# Adapter: get_semester
# =============================================================================


class TestGetSemester:
    """Test the get_semester adapter function."""

    def test_fall_class_day(self):
        assert get_semester(date(2025, 9, 3)) == "fall"

    def test_spring_class_day(self):
        assert get_semester(date(2026, 2, 10)) == "spring"

    def test_winter_intersession_is_session(self):
        assert get_semester(date(2026, 1, 5)) == "session"

    def test_may_intersession_is_session(self):
        assert get_semester(date(2026, 5, 20)) == "session"

    def test_summer_session_is_summer(self):
        assert get_semester(date(2026, 7, 1)) == "summer"

    def test_between_semesters_is_break(self):
        # Dec 25 is between fall end and winter start
        assert get_semester(date(2025, 12, 25)) == "break"

    def test_fall_finals_still_fall(self):
        assert get_semester(date(2025, 12, 15)) == "fall"

    def test_fall_break_still_fall(self):
        # Labor Day is within fall semester
        assert get_semester(date(2025, 9, 1)) == "fall"

    def test_accepts_datetime(self):
        dt = datetime(2025, 9, 3, 10, 30, 0)
        assert get_semester(dt) == "fall"


# =============================================================================
# Adapter: is_campus_open
# =============================================================================


class TestIsCampusOpen:
    """Test the is_campus_open adapter function."""

    def test_normal_day_open(self):
        assert is_campus_open(date(2025, 9, 3)) is True

    def test_labor_day_closed(self):
        assert is_campus_open(date(2025, 9, 1)) is False

    def test_thanksgiving_closed(self):
        assert is_campus_open(date(2025, 11, 27)) is False

    def test_fall_break_open(self):
        # Fall Break — campus open (no classes but not closed)
        assert is_campus_open(date(2025, 11, 24)) is True

    def test_between_semesters_open(self):
        # Dec 25 is truly between fall end and winter start — campus open by default
        assert is_campus_open(date(2025, 12, 25)) is True

    def test_accepts_datetime(self):
        dt = datetime(2025, 9, 1, 12, 0, 0)
        assert is_campus_open(dt) is False  # Labor Day

    def test_spring_cesar_chavez_closed(self):
        assert is_campus_open(date(2026, 3, 31)) is False

    def test_winter_session_open(self):
        assert is_campus_open(date(2026, 1, 5)) is True

    def test_memorial_day_closed(self):
        assert is_campus_open(date(2026, 5, 25)) is False

    def test_independence_day_closed(self):
        assert is_campus_open(date(2026, 7, 3)) is False

    def test_summer_session_regular_day_open(self):
        assert is_campus_open(date(2026, 7, 1)) is True

    def test_juneteenth_closed(self):
        assert is_campus_open(date(2026, 6, 19)) is False

    def test_mlk_day_closed(self):
        # MLK Day is under winter session (campus closed)
        assert is_campus_open(date(2026, 1, 19)) is False
