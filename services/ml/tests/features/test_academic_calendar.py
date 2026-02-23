"""
Tests for academic calendar config (src.academic_calendar).

Covers:
    - get_week_of_semester: week numbering, period classification, edge cases
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
    get_academic_period,
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
        week, period, name = get_week_of_semester(date(2025, 8, 25))
        assert week == 1
        assert period == "classes"
        assert "Fall" in name

    def test_second_week(self):
        week, period, _ = get_week_of_semester(date(2025, 9, 2))
        assert week == 2
        assert period == "classes"

    def test_labor_day_is_break(self):
        week, period, _ = get_week_of_semester(date(2025, 9, 1))
        assert period == "break"

    def test_reading_day(self):
        week, period, _ = get_week_of_semester(date(2025, 12, 11))
        assert period == "reading_day"

    def test_finals_period(self):
        week, period, _ = get_week_of_semester(date(2025, 12, 15))
        assert period == "finals"

    def test_between_semesters(self):
        # Dec 25 falls between fall end (Dec 24) and winter start (Jan 2)
        week, period, name = get_week_of_semester(date(2025, 12, 25))
        assert week == 0
        assert period == "between_semesters"

    def test_pre_classes_fall(self):
        # Aug 18 is semester_start but before classes_start (Aug 25)
        week, period, _ = get_week_of_semester(date(2025, 8, 20))
        assert period == "pre_classes"
        assert week == 0

    def test_spring_first_week(self):
        week, period, name = get_week_of_semester(date(2026, 1, 20))
        assert week == 1
        assert period == "classes"
        assert "Spring" in name

    def test_spring_finals(self):
        week, period, _ = get_week_of_semester(date(2026, 5, 12))
        assert period == "finals"

    def test_veterans_day_break(self):
        _, period, _ = get_week_of_semester(date(2025, 11, 11))
        assert period == "break"

    def test_thanksgiving_break(self):
        _, period, _ = get_week_of_semester(date(2025, 11, 27))
        assert period == "break"

    def test_winter_session_is_intersession(self):
        week, period, name = get_week_of_semester(date(2026, 1, 5))
        assert period == "intersession"
        assert "Winter" in name

    def test_may_intersession_is_intersession(self):
        week, period, name = get_week_of_semester(date(2026, 5, 20))
        assert period == "intersession"
        assert "May Intersession" in name

    def test_summer_session_is_intersession(self):
        week, period, name = get_week_of_semester(date(2026, 7, 1))
        assert period == "intersession"
        assert "Summer" in name

    def test_intersession_break_is_break(self):
        # Memorial Day during May Intersession
        _, period, _ = get_week_of_semester(date(2026, 5, 25))
        assert period == "break"

    def test_independence_day_break(self):
        # Independence Day during Summer Session
        _, period, _ = get_week_of_semester(date(2026, 7, 3))
        assert period == "break"


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
# Adapter: get_academic_period
# =============================================================================


class TestGetAcademicPeriod:
    """Test the get_academic_period adapter function."""

    def test_regular_class_day(self):
        assert get_academic_period(date(2025, 9, 3)) == "regular"

    def test_finals(self):
        assert get_academic_period(date(2025, 12, 15)) == "finals"

    def test_break_holiday(self):
        assert get_academic_period(date(2025, 9, 1)) == "break"  # Labor Day

    def test_between_semesters_returns_off_session(self):
        # Dec 25 is between fall end (Dec 24) and winter start (Jan 2)
        assert get_academic_period(date(2025, 12, 25)) == "off_session"

    def test_reading_day_is_regular(self):
        # Reading days map to "regular" (not a break for period classification)
        assert get_academic_period(date(2025, 12, 11)) == "regular"

    def test_pre_classes_is_regular(self):
        assert get_academic_period(date(2025, 8, 20)) == "regular"

    def test_accepts_datetime(self):
        dt = datetime(2025, 9, 3, 10, 30, 0)
        assert get_academic_period(dt) == "regular"

    def test_spring_regular(self):
        assert get_academic_period(date(2026, 2, 10)) == "regular"

    def test_winter_session_intersession(self):
        assert get_academic_period(date(2026, 1, 5)) == "intersession"

    def test_may_intersession_intersession(self):
        assert get_academic_period(date(2026, 5, 20)) == "intersession"

    def test_summer_session_intersession(self):
        assert get_academic_period(date(2026, 7, 1)) == "intersession"

    def test_intersession_break_is_break(self):
        # Memorial Day during May Intersession
        assert get_academic_period(date(2026, 5, 25)) == "break"


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
