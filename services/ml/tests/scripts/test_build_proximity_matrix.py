"""Unit tests for build_proximity_matrix (D3 — lot × building matrix)."""

from __future__ import annotations

import math

import pytest

from scripts.build_proximity_matrix import (
    EARTH_RADIUS_M,
    MAX_DISTANCE_M,
    WEIGHT_DECAY_SCALE_M,
    BuildingPoint,
    LotPoint,
    build_matrix,
    haversine_meters,
    proximity_weight,
)


# ─── haversine ────────────────────────────────────────────────────────


def test_haversine_zero_for_same_point():
    assert haversine_meters(33.7838, -118.1141, 33.7838, -118.1141) == 0.0


def test_haversine_one_degree_latitude_is_about_111km():
    # 1° latitude ≈ π * R / 180 meters everywhere on Earth.
    expected = math.pi * EARTH_RADIUS_M / 180.0
    got = haversine_meters(0.0, 0.0, 1.0, 0.0)
    assert got == pytest.approx(expected, rel=1e-9)


def test_haversine_short_campus_distance():
    # Two CSULB-area centroids ~280 m apart (manually verified via
    # Google Maps measure tool to within 5 m). Sanity-checks the
    # formula with realistic small-distance inputs where rounding
    # behavior matters.
    d = haversine_meters(33.78380, -118.11410, 33.78130, -118.11410)
    # 0.0025° latitude ≈ 0.0025 * 111_195 ≈ 277.99 m
    assert d == pytest.approx(277.99, abs=1.0)


def test_haversine_symmetric():
    a = haversine_meters(33.78, -118.11, 33.79, -118.12)
    b = haversine_meters(33.79, -118.12, 33.78, -118.11)
    assert a == pytest.approx(b, rel=1e-12)


# ─── weight curve ─────────────────────────────────────────────────────


def test_proximity_weight_at_zero_is_one():
    assert proximity_weight(0.0) == 1.0


def test_proximity_weight_at_decay_scale_is_e_inverse():
    # By construction: w(SCALE) = exp(-1) ≈ 0.36788
    assert proximity_weight(WEIGHT_DECAY_SCALE_M) == pytest.approx(
        math.exp(-1), rel=1e-12
    )


def test_proximity_weight_at_max_distance_is_e_minus_two():
    # MAX_DISTANCE_M / SCALE = 2 → exp(-2) ≈ 0.1353
    assert proximity_weight(MAX_DISTANCE_M) == pytest.approx(
        math.exp(-2), rel=1e-12
    )


def test_proximity_weight_monotone_decreasing():
    samples = [0.0, 50.0, 100.0, 250.0, 400.0, 500.0]
    weights = [proximity_weight(d) for d in samples]
    for a, b in zip(weights, weights[1:]):
        assert a > b


# ─── build_matrix ─────────────────────────────────────────────────────


def _lot(id_: str, lat: float, lng: float) -> LotPoint:
    return LotPoint(id=id_, lat=lat, lng=lng)


def _bld(id_: str, lat: float, lng: float) -> BuildingPoint:
    return BuildingPoint(id=id_, lat=lat, lng=lng)


def test_build_matrix_empty_inputs():
    assert build_matrix([], []) == []
    assert build_matrix([_lot("L1", 33.78, -118.11)], []) == []
    assert build_matrix([], [_bld("B1", 33.78, -118.11)]) == []


def test_build_matrix_filters_above_cap():
    # Lot at origin; one building 50 m away (kept) and one 1.5 km away (dropped).
    lots = [_lot("L1", 0.0, 0.0)]
    buildings = [
        _bld("B_close", 0.000_45, 0.0),     # ~50 m
        _bld("B_far", 0.013_5, 0.0),        # ~1500 m
    ]
    rows = build_matrix(lots, buildings)
    assert [r.building_id for r in rows] == ["B_close"]
    assert rows[0].distance_m < MAX_DISTANCE_M
    assert rows[0].weight == pytest.approx(
        proximity_weight(rows[0].distance_m), rel=1e-12
    )


def test_build_matrix_emits_full_cartesian_when_all_close():
    lots = [_lot("L1", 0.0, 0.0), _lot("L2", 0.000_3, 0.0)]
    buildings = [
        _bld("B1", 0.000_1, 0.0),
        _bld("B2", 0.000_2, 0.0),
    ]
    rows = build_matrix(lots, buildings)
    assert len(rows) == 4
    assert {(r.lot_id, r.building_id) for r in rows} == {
        ("L1", "B1"), ("L1", "B2"), ("L2", "B1"), ("L2", "B2"),
    }


def test_build_matrix_sorted_deterministic():
    lots = [_lot("L_b", 0.0, 0.0), _lot("L_a", 0.000_3, 0.0)]
    buildings = [_bld("B_z", 0.000_1, 0.0), _bld("B_a", 0.000_2, 0.0)]
    rows = build_matrix(lots, buildings)
    keys = [(r.lot_id, r.building_id) for r in rows]
    assert keys == sorted(keys)


def test_build_matrix_zero_distance_kept_with_weight_one():
    # Lot and building at identical coords (e.g. structure-attached lot).
    lots = [_lot("L1", 33.78, -118.11)]
    buildings = [_bld("B1", 33.78, -118.11)]
    rows = build_matrix(lots, buildings)
    assert len(rows) == 1
    assert rows[0].distance_m == 0.0
    assert rows[0].weight == 1.0
