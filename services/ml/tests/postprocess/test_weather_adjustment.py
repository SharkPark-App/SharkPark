"""Unit tests for the rule-based weather adjustment layer."""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd
import pytest

from src.postprocess.weather_adjustment import (
    WeatherSnapshot,
    apply_weather_adjustment,
    classify_severity,
)


def _weather(
    *,
    conditions: str = "clear sky",
    temperature_f: float = 72.0,
    feels_like_f: float = 72.0,
    humidity_percent: float = 50.0,
    wind_speed_mph: float = 5.0,
    precipitation_probability: float = 0.0,
    is_raining: bool = False,
) -> WeatherSnapshot:
    """Build a `WeatherSnapshot` with NORMAL-weather defaults"""
    return WeatherSnapshot(
        timestamp=datetime(2026, 4, 26, 12, 0),
        temperature_f=temperature_f,
        feels_like_f=feels_like_f,
        humidity_percent=humidity_percent,
        wind_speed_mph=wind_speed_mph,
        conditions=conditions,
        precipitation_probability=precipitation_probability,
        is_raining=is_raining,
    )


def _features(target_hours: list[int]) -> pd.DataFrame:
    """Build the inference feature frame `apply_weather_adjustment` consumes."""
    return pd.DataFrame({"target_hour": target_hours})


def _arrays(values: list[float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Build a (median, lower, upper) triple from a list of medians."""
    arr = np.array(values, dtype=float)
    return arr.copy(), (arr - 0.1).clip(0, 1), (arr + 0.1).clip(0, 1)


# ---------------------------------------------------------------------------
# classify_severity
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "conditions,expected",
    [
        ("thunderstorm with heavy rain", "SEVERE"),
        ("tornado warning", "SEVERE"),
        ("squalls", "SEVERE"),
        ("light snow", "SNOW"),
        ("sleet", "SNOW"),
        ("freezing rain", "SNOW"),
        ("clear sky", "NORMAL"),
    ],
)
def test_classify_severity_keyword_branches(conditions, expected):
    assert classify_severity(_weather(conditions=conditions)) == expected


def test_high_wind_triggers_severe():
    weather = _weather(conditions="cloudy", wind_speed_mph=45.0)
    assert classify_severity(weather) == "SEVERE"


def test_severe_takes_priority_over_rain():
    """Thunderstorm + raining should classify as SEVERE, not RAIN."""
    weather = _weather(
        conditions="thunderstorm with rain",
        is_raining=True,
        precipitation_probability=0.9,
    )
    assert classify_severity(weather) == "SEVERE"


def test_heavy_rain_requires_all_three_signals():
    # Has "heavy" in conditions and is raining but low probability
    low_prob = _weather(
        conditions="heavy rain", is_raining=True, precipitation_probability=0.5
    )
    assert classify_severity(low_prob) == "RAIN"

    # High prob and raining but no "heavy" keyword
    no_heavy = _weather(
        conditions="moderate rain", is_raining=True, precipitation_probability=0.85
    )
    assert classify_severity(no_heavy) == "RAIN"

    # All three present (heavy + probability + rain)
    full = _weather(
        conditions="heavy rain", is_raining=True, precipitation_probability=0.85
    )
    assert classify_severity(full) == "HEAVY_RAIN"


def test_extreme_heat_classification():
    weather = _weather(conditions="clear sky", temperature_f=105.0)
    assert classify_severity(weather) == "EXTREME_HEAT"


def test_normal_when_nothing_triggers():
    assert classify_severity(_weather()) == "NORMAL"


# ---------------------------------------------------------------------------
# apply_weather_adjustment
# ---------------------------------------------------------------------------


def test_no_op_when_weather_is_none():
    median, lower, upper = _arrays([0.5, 0.6, 0.7])
    features = _features([8, 12, 17])

    out_med, out_lo, out_hi, reasons = apply_weather_adjustment(
        median, lower, upper, features, weather=None
    )

    np.testing.assert_array_equal(out_med, median)
    np.testing.assert_array_equal(out_lo, lower)
    np.testing.assert_array_equal(out_hi, upper)
    assert reasons == ["NO_WEATHER_DATA"] * 3


def test_normal_weather_is_no_op():
    median, lower, upper = _arrays([0.5, 0.6, 0.7])
    features = _features([8, 12, 17])

    out_med, _, _, reasons = apply_weather_adjustment(
        median, lower, upper, features, _weather()
    )

    np.testing.assert_allclose(out_med, median)
    assert reasons == ["NORMAL", "NORMAL", "NORMAL"]


def test_severe_halves_median_and_widens_lower():
    median, lower, upper = _arrays([0.8, 0.8, 0.8])
    features = _features([8, 12, 17])
    weather = _weather(conditions="thunderstorm")

    out_med, out_lo, _, reasons = apply_weather_adjustment(
        median, lower, upper, features, weather
    )

    np.testing.assert_allclose(out_med, [0.4, 0.4, 0.4])

    # Lower bound should be at most median * 0.7 = 0.28
    assert (out_lo <= 0.28 + 1e-9).all()
    assert reasons == ["SEVERE_REDUCTION"] * 3


def test_snow_applies_seventy_five_percent_multiplier():
    median, lower, upper = _arrays([0.6, 0.6])
    features = _features([8, 14])
    weather = _weather(conditions="light snow")

    out_med, _, _, reasons = apply_weather_adjustment(
        median, lower, upper, features, weather
    )

    np.testing.assert_allclose(out_med, [0.45, 0.45])
    assert reasons == ["SNOW_REDUCTION", "SNOW_REDUCTION"]


def test_rain_commute_bump_only_during_commute_hours():
    """Same rain snapshot, different target hours -> different adjustments."""
    median, lower, upper = _arrays([0.5, 0.5, 0.5, 0.5])
    features = _features([8, 13, 17, 20])  # commute, midday, commute, evening
    weather = _weather(conditions="light rain", is_raining=True)

    out_med, _, _, reasons = apply_weather_adjustment(
        median, lower, upper, features, weather
    )

    # 8am and 5pm -> bump; 1pm and 8pm -> unchanged
    np.testing.assert_allclose(out_med, [0.51, 0.5, 0.51, 0.5])
    assert reasons == [
        "RAIN_COMMUTE_BUMP",
        "NORMAL",
        "RAIN_COMMUTE_BUMP",
        "NORMAL",
    ]


def test_heavy_rain_commute_vs_non_commute():
    median, lower, upper = _arrays([0.5, 0.5])
    features = _features([8, 13])
    weather = _weather(
        conditions="heavy rain", is_raining=True, precipitation_probability=0.85
    )

    out_med, _, _, reasons = apply_weather_adjustment(
        median, lower, upper, features, weather
    )

    np.testing.assert_allclose(out_med, [0.525, 0.485])
    assert reasons == ["HEAVY_RAIN_COMMUTE_BUMP", "HEAVY_RAIN_DAMPEN"]


def test_lower_median_upper_invariant_preserved():
    """After adjustment, lower <= median <= upper must still hold."""
    median, lower, upper = _arrays([0.8, 0.8, 0.8])
    features = _features([8, 12, 17])
    weather = _weather(conditions="thunderstorm")

    out_med, out_lo, out_hi, _ = apply_weather_adjustment(
        median, lower, upper, features, weather
    )

    assert (out_lo <= out_med + 1e-9).all()
    assert (out_med <= out_hi + 1e-9).all()


def test_extreme_heat_currently_no_op():
    """Direction of the heat effect is unverified, so the rule is a no-op."""
    median, lower, upper = _arrays([0.5, 0.5])
    features = _features([8, 14])
    weather = _weather(conditions="clear sky", temperature_f=105.0)

    out_med, _, _, reasons = apply_weather_adjustment(
        median, lower, upper, features, weather
    )

    np.testing.assert_allclose(out_med, [0.5, 0.5])
    assert reasons == ["EXTREME_HEAT", "EXTREME_HEAT"]
