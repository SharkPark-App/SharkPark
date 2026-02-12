"""
SharkPark ML Academic Calendar Utilities.

Simple date-range helpers for academic period classification and campus
closure checks.  Currently scoped to a single semester defined in
config.py — will be replaced with multi-semester logic once the
academic-calendar scraper is built.
"""

from datetime import datetime

from src.config import (
    SEMESTER_START,
    SEMESTER_END,
    FINALS_START,
    FINALS_END,
    CAMPUS_CLOSURES,
)


def get_academic_period(date: datetime) -> str:
    """
    Classify a date into an academic period.

    NOTE: Currently single-semester only (uses config.py constants).
    Will be replaced with multi-semester logic when the calendar
    scraper is built.

    Returns:
        "regular" — normal class weeks
        "finals"  — finals week
        "break"   — inter-semester breaks, post-finals
        "summer"  — summer session / pre-semester
    """
    # Strip timezone; consistent comparison with naive constants
    if hasattr(date, 'tzinfo') and date.tzinfo is not None:
        date = date.replace(tzinfo=None)

    if date < SEMESTER_START:
        return "summer"
    if date > SEMESTER_END:
        return "break"
    if FINALS_START <= date <= FINALS_END:
        return "finals"
    if date > FINALS_END:
        return "break"

    return "regular"


def is_campus_open(date: datetime) -> bool:
    """
    Check if campus is open on a given date.

    Returns False on holidays and closures (Labor Day, Thanksgiving, etc.).
    """
    # Strip timezone; consistent comparison with naive CAMPUS_CLOSURES
    if hasattr(date, 'tzinfo') and date.tzinfo is not None:
        date = date.replace(tzinfo=None)
    date_only = date.replace(hour=0, minute=0, second=0, microsecond=0)
    return date_only not in CAMPUS_CLOSURES
