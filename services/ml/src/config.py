"""
SharkPark ML Shared Configuration.

Operating hours, snapshot settings, and database connection.
Academic calendar logic lives in academic_calendar.py.
"""

import os

from dotenv import load_dotenv

load_dotenv()

__all__ = [
    "DATABASE_URL",
    "SHORT_TERM_MODEL_NAME",
    "LONG_TERM_MODEL_NAME",
    "LONG_TERM_HORIZON_DAYS",
    "LONG_TERM_BASELINE_WEEKS",
    "OPERATING_START_HOUR",
    "OPERATING_END_HOUR",
    "BUFFER_START_HOUR",
    "BUFFER_END_HOUR",
    "SNAPSHOT_INTERVAL_MINUTES",
    "PREDICTION_HOURS",
    "COLD_START_CI_MULTIPLIER",
    "WEATHER_ADJUSTMENT_ENABLED",
    "WEATHER_MAX_AGE_HOURS",
]

SHORT_TERM_MODEL_NAME = "short-term-production"
LONG_TERM_MODEL_NAME = "long-term-production"

# =============================================================================
# Long-Term Model Settings
# =============================================================================

LONG_TERM_HORIZON_DAYS = 7  # forecast window
LONG_TERM_BASELINE_WEEKS = 4  # rolling average window for Stage 1 baseline

DATABASE_URL = os.environ.get("DATABASE_URL")

# =============================================================================
# Operating Hours
# =============================================================================

OPERATING_START_HOUR = 7
OPERATING_END_HOUR = 21
BUFFER_START_HOUR = 6
BUFFER_END_HOUR = 22

SNAPSHOT_INTERVAL_MINUTES = 15

PREDICTION_HOURS = list(range(OPERATING_START_HOUR, OPERATING_END_HOUR + 1))  # 7-21

# Multiplier applied to confidence interval spread for cold-start lots
COLD_START_CI_MULTIPLIER = 1.5

# =============================================================================
# Weather Adjustment Layer
# =============================================================================

# Kill-switch for the rule-based weather adjustment in short-term predictions.
# Set WEATHER_ADJUSTMENT_ENABLED=false in the environment (e.g. Fly secret) to
# disable the post-processing layer without a code change. Defaults to enabled.
# Unrecognized values raise on import so a typo'd secret fails loudly.
_weather_flag_raw = os.environ.get("WEATHER_ADJUSTMENT_ENABLED", "true").strip().lower()
if _weather_flag_raw not in ("true", "false", "1", "0", "yes", "no"):
    raise ValueError(
        f"Invalid WEATHER_ADJUSTMENT_ENABLED={_weather_flag_raw!r}; "
        "expected one of true/false/1/0/yes/no (case-insensitive)."
    )
WEATHER_ADJUSTMENT_ENABLED = _weather_flag_raw in ("true", "1", "yes")


# Max age (in hours) for the latest weather row before it's treated as stale and the
# adjustment falls back to NO_WEATHER_DATA. Set to 0 to disable the staleness check entirely.
_weather_max_age_raw = os.environ.get("WEATHER_MAX_AGE_HOURS", "3").strip()
try:
    WEATHER_MAX_AGE_HOURS = float(_weather_max_age_raw)
except ValueError as _exc:
    raise ValueError(
        f"Invalid WEATHER_MAX_AGE_HOURS={_weather_max_age_raw!r}; expected a number."
    ) from _exc

if WEATHER_MAX_AGE_HOURS < 0:
    raise ValueError(
        f"WEATHER_MAX_AGE_HOURS must be >= 0, got {WEATHER_MAX_AGE_HOURS}."
    )
