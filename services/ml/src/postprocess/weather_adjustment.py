"""
Rule-based weather adjustment for short-term occupancy predictions.

A deterministic post-processing layer that reads the latest weather observation
and adjusts model predictions during severe conditions. Coefficients are
documented placeholders, not measured — pre-launch occupancy is synthetic, so
any learned weather effect would memorize fabricated correlations.

This layer ships meaningful weather-awareness now and remains as a permanent safety
floor even after a learned weather model eventually integrates, because rare severe
events are systematically under-sampled by ERM training.

Severity is derived from the existing `weather` table fields (no schema
migration). See `Model_Design.md` for the classification table and adjustment
rules. Magnitudes are intentionally conservative and should be calibrated
post-launch against real (weather, occupancy) data.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

__all__ = [
    "WeatherSnapshot",
    "Severity",
    "classify_severity",
    "classify_severity_from_fields",
    "apply_weather_adjustment",
    "apply_weather_adjustment_long_term",
]


Severity = Literal[
    "NORMAL",
    "RAIN",
    "HEAVY_RAIN",
    "SNOW",
    "EXTREME_HEAT",
    "SEVERE",
    "NO_WEATHER_DATA",
]


@dataclass(frozen=True)
class WeatherSnapshot:
    """A single weather observation row.

    Mirrors the subset of `weather` table columns used by the adjustment layer -
    update this dataclass when those columns are added, renamed, or removed.
    """

    timestamp: datetime
    temperature_f: float
    feels_like_f: float
    humidity_percent: float
    wind_speed_mph: float
    conditions: str
    precipitation_probability: float
    is_raining: bool


# Commute-hour windows used to gate the rain bump rule.
# TODO(post-launch): validate these hours against real arrival/departure data;
# current values are a hand-picked heuristic, not derived.
_COMMUTE_HOURS = (7, 8, 9, 16, 17, 18)

# Keywords matched against the lower-cased NWS `shortForecast` text written
# by the backend's WeatherFetchService (e.g. "heavy rain", "scattered
# thunderstorms", "freezing rain likely"). Freezing rain is bucketed as snow
# because its impact on driver behavior matches snow more than rain.
_SEVERE_KEYWORDS = ("thunderstorm", "tornado", "squall")
_SNOW_KEYWORDS = ("snow", "sleet", "freezing rain")
_HEAVY_KEYWORD = "heavy"

# Thresholds for severity classification.
_SEVERE_WIND_MPH = 40.0
_HEAVY_RAIN_PROB = 0.7
_EXTREME_HEAT_F = 100.0


def classify_severity_from_fields(
    *,
    temperature_f: float | None,
    wind_speed_mph: float | None,
    conditions: str | None,
    is_raining: bool | None,
    precipitation_probability: float | None,
) -> Severity:
    """Field-level severity classifier shared by `classify_severity` and the
    feature pipeline (which derives `weather_severity` per snapshot row).

    Returns ``"NO_WEATHER_DATA"`` if any required input is None / NaN so callers
    can distinguish "no data" from "NORMAL data" without surprise NaN math.
    """
    import math

    def _missing(v) -> bool:
        if v is None:
            return True
        if isinstance(v, float) and math.isnan(v):
            return True
        return False

    if any(
        _missing(v)
        for v in (
            temperature_f,
            wind_speed_mph,
            conditions,
            is_raining,
            precipitation_probability,
        )
    ):
        return "NO_WEATHER_DATA"

    cond = (conditions or "").lower()
    if any(kw in cond for kw in _SEVERE_KEYWORDS):
        return "SEVERE"
    if float(wind_speed_mph) > _SEVERE_WIND_MPH:
        return "SEVERE"
    if any(kw in cond for kw in _SNOW_KEYWORDS):
        return "SNOW"
    if (
        bool(is_raining)
        and float(precipitation_probability) > _HEAVY_RAIN_PROB
        and _HEAVY_KEYWORD in cond
    ):
        return "HEAVY_RAIN"
    if bool(is_raining):
        return "RAIN"
    if float(temperature_f) > _EXTREME_HEAT_F:
        return "EXTREME_HEAT"
    return "NORMAL"


def classify_severity(weather: WeatherSnapshot) -> Severity:
    """Classify a weather snapshot into a discrete severity bucket.

    Order matters — checks run from most-severe to least-severe so that
    a thunderstorm with rain classifies as SEVERE, not RAIN.
    """
    return classify_severity_from_fields(
        temperature_f=weather.temperature_f,
        wind_speed_mph=weather.wind_speed_mph,
        conditions=weather.conditions,
        is_raining=weather.is_raining,
        precipitation_probability=weather.precipitation_probability,
    )


def _cells_for(severity: Severity):
    """Return (commute_cell, non_commute_cell) for a severity.

    Each cell is (median_multiplier, lower_floor_factor, reason_label).
    Severities not handled fall through to a no-op with the severity itself
    as the reason (NORMAL, EXTREME_HEAT, NO_WEATHER_DATA).

    Median multipliers and lower-floor factors are rough-tuned so the displayed
    band visibly widens during bad weather. Recalibrate post-launch against
    real (weather, occupancy) data.
    """
    # As of E4, RAIN and HEAVY_RAIN are no-ops here — the short-term model
    # ingests `temperature_f`, `precipitation_probability`, `wind_speed_mph`,
    # `is_raining` directly and learns rain effects from data. This adjustment
    # layer is now a *safety clamp* for severe / extreme conditions that ERM
    # training systematically under-samples (thunderstorms, snow, > 100°F).
    if severity == "SEVERE":
        return (0.50, 0.70, "SEVERE_REDUCTION"), (0.50, 0.70, "SEVERE_REDUCTION")
    if severity == "SNOW":
        return (0.75, 0.85, "SNOW_REDUCTION"), (0.75, 0.85, "SNOW_REDUCTION")
    if severity == "EXTREME_HEAT":
        return (0.90, 0.85, "EXTREME_HEAT_DAMPEN"), (0.90, 0.85, "EXTREME_HEAT_DAMPEN")
    # NORMAL, RAIN, HEAVY_RAIN, NO_WEATHER_DATA — model handles these.
    return (1.0, 1.0, severity), (1.0, 1.0, severity)


def apply_weather_adjustment(
    median: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    features: pd.DataFrame,
    weather: WeatherSnapshot | None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Apply the rule-based weather adjustment to short-term predictions.

    Args:
        median: Predicted occupancy rates (0-1) from the model.
        lower: 10th-percentile bounds from quantile regression.
        upper: 90th-percentile bounds from quantile regression.
        features: Inference feature DataFrame; must include `target_hour`.
        weather: Latest weather observation, or None if unavailable.

    Returns:
        (adjusted_median, adjusted_lower, adjusted_upper, reasons) where
        `reasons` is a per-row audit label list aligned to the input arrays.
        All output arrays are clipped to [0, 1].
    """
    assert "target_hour" in features.columns, "features must include 'target_hour'"

    n = len(median)
    if weather is None:
        return median, lower, upper, ["NO_WEATHER_DATA"] * n

    severity = classify_severity(weather)
    target_hours = features["target_hour"].astype(int).to_numpy()
    median_out = median.astype(float).copy()
    lower_out = lower.astype(float).copy()
    upper_out = upper.astype(float).copy()

    is_commute = np.isin(target_hours, _COMMUTE_HOURS)

    # Compute commute and offpeak multipliers
    commute_cell, offpeak_cell = _cells_for(severity)
    commute_mult, commute_floor, commute_reason = commute_cell
    offpeak_mult, offpeak_floor, offpeak_reason = offpeak_cell

    # Apply multipliers on median and floor-mask (one-sided humility, refer to model_design)
    median_mults = np.where(is_commute, commute_mult, offpeak_mult)
    median_out *= median_mults

    lower_factors = np.where(is_commute, commute_floor, offpeak_floor)
    floor_mask = lower_factors < 1.0
    if floor_mask.any():
        candidate = median_out * lower_factors
        lower_out = np.where(floor_mask, np.minimum(lower_out, candidate), lower_out)

    # Post-process outputs
    reasons: list[str] = [commute_reason if c else offpeak_reason for c in is_commute]

    median_out = np.clip(median_out, 0.0, 1.0)
    lower_out = np.clip(lower_out, 0.0, 1.0)
    upper_out = np.clip(upper_out, 0.0, 1.0)

    lower_out = np.minimum(lower_out, median_out)
    upper_out = np.maximum(upper_out, median_out)

    return median_out, lower_out, upper_out, reasons


def apply_weather_adjustment_long_term(
    median: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    target_dates,
    target_hours,
    forecast_grid: dict,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Per-row weather adjustment for long-term predictions.

    Long-term inference spans up to 7 days, so each prediction row has its
    own ``(target_date, target_hour)`` slot. This function looks up each
    row in ``forecast_grid`` (the output of
    :func:`src.data.db.fetch_long_term_weather_forecast`), classifies the
    severity for that hour, and applies the same SEVERE / SNOW /
    EXTREME_HEAT clamps as :func:`apply_weather_adjustment`.

    Rows with no matching forecast row are tagged ``"NO_WEATHER_DATA"`` and
    pass through unchanged \u2014 this matches the short-term contract where a
    missing observation is treated as a no-op rather than an error.

    Args:
        median: Predicted occupancy rates (0-1) from the model.
        lower: 10th-percentile bounds from quantile regression.
        upper: 90th-percentile bounds from quantile regression.
        target_dates: Per-row target date (length matches arrays).
        target_hours: Per-row target hour (0-23, length matches arrays).
        forecast_grid: ``(date, hour) -> forecast`` map. Empty dict means
            no forecast data available, function returns inputs unchanged
            with a single ``NO_WEATHER_DATA`` reason per row.

    Returns:
        ``(adjusted_median, adjusted_lower, adjusted_upper, reasons)``.
        Output arrays are clipped to [0, 1] and preserve the
        ``lower \u2264 median \u2264 upper`` invariant.
    """
    n = len(median)
    target_dates = list(target_dates)
    target_hours = list(target_hours)
    if not (len(lower) == len(upper) == len(target_dates) == len(target_hours) == n):
        raise ValueError(
            "apply_weather_adjustment_long_term: array length mismatch"
        )

    if not forecast_grid:
        return median, lower, upper, ["NO_WEATHER_DATA"] * n

    median_out = median.astype(float).copy()
    lower_out = lower.astype(float).copy()
    upper_out = upper.astype(float).copy()
    reasons: list[str] = []

    for i in range(n):
        hour = int(target_hours[i])
        # ``target_dates[i]`` may be a ``date``, ``datetime``, ``pd.Timestamp``,
        # or numpy datetime64 \u2014 normalize to ``date`` for grid lookup.
        d = target_dates[i]
        if isinstance(d, datetime):
            d = d.date()
        elif hasattr(d, "to_pydatetime"):
            d = d.to_pydatetime().date()
        elif not isinstance(d, date):
            d = pd.Timestamp(d).date()

        forecast = forecast_grid.get((d, hour))
        if forecast is None:
            reasons.append("NO_WEATHER_DATA")
            continue

        severity: Severity = forecast.get("weather_severity") or "NORMAL"
        commute_cell, offpeak_cell = _cells_for(severity)
        is_commute = hour in _COMMUTE_HOURS
        mult, floor_factor, reason = commute_cell if is_commute else offpeak_cell

        if mult != 1.0:
            median_out[i] *= mult
        if floor_factor < 1.0:
            candidate = median_out[i] * floor_factor
            lower_out[i] = min(lower_out[i], candidate)
        reasons.append(reason)

    median_out = np.clip(median_out, 0.0, 1.0)
    lower_out = np.clip(lower_out, 0.0, 1.0)
    upper_out = np.clip(upper_out, 0.0, 1.0)
    lower_out = np.minimum(lower_out, median_out)
    upper_out = np.maximum(upper_out, median_out)

    return median_out, lower_out, upper_out, reasons
