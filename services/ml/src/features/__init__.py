"""
SharkPark ML Feature Engineering.

Modules:
- base: Shared utilities (time encoding, validation)
- short_term: State-transition features (lags, momentum)
- long_term: Two-stage hybrid features (historical baseline + XGBoost adjustment)
"""

from .base import (
    encode_cyclical,
    add_hour_encoding,
    add_day_encoding,
    extract_time_components,
    bucket_hour,
    add_time_bucket,
    bucket_occupancy_rate,
    add_activity_level,
    validate_snapshot_data,
    prepare_base_features,
)

from .short_term import (
    compute_lag_features,
    prepare_training_features as prepare_short_term_training_features,
    prepare_inference_features as prepare_short_term_inference_features,
)

from src.academic_calendar import (
    ACADEMIC_CALENDARS,
    get_week_of_semester,
    is_class_day,
    get_semester_progress,
    get_academic_period,
    is_campus_open,
)

__all__ = [
    # Base
    "encode_cyclical",
    "add_hour_encoding",
    "add_day_encoding",
    "extract_time_components",
    "bucket_hour",
    "add_time_bucket",
    "bucket_occupancy_rate",
    "add_activity_level",
    "validate_snapshot_data",
    "prepare_base_features",
    # Short-term
    "compute_lag_features",
    "prepare_short_term_training_features",
    "prepare_short_term_inference_features",
    # Academic calendar
    "ACADEMIC_CALENDARS",
    "get_week_of_semester",
    "is_class_day",
    "get_semester_progress",
    "get_academic_period",
    "is_campus_open",
]
