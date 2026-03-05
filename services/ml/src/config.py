"""
SharkPark ML Shared Configuration.

Operating hours, snapshot settings, and database connection.
Academic calendar logic lives in academic_calendar.py.
"""

import os

__all__ = [
    "DATABASE_URL",
    "OPERATING_START_HOUR",
    "OPERATING_END_HOUR",
    "BUFFER_START_HOUR",
    "BUFFER_END_HOUR",
    "SNAPSHOT_INTERVAL_MINUTES",
    "PREDICTION_HOURS",
]

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://sharkpark:sharkpark@localhost:5433/sharkpark",
)

# =============================================================================
# Operating Hours
# =============================================================================

OPERATING_START_HOUR = 7
OPERATING_END_HOUR = 21
BUFFER_START_HOUR = 6
BUFFER_END_HOUR = 22

SNAPSHOT_INTERVAL_MINUTES = 15

PREDICTION_HOURS = list(range(OPERATING_START_HOUR, OPERATING_END_HOUR + 1))  # 7-21
