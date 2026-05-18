"""
Cold-start floor post-processor.

During pre-launch (and any future stretch where contributors stop
reporting), the production short-term model sees only flat-zero
``current_occupancy`` lag features and learns to predict ~0% for the
next hour. Meanwhile the live ``GET /lots/:id`` endpoint applies a
``MIN_FLOOR_RATE = 0.15`` baseline (mirrors
``apps/backend/src/lots/penetration-estimation.service.ts``) so users
see ~15% occupancy on the live tile. The result is a contradictory UI:
"live = 15%, ML forecast for the next bin = 2%".

This module mirrors the backend floor on the ML side so the two
surfaces agree during the cold-start regime. It is **strictly
self-disabling**: callers pass ``is_cold_start=False`` once the input
data shows real device activity, and this function becomes a no-op.

Pure functions only — no DB calls, no logging side-effects, so this
file is trivial to unit-test in isolation.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Iterable

import numpy as np

from src.academic_calendar import get_week_of_semester
from src.config import OPERATING_END_HOUR, OPERATING_START_HOUR

#: Mirrors ``MIN_FLOOR_RATE`` in
#: ``apps/backend/src/lots/penetration-estimation.service.ts``. Any change
#: here MUST be made in lockstep with the backend constant or the live
#: tile and the ML forecast will visibly disagree again.
MIN_FLOOR_RATE: float = 0.15

#: Mirrors ``LOW_ACTIVITY_FLOOR_RATE`` in the same backend service.
#: Applied during low-activity academic periods so the cold-start floor
#: doesn't fight the low-activity ceiling.
LOW_ACTIVITY_FLOOR_RATE: float = 0.05

#: Periods that get the lower floor (must stay in sync with
#: ``low_activity_scaling.LOW_ACTIVITY_CEILING``).
LOW_ACTIVITY_PERIODS: frozenset[str] = frozenset(
    {"winter_session", "summer_session", "break"}
)

REASON_NORMAL: str = "NORMAL"
REASON_FLOOR: str = "COLD_START_FLOOR"


def is_cold_start_window(snapshots: object) -> bool:
    """
    Decide whether the recent snapshot window represents a cold-start regime.

    Returns True iff every snapshot row in the window is flagged
    ``is_cold_start = True`` (meaning no real device pings backed the
    occupancy estimate). The decision is intentionally strict: a single
    real-device row in the lookback window flips us back to the model's
    own output.

    Accepts a pandas DataFrame; defined with ``object`` to avoid forcing
    a top-level pandas import in this otherwise pure module.
    """
    # Local import keeps this module free of pandas at import time and
    # makes the test suite trivially mockable.
    import pandas as pd

    if not isinstance(snapshots, pd.DataFrame) or snapshots.empty:
        # No data → can't infer activity; default to cold-start so the
        # floor still protects the UI.
        return True
    if "is_cold_start" not in snapshots.columns:
        # Older fixture without the column — be conservative and assume
        # cold-start so we don't silently regress the floor.
        return True
    return bool(snapshots["is_cold_start"].fillna(True).all())


def _floor_for(d: date, hour: int) -> tuple[float, str]:
    """
    Per-row floor (rate, reason) for a (date, hour) cell.

    No floor outside operating hours (lots really are empty at 3am).
    Reduced floor during low-activity sessions so we don't contradict
    the low-activity ceiling.
    """
    if isinstance(d, datetime):
        d = d.date()
    if not (OPERATING_START_HOUR <= int(hour) <= OPERATING_END_HOUR):
        return 0.0, REASON_NORMAL
    _, period = get_week_of_semester(d)
    if period in LOW_ACTIVITY_PERIODS:
        return LOW_ACTIVITY_FLOOR_RATE, REASON_FLOOR
    return MIN_FLOOR_RATE, REASON_FLOOR


def apply_cold_start_floor(
    median: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    target_dates: Iterable[date],
    target_hours: Iterable[int],
    *,
    is_cold_start: bool,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """
    Floor each prediction at the campus-open baseline when in cold-start.

    Args:
        median: Model's central estimate (occupancy rate, 0..1).
        lower: 10th-percentile bound from quantile regression.
        upper: 90th-percentile bound from quantile regression.
        target_dates: Per-row date in school-local time.
        target_hours: Per-row hour-of-day (0..23) in school-local time.
        is_cold_start: True iff the input snapshots indicate no real
            contributor activity. When False this function is a no-op.

    Returns:
        ``(median, lower, upper, reasons)``. ``reasons`` is one ``str``
        per row, ``"COLD_START_FLOOR"`` for floored rows and
        ``"NORMAL"`` otherwise.
    """
    n = len(median)
    if not is_cold_start:
        return (median, lower, upper, [REASON_NORMAL] * n)

    target_dates = list(target_dates)
    target_hours = list(target_hours)
    if not (
        len(lower) == len(upper) == len(target_dates) == len(target_hours) == n
    ):
        raise ValueError(
            "cold_start_floor: median/lower/upper/target_dates/target_hours length mismatch"
        )

    floors = np.empty(n, dtype=float)
    reasons: list[str] = []
    for i, (d, h) in enumerate(zip(target_dates, target_hours)):
        floor_rate, reason = _floor_for(d, int(h))
        floors[i] = floor_rate
        reasons.append(reason)

    median_out = np.maximum(median.astype(float, copy=False), floors)
    lower_out = np.maximum(lower.astype(float, copy=False), floors)
    upper_out = np.maximum(upper.astype(float, copy=False), floors)

    # Preserve lower ≤ median ≤ upper invariant after flooring.
    lower_out = np.minimum(lower_out, median_out)
    upper_out = np.maximum(upper_out, median_out)

    return median_out, lower_out, upper_out, reasons
