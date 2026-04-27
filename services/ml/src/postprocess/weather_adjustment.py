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
from datetime import datetime
from typing import Literal

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

__all__ = [
    "WeatherSnapshot",
    "Severity",
    "classify_severity",
    "apply_weather_adjustment",
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

# Keywords matched against OWM's text.
# "freezing rain" (OWM id 511, Rain group) is bucketed as snow.
_SEVERE_KEYWORDS = ("thunderstorm", "tornado", "squall")
_SNOW_KEYWORDS = ("snow", "sleet", "freezing rain")
_HEAVY_KEYWORD = "heavy"

# Thresholds for severity classification.
_SEVERE_WIND_MPH = 40.0
_HEAVY_RAIN_PROB = 0.7
_EXTREME_HEAT_F = 100.0


def classify_severity(weather: WeatherSnapshot) -> Severity:
    """Classify a weather snapshot into a discrete severity bucket.

    Order matters — checks run from most-severe to least-severe so that
    a thunderstorm with rain classifies as SEVERE, not RAIN.
    """
    conditions = (weather.conditions or "").lower()

    if any(kw in conditions for kw in _SEVERE_KEYWORDS):
        return "SEVERE"
    if weather.wind_speed_mph > _SEVERE_WIND_MPH:
        return "SEVERE"
    if any(kw in conditions for kw in _SNOW_KEYWORDS):
        return "SNOW"
    if (
        weather.is_raining
        and weather.precipitation_probability > _HEAVY_RAIN_PROB
        and _HEAVY_KEYWORD in conditions
    ):
        return "HEAVY_RAIN"
    if weather.is_raining:
        return "RAIN"
    if weather.temperature_f > _EXTREME_HEAT_F:
        return "EXTREME_HEAT"
    return "NORMAL"


def _cells_for(severity: Severity):
    """Return (commute_cell, non_commute_cell) for a severity.

    Each cell is (median_multiplier, lower_floor_factor, reason_label).
    Severities not handled fall through to a no-op with the severity itself
    as the reason (NORMAL, EXTREME_HEAT, NO_WEATHER_DATA).
    """
    if severity == "SEVERE":
        return (0.50, 0.70, "SEVERE_REDUCTION"), (0.50, 0.70, "SEVERE_REDUCTION")
    if severity == "SNOW":
        return (0.75, 0.85, "SNOW_REDUCTION"), (0.75, 0.85, "SNOW_REDUCTION")
    if severity == "HEAVY_RAIN":
        return (1.05, 1.0, "HEAVY_RAIN_COMMUTE_BUMP"), (0.97, 1.0, "HEAVY_RAIN_DAMPEN")
    if severity == "RAIN":
        return (1.02, 1.0, "RAIN_COMMUTE_BUMP"), (1.0, 1.0, "NORMAL")
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
