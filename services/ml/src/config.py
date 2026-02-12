"""
SharkPark ML Shared Configuration.

Semester dates, campus closures, and operating hours used by both
the synthetic data generator and the feature engineering pipeline.

To configure for a new semester:
    1. Update SEMESTER_START/END and DATA_START
    2. Update key dates (FIRST_DAY_OF_CLASSES, FINALS_START, etc.)
    3. Update CAMPUS_CLOSURES and NO_CLASSES_CAMPUS_OPEN
"""

from datetime import datetime


# =============================================================================
# Semester Bounds
# =============================================================================

SEMESTER_START = datetime(2025, 8, 18)
SEMESTER_END = datetime(2025, 12, 24)
DATA_START = datetime(2025, 8, 17)  # Day before semester for buffer

# =============================================================================
# Key Academic Dates (Fall 2025)
# =============================================================================

FIRST_DAY_OF_CLASSES = datetime(2025, 8, 25)  # Aug 18-22 is orientation/dept meetings
LAST_DAY_OF_CLASSES = datetime(2025, 12, 10)
FINALS_START = datetime(2025, 12, 12)
FINALS_END = datetime(2025, 12, 18)

# =============================================================================
# Campus Closures (no activity — campus closed)
# =============================================================================

CAMPUS_CLOSURES = [
    datetime(2025, 9, 1),   # Labor Day
    datetime(2025, 11, 11), # Veterans Day
    # Thanksgiving Holiday (campus closed)
    datetime(2025, 11, 27),
    datetime(2025, 11, 28),
    datetime(2025, 11, 29),
    datetime(2025, 11, 30),
]

# =============================================================================
# No-Classes Days (campus open, reduced student activity)
# =============================================================================

NO_CLASSES_CAMPUS_OPEN = [
    # Fall Break (no classes, campus open)
    datetime(2025, 11, 24),
    datetime(2025, 11, 25),
    datetime(2025, 11, 26),
    # Reading Day
    datetime(2025, 12, 11),
]

# =============================================================================
# Operating Hours
# =============================================================================

OPERATING_START_HOUR = 7
OPERATING_END_HOUR = 21
BUFFER_START_HOUR = 6
BUFFER_END_HOUR = 22

SNAPSHOT_INTERVAL_MINUTES = 15

PREDICTION_HOURS = list(range(OPERATING_START_HOUR, OPERATING_END_HOUR + 1))  # 7-21
