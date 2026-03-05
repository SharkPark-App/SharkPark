"""
Synthetic Data Generator for SharkPark ML Training

Generates realistic parking occupancy snapshots for model training during cold-start.
Lot metadata (IDs, capacities, types) is fetched from Aurora PostgreSQL.

Usage (from services/ml/):
    python -m src.data.synthetic                                  # Generate Fall 2025 (default)
    python -m src.data.synthetic --semester spring-2026            # Generate Spring 2026
    python -m src.data.synthetic --semester fall-2025 --preview 10 # Preview 10 records
    python -m src.data.synthetic --output data.parquet

Output Schema (matches Aurora occupancy_snapshots + local-only fields):
    - lot_id: str              # Lot identifier (G1, E1, PYR, etc.)
    - timestamp: str           # ISO8601 timestamp
    - occupancy: int           # Current vehicle count
    - available: int           # capacity - occupancy
    - occupancy_rate: float    # 0.0-1.0
    - confidence: str          # "HIGH"
    - is_cold_start: bool      # True for synthetic data
    - semester: str            # "fall", "spring", "summer", "session", "break"
    - academic_period: str     # "early", "regular", "midterms", "late", "dead_week", "finals", "break"
    - week_of_semester: int    # 0-16
    - is_campus_open: bool     # Whether campus is open
    - source: str              # "synthetic" (generator-only; absent in real data,
                               #  used at training time to apply sample weights)


Volume: ~8,450 records per lot x 28 lots ≈ 237K total records
    (one snapshot per 15-min slot across the semester; actual count depends on semester length)

Semester Configuration:
    The target semester is selected at runtime via the ``--semester`` flag:

        python -m src.data.synthetic --semester fall-2025
        python -m src.data.synthetic --semester spring-2026

    The format is ``{term}-{year}`` where *year* is the calendar year the
    term occurs in. Valid terms: fall, spring.  (Intersessions are excluded
    because the occupancy heuristics assume a ~16-week semester structure.)
    All dates (semester start/end, finals, breaks, closures) are derived from
    the heuristic calendar in academic_calendar.py via ``resolve_semester()``.

    Multi-semester: The generator only supports one semester per run. To combine
    semesters, run the script once per semester with different ``--output`` paths,
    then ``pd.concat`` the parquets at training time.

Patterns Modeled:
    - Time-of-day curves (different for student vs employee lots)
    - Day-of-week variation (lighter weekends)
    - Semester phases (early rush, midterms, finals)
    - Campus closures (holidays, breaks)
    - Random noise for realism
"""

import os
import random
from datetime import date, datetime, timedelta
from typing import Literal
from dataclasses import dataclass
import argparse

import psycopg2
import pandas as pd
import numpy as np

from src.academic_calendar import (
    ACADEMIC_CALENDARS,
    get_week_of_semester,
    is_campus_open,
    _all_break_dates,
    _all_closed_dates,
)
from src.config import (
    DATABASE_URL,
    OPERATING_START_HOUR,
    OPERATING_END_HOUR,
    BUFFER_START_HOUR,
    BUFFER_END_HOUR,
    SNAPSHOT_INTERVAL_MINUTES,
)

__all__ = [
    "SemesterConfig",
    "SemesterPhase",
    "LotInfo",
    "resolve_semester",
    "fetch_lots",
    "generate_timestamps",
    "generate_lot_data",
    "generate_all_data",
]


# ---------------------------------------------------------------------------
# Semester configuration — resolved at runtime from CLI --semester flag
# ---------------------------------------------------------------------------

# Valid term names accepted by --semester (mapped to academic_calendar keys).
# Limited to fall/spring — the occupancy heuristics assume a ~16-week semester structure.
_VALID_TERMS = {"fall", "spring"}


@dataclass(frozen=True)
class SemesterConfig:
    """Resolved calendar dates for a single semester.

    Built by ``resolve_semester()`` from a CLI key like ``fall-2025``.
    Passed through the generation pipeline.
    """

    semester: str  # "fall" or "spring" (the CLI term)
    semester_start: datetime
    semester_end: datetime
    data_start: datetime  # semester_start - 1 day (buffer)
    first_day_of_classes: datetime
    finals_start: datetime
    finals_end: datetime
    campus_closures: frozenset[date]
    no_classes_campus_open: frozenset[date]


def resolve_semester(key: str) -> SemesterConfig:
    """Parse a CLI semester key and return a resolved ``SemesterConfig``.

    Args:
        key: ``{term}-{year}`` where *year* is the calendar year the term
             occurs in. Examples: ``fall-2025``, ``spring-2026``

    Valid terms: fall, spring.
    """
    # Split on last hyphen to separate year from term
    parts = key.rsplit("-", 1)
    if len(parts) != 2:
        raise ValueError(
            f"Invalid semester key '{key}'. Expected format: {{term}}-{{year}} "
            f"(e.g., fall-2025, spring-2026)"
        )

    term_str, year_str = parts
    try:
        year = int(year_str)
    except ValueError:
        raise ValueError(
            f"Invalid year '{year_str}' in semester key '{key}'."
        ) from None

    if term_str not in _VALID_TERMS:
        valid = ", ".join(sorted(_VALID_TERMS))
        raise ValueError(f"Unknown term '{term_str}'. Valid terms: {valid}")

    # Map calendar year -> academic year key
    # Spring belongs to the prior academic year (spring-2026 -> 2025-2026)
    if term_str == "spring":
        academic_year = f"{year - 1}-{year}"
    else:
        academic_year = f"{year}-{year + 1}"

    sem = ACADEMIC_CALENDARS[academic_year][term_str]

    semester_start = datetime.combine(sem["semester_start"], datetime.min.time())
    semester_end = datetime.combine(sem["semester_end"], datetime.min.time())
    classes_start = datetime.combine(sem["classes_start"], datetime.min.time())
    finals_start = datetime.combine(sem["finals_start"], datetime.min.time())
    finals_end = datetime.combine(sem["finals_end"], datetime.min.time())

    closed = frozenset(_all_closed_dates(sem))
    break_not_closed = _all_break_dates(sem) - _all_closed_dates(sem)
    no_classes_open = frozenset(break_not_closed | set(sem.get("reading_days", [])))

    return SemesterConfig(
        semester=term_str,
        semester_start=semester_start,
        semester_end=semester_end,
        data_start=semester_start - timedelta(days=1),
        first_day_of_classes=classes_start,
        finals_start=finals_start,
        finals_end=finals_end,
        campus_closures=closed,
        no_classes_campus_open=no_classes_open,
    )


# =============================================================================
# SEMESTER PHASE (synthetic data only — single-semester)
# =============================================================================


@dataclass
class SemesterPhase:
    """Represents a phase of the semester with its occupancy multiplier."""

    name: str
    multiplier: float  # Applied to base occupancy


def get_semester_phase(date: datetime, cfg: SemesterConfig) -> SemesterPhase:
    """
    Determine semester phase for a given date.

    All thresholds are relative to ``cfg`` dates, so this works for any
    semester resolved at runtime.

    Phases (offsets from key dates):
        - pre_semester: Before semester start (low activity)
        - orientation: Semester start to first day of classes (moderate activity)
        - first_two_weeks: First 14 days of classes (high activity)
        - normal: Regular semester weeks
        - midterms: Weeks 8-9 of classes (medium-high activity)
        - finals_prep: ~11 days before finals start (high activity)
        - finals: Finals start to finals end (very high activity)
        - post_finals: After finals end through semester end (minimal activity)
    """
    # Before semester starts
    if date < cfg.semester_start:
        return SemesterPhase("pre_semester", 0.3)

    # Orientation / departmental meetings week (before classes)
    if cfg.semester_start <= date < cfg.first_day_of_classes:
        return SemesterPhase("orientation", 0.5)

    # First two weeks of classes - students figuring out parking
    first_two_weeks_end = cfg.first_day_of_classes + timedelta(days=14)
    if date <= first_two_weeks_end:
        return SemesterPhase("first_two_weeks", 1.15)

    # Midterms (roughly week 8-9)
    midterms_start = cfg.first_day_of_classes + timedelta(weeks=7)
    midterms_end = midterms_start + timedelta(days=13)
    if midterms_start <= date <= midterms_end:
        return SemesterPhase("midterms", 1.08)

    # Finals prep (last ~2 weeks of classes through day before finals)
    finals_prep_start = cfg.finals_start - timedelta(days=11)
    if finals_prep_start <= date < cfg.finals_start:
        return SemesterPhase("finals_prep", 1.12)

    # Finals week
    if cfg.finals_start <= date <= cfg.finals_end:
        return SemesterPhase("finals", 1.18)

    # Post-finals (semester wind-down)
    if date > cfg.finals_end:
        return SemesterPhase("post_finals", 0.15)

    # Normal semester
    return SemesterPhase("normal", 1.0)


# Lot popularity factors
HIGH_DEMAND_LOTS = {
    "G1",
    "G3",
    "PVS",
    "G4",
    "G5",
    "G6",
    "PYR",
    "E8",
    "E9",
    "E7",
    "E10",
    "E11",
}
LOW_DEMAND_LOTS = {"G8", "G9", "G11"}


# =============================================================================
# AURORA LOT LOADER
# =============================================================================


@dataclass
class LotInfo:
    """Parking lot metadata fetched from Aurora PostgreSQL."""

    lot_id: str
    capacity: int
    lot_type: str  # "STUDENT" | "EMPLOYEE"


def fetch_lots() -> list[LotInfo]:
    """
    Fetch parking lot metadata from Aurora PostgreSQL.

    Queries the ``lots`` table for lot_id, capacity, and lot_type.

    Environment variables:
        DATABASE_URL: PostgreSQL connection string
                      (default: from config.DATABASE_URL)
    """
    db_url = os.environ.get("DATABASE_URL", DATABASE_URL)

    try:
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT lot_id, capacity, lot_type FROM lots")
                rows = cur.fetchall()
        finally:
            conn.close()

        if not rows:
            raise RuntimeError("No parking lots found in Aurora 'lots' table.")

        return [
            LotInfo(
                lot_id=row[0],
                capacity=int(row[1]),
                lot_type=row[2].upper(),
            )
            for row in rows
        ]

    except psycopg2.OperationalError as exc:
        raise RuntimeError(f"Could not connect to Aurora at {db_url}: {exc}") from exc
    except psycopg2.Error as exc:
        raise RuntimeError(f"Aurora query failed: {exc}") from exc


# =============================================================================
# TIME-OF-DAY PATTERNS
# =============================================================================


def get_student_lot_hourly_pattern(hour: int, minute: int) -> float:
    """
    Student lot occupancy pattern throughout the day.

    Pattern:
        - 6am: 0.0 (buffer, closed)
        - 7am: 0.05 (just opened)
        - 8-10am: 0.15 -> 0.55 (gradual morning fill)
        - 11am-3pm: 0.70 -> 0.85 (peak hours, classes in session)
        - 3-5pm: 0.85 -> 0.50 (gradual afternoon departure)
        - 5-7pm: 0.50 -> 0.25 (evening classes, lower)
        - 7-9pm: 0.25 -> 0.10 (night classes, sparse)
        - 9pm+: 0.05 -> 0.0 (closing)

    Returns base occupancy rate (0.0-1.0) before noise/multipliers.
    """
    time_decimal = hour + minute / 60.0

    # Buffer hours (closed)
    if hour < OPERATING_START_HOUR or hour > OPERATING_END_HOUR:
        return 0.0

    # Early morning ramp (7-8am)
    if 7 <= time_decimal < 8:
        return np.interp(time_decimal, [7, 8], [0.05, 0.15])

    # Morning fill (8-10am)
    if 8 <= time_decimal < 10:
        return np.interp(time_decimal, [8, 10], [0.15, 0.55])

    # Late morning surge (10-11am)
    if 10 <= time_decimal < 11:
        return np.interp(time_decimal, [10, 11], [0.55, 0.72])

    # Peak hours (11am-3pm)
    if 11 <= time_decimal < 15:
        # Slight variation within peak: highest around 12-1pm
        if 11 <= time_decimal < 12:
            return np.interp(time_decimal, [11, 12], [0.72, 0.82])
        elif 12 <= time_decimal < 13:
            return np.interp(time_decimal, [12, 13], [0.82, 0.85])
        elif 13 <= time_decimal < 14:
            return np.interp(time_decimal, [13, 14], [0.85, 0.82])
        else:  # 14-15
            return np.interp(time_decimal, [14, 15], [0.82, 0.75])

    # Afternoon departure (3-5pm)
    if 15 <= time_decimal < 17:
        return np.interp(time_decimal, [15, 17], [0.75, 0.45])

    # Evening (5-7pm)
    if 17 <= time_decimal < 19:
        return np.interp(time_decimal, [17, 19], [0.45, 0.25])

    # Night classes (7-9pm)
    if 19 <= time_decimal < 21:
        return np.interp(time_decimal, [19, 21], [0.25, 0.08])

    return 0.0


def get_employee_lot_hourly_pattern(hour: int, minute: int) -> float:
    """
    Employee lot occupancy pattern throughout the day.

    Pattern (typical staff schedule 8am-5pm):
        - 6am: 0.0 (buffer)
        - 7am: 0.05 (early arrivals)
        - 7-9am: 0.05 -> 0.75 (main arrival window)
        - 9am-12pm: 0.75 -> 0.85 (stable high occupancy)
        - 12-1pm: 0.85 -> 0.80 (slight dip, lunch break)
        - 1-4pm: 0.80 -> 0.85 (stable afternoon)
        - 4-6pm: 0.85 -> 0.25 (main departure window)
        - 6-9pm: 0.25 -> 0.05 (stragglers, evening staff)

    Returns base occupancy rate (0.0-1.0) before noise/multipliers.
    """
    time_decimal = hour + minute / 60.0

    # Buffer hours
    if hour < OPERATING_START_HOUR or hour > OPERATING_END_HOUR:
        return 0.0

    # Early arrival (7-8am)
    if 7 <= time_decimal < 8:
        return np.interp(time_decimal, [7, 8], [0.05, 0.35])

    # Main arrival (8-9am)
    if 8 <= time_decimal < 9:
        return np.interp(time_decimal, [8, 9], [0.35, 0.75])

    # Morning stable (9am-12pm)
    if 9 <= time_decimal < 12:
        return np.interp(time_decimal, [9, 12], [0.75, 0.85])

    # Lunch dip (12-1pm)
    if 12 <= time_decimal < 13:
        return np.interp(time_decimal, [12, 13], [0.85, 0.78])

    # Afternoon stable (1-4pm)
    if 13 <= time_decimal < 16:
        return np.interp(time_decimal, [13, 16], [0.78, 0.82])

    # Main departure (4-6pm)
    if 16 <= time_decimal < 18:
        return np.interp(time_decimal, [16, 18], [0.82, 0.22])

    # Evening stragglers (6-9pm)
    if 18 <= time_decimal < 21:
        return np.interp(time_decimal, [18, 21], [0.22, 0.05])

    return 0.0


# =============================================================================
# DAY-OF-WEEK PATTERNS
# =============================================================================


def get_day_of_week_multiplier(
    weekday: int, lot_type: Literal["student", "employee"]
) -> float:
    """
    Adjust occupancy based on day of week.

    Args:
        weekday: 0=Monday through 6=Sunday
        lot_type: "student" or "employee"

    Student lots:
        - Mon-Thu: Full activity (1.0)
        - Friday: Slightly lower (0.85) - fewer Friday classes
        - Sat-Sun: Much lower (0.25) - weekend classes/events only

    Employee lots:
        - Mon-Fri: Full activity (1.0)
        - Sat: Low activity (0.15) - minimal weekend staff
        - Sun: Very low (0.08) - essential staff only
    """
    if lot_type == "student":
        multipliers = {
            0: 1.0,  # Monday
            1: 1.0,  # Tuesday
            2: 1.0,  # Wednesday
            3: 1.0,  # Thursday
            4: 0.85,  # Friday
            5: 0.25,  # Saturday
            6: 0.20,  # Sunday
        }
    else:  # employee
        multipliers = {
            0: 1.0,  # Monday
            1: 1.0,  # Tuesday
            2: 1.0,  # Wednesday
            3: 1.0,  # Thursday
            4: 0.95,  # Friday
            5: 0.15,  # Saturday
            6: 0.08,  # Sunday
        }

    return multipliers.get(weekday, 1.0)


# =============================================================================
# LOT-SPECIFIC VARIATION
# =============================================================================


def get_lot_popularity_factor(lot_id: str) -> float:
    """
    Each lot has inherent popularity based on location/convenience.

    Some lots (near popular buildings, pyramid) fill faster.
    Others (remote lots) stay emptier.

    Returns multiplier 0.7-1.1 for base occupancy.
    """
    if lot_id in HIGH_DEMAND_LOTS:
        return random.uniform(1.02, 1.10)
    elif lot_id in LOW_DEMAND_LOTS:
        return random.uniform(0.70, 0.82)
    else:
        return random.uniform(0.88, 1.02)


def get_lot_peak_shift(lot_id: str) -> float:
    """
    Some lots fill earlier/later than others.

    Returns hour offset (-0.5 to +0.5) to shift the pattern.
    Not currently used but available for future refinement.
    """
    # For now, return small random shift
    return random.uniform(-0.3, 0.3)


# =============================================================================
# NOISE GENERATION
# =============================================================================


def add_noise(base_rate: float, noise_level: float = 0.08) -> float:
    """
    Add random noise to occupancy rate.

    Args:
        base_rate: Base occupancy rate (0.0-1.0)
        noise_level: Standard deviation of noise (default 0.08 = +/-8%)

    Returns:
        Noisy occupancy rate, clamped to [0.0, 1.0]
    """
    # random.normal() uses global random state
    noise = np.random.normal(0, noise_level)
    noisy_rate = base_rate + noise
    return max(0.0, min(1.0, noisy_rate))


# =============================================================================
# MAIN GENERATION LOGIC
# =============================================================================


def generate_snapshot(
    lot_id: str,
    timestamp: datetime,
    capacity: int,
    lot_type: Literal["student", "employee"],
    lot_popularity: float,
    cfg: SemesterConfig | None = None,
) -> dict:
    """
    Generate a single occupancy snapshot for a lot at a specific time.

    Args:
        lot_id: Lot identifier
        timestamp: Datetime of snapshot
        capacity: Lot capacity
        lot_type: "student" or "employee"
        lot_popularity: Lot-specific popularity multiplier
        cfg: Resolved semester configuration

    Returns:
        Dict matching OccupancySnapshot schema
    """
    if cfg is None:
        cfg = resolve_semester("fall-2025")

    # Compute calendar features
    date_only = timestamp.date()
    campus_open = is_campus_open(timestamp)
    week_of_sem, academic_period = get_week_of_semester(timestamp.date())

    if date_only in cfg.campus_closures:
        return {
            "lot_id": lot_id,
            "timestamp": timestamp.isoformat() + "Z",
            "occupancy": 0,
            "available": capacity,
            "occupancy_rate": 0.0,
            "confidence": "HIGH",
            "is_cold_start": True,
            "semester": cfg.semester,
            "academic_period": academic_period,
            "week_of_semester": week_of_sem,
            "is_campus_open": campus_open,
            "source": "synthetic",
        }

    hour = timestamp.hour
    minute = timestamp.minute

    # Get base pattern by lot type
    if lot_type == "student":
        base_rate = get_student_lot_hourly_pattern(hour, minute)
    else:
        base_rate = get_employee_lot_hourly_pattern(hour, minute)

    # Apply multipliers (semester and week)
    semester_phase = get_semester_phase(timestamp, cfg)
    dow_multiplier = get_day_of_week_multiplier(timestamp.weekday(), lot_type)

    adjusted_rate = (
        base_rate * semester_phase.multiplier * dow_multiplier * lot_popularity
    )

    # No-classes days (campus open): employees normal, students minimal
    if date_only in cfg.no_classes_campus_open and lot_type == "student":
        adjusted_rate *= 0.15

    # Add noise (less noise during buffer/closed hours)
    if base_rate > 0.05:
        final_rate = add_noise(adjusted_rate, noise_level=0.07)
    else:
        final_rate = add_noise(adjusted_rate, noise_level=0.02)

    # Clamp to valid range; capped at 98% for realism sake
    final_rate = max(0.0, min(0.98, final_rate))

    # Calculate occupancy counts
    occupancy = int(round(final_rate * capacity))
    available = capacity - occupancy

    return {
        "lot_id": lot_id,
        "timestamp": timestamp.isoformat() + "Z",
        "occupancy": occupancy,
        "available": available,
        "occupancy_rate": round(final_rate, 4),
        "confidence": "HIGH",
        "is_cold_start": True,
        "semester": cfg.semester,
        "academic_period": academic_period,
        "week_of_semester": week_of_sem,
        "is_campus_open": campus_open,
        "source": "synthetic",
    }


def generate_timestamps(
    start_date: datetime,
    end_date: datetime,
    interval_minutes: int = 15,
) -> list[datetime]:
    """
    Generate all timestamps for the date range.

    Only includes hours within buffer zone (6am-10pm).

    Returns:
        Sorted list of datetime objects at the given interval
    """
    timestamps = []
    # Date generation begins at buffer start hour on start_date
    current_date = start_date.replace(
        hour=BUFFER_START_HOUR, minute=0, second=0, microsecond=0
    )

    while current_date <= end_date:
        # Only include hours within buffer zone
        if BUFFER_START_HOUR <= current_date.hour <= BUFFER_END_HOUR:
            timestamps.append(current_date)

        # Advance by interval
        current_date += timedelta(minutes=interval_minutes)

        # If we've passed buffer end hour, jump to next day's buffer start
        if current_date.hour > BUFFER_END_HOUR or (
            current_date.hour == 0 and current_date.minute == 0
        ):
            next_day = current_date.replace(hour=0, minute=0) + timedelta(days=1)
            current_date = next_day.replace(hour=BUFFER_START_HOUR, minute=0)

    return timestamps


def generate_lot_data(
    lot_id: str,
    capacity: int,
    lot_type: Literal["student", "employee"],
    timestamps: list[datetime],
    cfg: SemesterConfig,
    max_records: int = 10000,
) -> list[dict]:
    """
    Generate synthetic data for a single lot.

    Args:
        lot_id: Lot identifier
        capacity: Lot capacity
        lot_type: "student" or "employee"
        timestamps: All possible timestamps
        cfg: Resolved semester configuration
        max_records: Max records per lot. If the semester produces fewer
                     timestamps than this (the typical case), all timestamps
                     are used. Only takes effect for downsampling.

    Returns:
        List of OccupancySnapshot dicts
    """
    lot_popularity = get_lot_popularity_factor(lot_id)

    # Downsample if requested; otherwise use all semester timestamps
    if len(timestamps) > max_records:
        sampled_timestamps = sorted(random.sample(timestamps, max_records))
    else:
        sampled_timestamps = timestamps

    records = []
    for time in sampled_timestamps:
        snapshot = generate_snapshot(
            lot_id, time, capacity, lot_type, lot_popularity, cfg
        )
        records.append(snapshot)

    return records


def generate_all_data(
    lots: list[LotInfo],
    cfg: SemesterConfig | None = None,
    max_per_lot: int = 10000,
) -> pd.DataFrame:
    """
    Generate synthetic data for all lots.

    Args:
        lots: List of LotInfo fetched from PostgreSQL
        cfg: Resolved semester configuration. Defaults to fall-2025
             for backward compatibility.
        max_per_lot: Max records per lot (default 10000). The semester
                     typically produces fewer timestamps (~8,450 for Fall),
                     so all slots are used unless this is set lower.

    Returns:
        DataFrame with all synthetic snapshots
    """
    if cfg is None:
        cfg = resolve_semester("fall-2025")

    student_lots = [lot for lot in lots if lot.lot_type == "STUDENT"]
    employee_lots = [lot for lot in lots if lot.lot_type == "EMPLOYEE"]

    print(f"Generating synthetic data for {len(lots)} lots...")
    print(f"  Student lots: {len(student_lots)}, Employee lots: {len(employee_lots)}")
    print(f"Date range: {cfg.data_start.date()} to {cfg.semester_end.date()}")
    print(f"Max records per lot: {max_per_lot}")

    # Generate all possible timestamps once (according to semester range)
    all_timestamps = generate_timestamps(
        cfg.data_start, cfg.semester_end, SNAPSHOT_INTERVAL_MINUTES
    )
    print(f"Total possible timestamps: {len(all_timestamps)}")

    all_records = []

    # Generate student lot data
    print(f"\nGenerating {len(student_lots)} student lots...")
    for lot in student_lots:
        records = generate_lot_data(
            lot.lot_id, lot.capacity, "student", all_timestamps, cfg, max_per_lot
        )
        all_records.extend(records)
        print(f"  {lot.lot_id}: {len(records)} records (capacity: {lot.capacity})")

    # Generate employee lot data
    print(f"\nGenerating {len(employee_lots)} employee lots...")
    for lot in employee_lots:
        records = generate_lot_data(
            lot.lot_id, lot.capacity, "employee", all_timestamps, cfg, max_per_lot
        )
        all_records.extend(records)
        print(f"  {lot.lot_id}: {len(records)} records (capacity: {lot.capacity})")

    df = pd.DataFrame(all_records)
    print(f"\nTotal records generated: {len(df)}")

    return df


# =============================================================================
# CLI INTERFACE
# =============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Generate synthetic parking occupancy data for SharkPark ML training"
    )
    parser.add_argument(
        "--output",
        "-o",
        default="data/synthetic_occupancy_snapshot.parquet",
        help="Output file path (default: data/synthetic_occupancy_snapshot.parquet)",
    )
    parser.add_argument(
        "--max-records-per-lot",
        "-n",
        type=int,
        default=10000,
        help="Max records per lot — semester typically produces ~8,450; only useful for downsampling (default: 10000)",
    )
    parser.add_argument(
        "--preview",
        type=int,
        metavar="N",
        help="Preview N records per lot type instead of saving",
    )
    parser.add_argument(
        "--semester",
        "-s",
        default="fall-2025",
        help=(
            "Semester to generate data for, as {term}-{year} where year is the "
            "calendar year the term occurs in. "
            "Valid terms: fall, spring. "
            "(default: fall-2025)"
        ),
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )

    args = parser.parse_args()

    # Resolve semester calendar
    cfg = resolve_semester(args.semester)
    print(f"Semester: {args.semester}")

    # Set random seeds for reproducibility
    random.seed(args.seed)
    np.random.seed(args.seed)

    # Fetch lot metadata from Aurora
    print("Fetching lot metadata from Aurora...")
    lots = fetch_lots()
    print(f"Found {len(lots)} lots\n")

    if args.preview:
        # Preview mode: show sample records
        print("=== PREVIEW MODE ===\n")

        all_timestamps = generate_timestamps(
            cfg.data_start, cfg.semester_end, SNAPSHOT_INTERVAL_MINUTES
        )
        sample_ts = random.sample(
            all_timestamps, min(args.preview, len(all_timestamps))
        )

        student_lot = next((lot for lot in lots if lot.lot_type == "STUDENT"), None)
        employee_lot = next((lot for lot in lots if lot.lot_type == "EMPLOYEE"), None)

        if student_lot:
            print(
                f"Student lot sample ({student_lot.lot_id}, capacity {student_lot.capacity}):"
            )
            for ts in sorted(sample_ts)[: args.preview]:
                snapshot = generate_snapshot(
                    student_lot.lot_id, ts, student_lot.capacity, "student", 1.05, cfg
                )
                print(
                    f"  {snapshot['timestamp']}: {snapshot['occupancy_rate']:.2%} "
                    f"({snapshot['occupancy']}/{student_lot.capacity})"
                )

        if employee_lot:
            print(
                f"\nEmployee lot sample ({employee_lot.lot_id}, capacity {employee_lot.capacity}):"
            )
            for ts in sorted(sample_ts)[: args.preview]:
                snapshot = generate_snapshot(
                    employee_lot.lot_id,
                    ts,
                    employee_lot.capacity,
                    "employee",
                    1.02,
                    cfg,
                )
                print(
                    f"  {snapshot['timestamp']}: {snapshot['occupancy_rate']:.2%} "
                    f"({snapshot['occupancy']}/{employee_lot.capacity})"
                )

    else:  # Generation mode: generate and save samples
        df = generate_all_data(lots, cfg, args.max_records_per_lot)

        output = args.output
        if not output.endswith(".parquet"):
            output += ".parquet"

        df.to_parquet(output, index=False)

        print(f"\nSaved to: {output}")

        # Print summary statistics
        print("\n=== SUMMARY STATISTICS ===")
        print(f"Total records: {len(df):,}")
        print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
        print(f"Lots: {df['lot_id'].nunique()}")
        print("\nOccupancy rate distribution:")
        print(df["occupancy_rate"].describe())


if __name__ == "__main__":
    main()
