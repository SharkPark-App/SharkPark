"""
Low-activity session post-processor.

Scales short-term and long-term predictions DOWN when the target date
falls inside a low-activity academic period (winter intersession,
summer/may intersession, or any campus break). The model is trained
mostly on regular fall/spring data; without an explicit cap it will
hallucinate fall-level demand on a January Tuesday.

The scaling is deliberately a hard ceiling rather than a fixed multiplier:
  * ``predicted_occupancy_rate`` is capped at ``LOW_ACTIVITY_CEILING[period]``
  * ``predicted_lower`` is capped at the same value
  * ``predicted_upper`` is capped at the same value
  * Anything below the ceiling is left untouched — if real consensus
    observations push the model above the ceiling, the cap kicks in.

Ceilings come from the published CSULB commuter counts surfaced through
``academic-calendar.ts`` ``COMMUTER_MAP``:

    fall/spring weekday  : ~35k commuters  → no ceiling (1.0)
    summer weekday       : ~8k  commuters  → 0.30
    winter / session     : ~3k  commuters  → 0.10
    closed / break       : ~1.5k commuters → 0.05

Pure functions only — no DB calls, no logging side-effects, so this file
is trivial to unit-test in isolation.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Iterable

import numpy as np

from src.academic_calendar import get_week_of_semester

#: Periods whose predicted occupancy must be capped, with their max
#: allowed ``occupancy_rate``. Periods absent from this map are left
#: untouched (the model's own output wins).
LOW_ACTIVITY_CEILING: dict[str, float] = {
    "winter_session": 0.10,
    "summer_session": 0.30,
    "break": 0.05,
}

#: Reason label written alongside each cap event so downstream observers
#: (admin dashboard, MLflow tags) can audit why predictions were clipped.
REASON_NORMAL: str = "NORMAL"
REASON_PREFIX: str = "LOW_ACTIVITY_CAP:"


def ceiling_for(d: date) -> tuple[float, str]:
    """
    Maximum predicted occupancy rate allowed for a date, plus a reason.

    Returns ``(1.0, "NORMAL")`` for any date the calendar classifies as
    a regular fall/spring period; returns the period-specific ceiling
    plus ``"LOW_ACTIVITY_CAP:<period>"`` otherwise.
    """
    if isinstance(d, datetime):
        d = d.date()
    _, period = get_week_of_semester(d)
    if period in LOW_ACTIVITY_CEILING:
        return LOW_ACTIVITY_CEILING[period], f"{REASON_PREFIX}{period}"
    return 1.0, REASON_NORMAL


def apply_low_activity_scaling(
    median: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    target_dates: Iterable[date],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """
    Cap each prediction at the period-appropriate low-activity ceiling.

    Args:
        median: Model's central estimate (occupancy rate, 0..1).
        lower: 10th-percentile bound from quantile regression.
        upper: 90th-percentile bound from quantile regression.
        target_dates: Per-row date the prediction is for, in school-local
            time. Length must match the prediction arrays.

    Returns:
        ``(adjusted_median, adjusted_lower, adjusted_upper, reasons)``.
        Each output array is the elementwise minimum of the input and
        the per-row ceiling. ``reasons`` is one ``str`` per row, with
        ``"NORMAL"`` for un-capped rows.
    """
    target_dates = list(target_dates)
    n = len(median)
    if not (len(lower) == len(upper) == len(target_dates) == n):
        raise ValueError(
            "low_activity_scaling: median/lower/upper/target_dates length mismatch"
        )

    ceilings = np.empty(n, dtype=float)
    reasons: list[str] = []
    for i, d in enumerate(target_dates):
        cap, reason = ceiling_for(d)
        ceilings[i] = cap
        reasons.append(reason)

    median_out = np.minimum(median.astype(float, copy=False), ceilings)
    lower_out = np.minimum(lower.astype(float, copy=False), ceilings)
    upper_out = np.minimum(upper.astype(float, copy=False), ceilings)

    # Preserve the lower ≤ median ≤ upper invariant after capping.
    lower_out = np.minimum(lower_out, median_out)
    upper_out = np.maximum(upper_out, median_out)

    return median_out, lower_out, upper_out, reasons
