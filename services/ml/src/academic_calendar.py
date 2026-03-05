"""
CSULB Academic Calendar — Rule-Based Heuristics.

Computes semester dates dynamically for any academic year using
CSULB's predictable calendar patterns. No hardcoded per-year data needed.

Heuristic rules used:
    - Fall: classes start on the 4th Monday of August (~16 week semester).
    - Spring: classes start the Tuesday after MLK Day (3rd Monday of January).
    - Winter intersession: first weekday on/after January 2 through MLK Day.
    - May intersession: Monday after spring finals for ~3 weeks.
    - Summer session: follows May intersession for ~10 weeks.
    - Holidays follow federal observed-holiday rules (Sat->Fri, Sun->Mon).

Why heuristics over hardcoded dates:
    CSULB has followed these patterns consistently. For ML feature engineering,
    what matters is consistency between training and inference — both use the
    same rules, so the model learns correct patterns even if a date is off by a day.
    Category-level accuracy (classes vs. finals vs. break) is the main driver of
    prediction quality.

    If CSULB changes their scheduling pattern, update the _generate_* functions.
"""

from __future__ import annotations

import calendar as _cal
from datetime import date, datetime, timedelta
from functools import lru_cache

__all__ = [
    "ACADEMIC_CALENDARS",
    "generate_academic_year",
    "get_week_of_semester",
    "is_class_day",
    "get_semester_progress",
    "get_semester",
    "is_campus_open",
]


# ---------------------------------------------------------------------------
# Date utilities
# ---------------------------------------------------------------------------

MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY = range(7)


def _nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> date:
    """
    Find the nth occurrence of a weekday in a given month.

    Args:
        year: Calendar year.
        month: Month (1-12).
        weekday: Day of week (0=Monday, 6=Sunday).
        n: Which occurrence (1-based).

    Returns:
        The date of the nth weekday in that month.
    """
    # Find the first occurrence of the weekday
    first_day_wkday = date(year, month, 1).weekday()
    # Days until the first occurrence of target weekday
    days_ahead = (weekday - first_day_wkday) % 7
    first_occurrence = 1 + days_ahead
    # Jump to nth occurrence
    day = first_occurrence + (n - 1) * 7
    return date(year, month, day)


def _last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    """
    Find the last occurrence of a weekday in a given month.

    Args:
        year: Calendar year.
        month: Month (1-12).
        weekday: Day of week (0=Monday, 6=Sunday).

    Returns:
        The date of the last weekday in that month.
    """
    # Find last day of the month
    last_day = _cal.monthrange(year, month)[1]
    # Count days back from month end to target weekday
    last_day_wkday = date(year, month, last_day).weekday()
    days_back = (last_day_wkday - weekday) % 7
    return date(year, month, last_day - days_back)


def _observe_holiday(d: date) -> date:
    """
    Apply the federal observed-holiday rule.

    If the holiday falls on Saturday, observe on Friday.
    If it falls on Sunday, observe on Monday.
    """
    if d.weekday() == SATURDAY:
        return d - timedelta(days=1)
    if d.weekday() == SUNDAY:
        return d + timedelta(days=1)
    return d


def _monday_of_week(d: date) -> date:
    """Return the Monday of the ISO week containing a given date."""
    return d - timedelta(days=d.weekday())


# ---------------------------------------------------------------------------
# Calendar generation — individual semesters
# ---------------------------------------------------------------------------


def _generate_fall(year: int) -> dict:
    """Generate Fall semester calendar for the given year."""
    # CSULB; Fall semester starts on 4th monday of the July
    classes_start = _nth_weekday_of_month(year, 8, MONDAY, 4)
    semester_start = classes_start - timedelta(days=7)  # orientation week
    classes_end = classes_start + timedelta(days=107)  # Wednesday of week 16
    reading_day = classes_end + timedelta(days=1)  # Thursday
    finals_start = classes_end + timedelta(days=2)  # Friday
    finals_end = finals_start + timedelta(days=6)  # following Thursday
    semester_end = finals_end + timedelta(days=6)  # end-of-calendar wrap

    # Breaks
    labor_day = _nth_weekday_of_month(year, 9, MONDAY, 1)
    veterans_day = _observe_holiday(date(year, 11, 11))
    thanksgiving = _nth_weekday_of_month(year, 11, THURSDAY, 4)
    fall_break_start = thanksgiving - timedelta(days=3)  # Monday of that week

    breaks = [
        {
            "name": "Labor Day",
            "dates": [labor_day],
            "campus_closed": True,
        },
        {
            "name": "Veterans Day",
            "dates": [veterans_day],
            "campus_closed": True,
        },
        {
            "name": "Fall Break",
            "dates": [
                fall_break_start,  # Monday
                fall_break_start + timedelta(days=1),  # Tuesday
                fall_break_start + timedelta(days=2),  # Wednesday
            ],
            "campus_closed": False,
        },
        {
            "name": "Thanksgiving",
            "dates": [
                thanksgiving,  # Thursday
                thanksgiving + timedelta(days=1),  # Friday
                thanksgiving + timedelta(days=2),  # Saturday
                thanksgiving + timedelta(days=3),  # Sunday
            ],
            "campus_closed": True,
        },
    ]

    return {
        "semester_start": semester_start,
        "semester_end": semester_end,
        "classes_start": classes_start,
        "classes_end": classes_end,
        "finals_start": finals_start,
        "finals_end": finals_end,
        "breaks": breaks,
        "reading_days": [reading_day],
    }


def _generate_spring(year: int) -> dict:
    """Generate Spring semester calendar for the given year."""
    # CSULB; spring starts on 3rd Monday of Jan
    mlk_day = _nth_weekday_of_month(year, 1, MONDAY, 3)
    classes_start = mlk_day + timedelta(days=1)  # Tuesday after MLK Day
    semester_start = classes_start
    classes_end = classes_start + timedelta(days=107)  # Friday of week 16
    finals_start = classes_end + timedelta(days=3)  # following Monday
    finals_end = finals_start + timedelta(days=5)  # Saturday
    semester_end = finals_end + timedelta(days=1)  # Sunday (before may intersession)

    # Spring Recess: full week (Mon-Sun) containing March 31
    mar31 = date(year, 3, 31)
    recess_start = _monday_of_week(mar31)
    spring_recess_dates = [recess_start + timedelta(days=i) for i in range(7)]

    # Cesar Chavez Day (March 31, observed)
    cesar_chavez = _observe_holiday(mar31)

    breaks = [
        {
            "name": "Spring Recess",
            "dates": spring_recess_dates,
            "campus_closed": False,
        },
        {
            "name": "Cesar Chavez Day",
            "dates": [cesar_chavez],
            "campus_closed": True,
        },
    ]

    return {
        "semester_start": semester_start,
        "semester_end": semester_end,
        "classes_start": classes_start,
        "classes_end": classes_end,
        "finals_start": finals_start,
        "finals_end": finals_end,
        "breaks": breaks,
        "reading_days": [],
    }


def _generate_winter(year: int) -> dict:
    """Generate Winter intersession calendar for the given year."""
    # Starts first weekday on or after January 2
    jan2 = date(year, 1, 2)
    if jan2.weekday() == SATURDAY:
        start = jan2 + timedelta(days=2)
    elif jan2.weekday() == SUNDAY:
        start = jan2 + timedelta(days=1)
    else:
        start = jan2

    mlk_day = _nth_weekday_of_month(year, 1, MONDAY, 3)
    end = mlk_day  # Includes MLK Day (as a break within the session)

    return {
        "semester_start": start,
        "semester_end": end,
        "classes_start": start,
        "classes_end": end,
        "finals_start": None,
        "finals_end": None,
        "breaks": [
            {
                "name": "Martin Luther King Jr. Day",
                "dates": [mlk_day],
                "campus_closed": True,
            },
        ],
        "reading_days": [],
    }


def _generate_may_intersession(spring: dict) -> dict:
    """Generate May intersession calendar based on spring semester dates."""
    # Starts the Monday after spring finals end
    finals_end = spring["finals_end"]
    days_to_monday = (MONDAY - finals_end.weekday()) % 7
    if days_to_monday == 0:
        days_to_monday = 7
    start = finals_end + timedelta(days=days_to_monday)
    end = start + timedelta(days=18)  # ~3 weeks

    # Memorial Day (last Monday of May)
    memorial_day = _last_weekday_of_month(start.year, 5, MONDAY)

    breaks = []
    # Include memorial day if within intersession
    if start <= memorial_day <= end:
        breaks.append(
            {
                "name": "Memorial Day",
                "dates": [memorial_day],
                "campus_closed": True,
            }
        )

    return {
        "semester_start": start,
        "semester_end": end,
        "classes_start": start,
        "classes_end": end,
        "finals_start": None,
        "finals_end": None,
        "breaks": breaks,
        "reading_days": [],
    }


def _generate_summer(may: dict, year: int) -> dict:
    """Generate Summer session calendar based on may intersession dates."""
    # Currently using
    # - 12-week session to represent summer
    # - Start date overlaps w/ may intersession; cut from 12 weeks -> 10 weeks
    start = may["semester_end"] + timedelta(days=1)
    end = start + timedelta(days=69)  # ~10 weeks

    # Juneteenth (June 19, observed)
    juneteenth = _observe_holiday(date(year, 6, 19))
    # Independence Day (July 4, observed)
    independence_day = _observe_holiday(date(year, 7, 4))

    breaks = []
    if start <= juneteenth <= end:
        breaks.append(
            {
                "name": "Juneteenth",
                "dates": [juneteenth],
                "campus_closed": True,
            }
        )
    if start <= independence_day <= end:
        breaks.append(
            {
                "name": "Independence Day",
                "dates": [independence_day],
                "campus_closed": True,
            }
        )

    return {
        "semester_start": start,
        "semester_end": end,
        "classes_start": start,
        "classes_end": end,
        "finals_start": None,
        "finals_end": None,
        "breaks": breaks,
        "reading_days": [],
    }


# ---------------------------------------------------------------------------
# Main generation function
# ---------------------------------------------------------------------------


# Memoizes 32 academic years
@lru_cache(maxsize=32)
def generate_academic_year(start_year: int) -> dict:
    """
    Generate the full academic calendar for an academic year.

    Args:
        start_year: The year the academic year begins (e.g., 2025 for 2025-2026).

    Returns:
        Dict with keys: fall, spring, winter, may_intersession, summer.
    """
    next_year = start_year + 1

    fall = _generate_fall(start_year)
    spring = _generate_spring(next_year)
    winter = _generate_winter(next_year)
    may = _generate_may_intersession(spring)
    summer = _generate_summer(may, next_year)

    return {
        "fall": fall,
        "spring": spring,
        "winter": winter,
        "may_intersession": may,
        "summer": summer,
    }


# ---------------------------------------------------------------------------
# Lazy cache for backward compatibility
# ---------------------------------------------------------------------------


class _CalendarCache(dict):
    """Dict that generates academic year data on first access."""

    def __missing__(self, key: str) -> dict:
        start_year = int(key.split("-")[0])
        value = generate_academic_year(start_year)
        self[key] = value
        return value


# Lazy-loading dictionary; {semester: semester_data}
ACADEMIC_CALENDARS: dict[str, dict] = _CalendarCache()

INTERSESSION_KEYS = ("winter", "may_intersession", "summer")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _all_break_dates(semester: dict) -> set[date]:
    """Collect all break dates for a semester."""
    dates: set[date] = set()
    for brk in semester.get("breaks", []):
        dates.update(brk["dates"])
    return dates


def _all_closed_dates(semester: dict) -> set[date]:
    """Collect all campus-closed dates for a semester."""
    dates: set[date] = set()
    for brk in semester.get("breaks", []):
        if brk["campus_closed"]:
            dates.update(brk["dates"])
    return dates


def _academic_year_for_date(d: date) -> int:
    """
    Determine which academic year a date belongs to.

    Academic years run Aug-Jul. Dates in Aug+ belong to that year's
    academic year; dates in Jan-Jul belong to the previous year's.
    """
    return d.year if d.month >= 8 else d.year - 1


def _find_semester(d: date) -> tuple[dict, str, str, bool] | None:
    """
    Find the semester that contains a given date.

    Looks up the academic year for the date, then iterates through
    semesters (fall, winter, spring, may intersession, summer) to
    find which one the date falls within.

    Args:
        d: The date to look up.

    Returns:
        A tuple of (semester_dict, semester_label, sem_key, is_intersession),
        or None if the date does not fall within any semester.
    """
    # Locate year data for given date
    start_year = _academic_year_for_date(d)
    year_data = generate_academic_year(start_year)
    year_key = f"{start_year}-{start_year + 1}"

    for sem_name in ("fall", "winter", "spring", "may_intersession", "summer"):
        sem = year_data[sem_name]
        start = sem.get("semester_start") or sem.get("classes_start")
        end = sem.get("semester_end") or sem.get("finals_end")
        if start and end and start <= d <= end:
            is_intersession = sem_name in INTERSESSION_KEYS
            label = sem_name.replace("_", " ").title()
            return sem, f"{label} {year_key}", sem_name, is_intersession
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_week_of_semester(d: date) -> tuple[int, str]:
    """
    Get the week number and academic period for a date.

    Args:
        d: The date to classify.

    Returns:
        Tuple of (week_number, period).
        week_number: 1-based week of the semester (0 if outside classes).
        period: One of "early", "regular", "midterms", "late",
            "dead_week", "finals", "break".
            - "early": first 2 weeks of classes (weeks 1-2, fall/spring only)
            - "regular": standard class weeks (weeks 3-7, fall/spring only)
            - "midterms": weeks 8-9 of classes (fall/spring only)
            - "late": post-midterm stretch (weeks 10-14, fall/spring only)
            - "dead_week": last week of classes before finals (week 15, fall/spring only)
            - "finals": official finals period
            - "break": breaks, holidays, or outside any semester
    """
    if isinstance(d, datetime):
        d = d.date() if hasattr(d, "date") else d

    result = _find_semester(d)
    if result is None:
        return 0, "break"

    sem, _, _, is_intersession = result

    classes_start = sem.get("classes_start")
    classes_end = sem.get("classes_end")
    finals_start = sem.get("finals_start")
    finals_end = sem.get("finals_end")
    reading_days = set(sem.get("reading_days", []))
    break_dates = _all_break_dates(sem)

    # Compute week number from classes_start
    if classes_start and d >= classes_start:
        week = ((d - classes_start).days // 7) + 1
    else:
        week = 0

    # Determine period
    if d in break_dates:
        period = "break"
    elif finals_start and finals_end and finals_start <= d <= finals_end:
        period = "finals"
    elif classes_start and classes_end and classes_start <= d <= classes_end:
        if not is_intersession and week <= 2:
            period = "early"
        elif not is_intersession and 3 <= week <= 7:
            period = "regular"
        elif not is_intersession and 8 <= week <= 9:
            period = "midterms"
        elif not is_intersession and 10 <= week <= 14:
            period = "late"
        elif not is_intersession and week >= 15:
            period = "dead_week"
        else:
            period = "regular"
    elif d in reading_days:
        period = "dead_week"
    else:
        period = "break"

    return week, period


def is_class_day(d: date) -> bool:
    """
    Check whether a date is a regular class day.

    Returns True only for dates during the instruction period that are not
    breaks, reading days, weekends, or holidays.
    """
    if d.weekday() >= 5:  # Sat=5, Sun=6
        return False

    # Date not within a semester
    result = _find_semester(d)
    if result is None:
        return False

    sem, _, _, _ = result
    classes_start = sem.get("classes_start")
    classes_end = sem.get("classes_end")

    if not classes_start or not classes_end:
        return False
    if not (classes_start <= d <= classes_end):
        return False

    # Exclude breaks and reading days
    break_dates = _all_break_dates(sem)
    reading_days = set(sem.get("reading_days", []))
    if d in break_dates or d in reading_days:
        return False

    return True


def get_semester_progress(d: date) -> float:
    """
    Get how far through the semester a date is (0.0 to 1.0).

    Returns 0.0 for dates before the semester, 1.0 for dates after.
    Uses classes_start to finals_end as the range.
    """
    result = _find_semester(d)
    if result is None:
        return 0.0

    sem, _, _, _ = result
    start = sem.get("classes_start")
    end = sem.get("finals_end") or sem.get("classes_end")

    if not start or not end:
        return 0.0

    if d <= start:
        return 0.0
    if d >= end:
        return 1.0

    total_days = (end - start).days
    elapsed = (d - start).days
    return elapsed / total_days if total_days > 0 else 0.0


_SEMESTER_MAP = {
    "fall": "fall",
    "spring": "spring",
    "winter": "session",
    "may_intersession": "session",
    "summer": "summer",
}


def get_semester(d: date) -> str:
    """
    Classify a date into a semester category for ML features.

    Returns one of: "fall", "spring", "summer", "session", "break".

    Winter intersession and may intersession map to "session".
    Summer session maps to "summer". Dates not within any session
    map to "break".
    """
    if isinstance(d, datetime):
        d = d.date() if hasattr(d, "date") else d

    result = _find_semester(d)
    if result is None:
        return "break"

    _, _, sem_key, _ = result
    return _SEMESTER_MAP[sem_key]


def is_campus_open(d: date) -> bool:
    """
    Check whether campus is open on a given date.

    Returns False for dates that fall on campus-closed holidays
    (e.g., Labor Day, Thanksgiving). Returns True otherwise,
    including weekends and breaks where campus remains open.
    """
    if isinstance(d, datetime):
        d = d.date() if hasattr(d, "date") else d

    result = _find_semester(d)
    if result is None:
        return True

    sem, _, _, _ = result
    closed_dates = _all_closed_dates(sem)
    return d not in closed_dates
