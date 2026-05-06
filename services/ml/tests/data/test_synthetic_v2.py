"""
Tests for the catalog-driven synthetic generator (src.data.synthetic_v2).

All tests are pure-function: they exercise the deterministic samplers
(`compute_arrivals`, `compute_departures`, `select_lot_probs`,
`attendees_for_meeting`, `walk_minutes`, `calendar_multiplier`) plus
the orchestration class with a stubbed psycopg2 connection. No live DB.

Run from services/ml/:
    python -m pytest tests/data/test_synthetic_v2.py -v
"""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timezone
from unittest.mock import MagicMock

import numpy as np
import pytest

from src.data import synthetic_v2 as sv2
from src.data.synthetic_v2 import (
    ARRIVAL_BUCKETS,
    CALENDAR_MULT,
    DEPARTURE_BUCKETS,
    LOT_SOFTMAX_BETA,
    SyntheticV2Generator,
    _DAY_BITS,
    _sample_bucket_offsets,
    attendees_for_meeting,
    calendar_multiplier,
    compute_arrivals,
    compute_departures,
    select_lot_probs,
    walk_minutes,
)


# ---------------------------------------------------------------------------
# Constants & sanity
# ---------------------------------------------------------------------------


def test_arrival_bucket_probs_sum_to_one():
    assert math.isclose(sum(p for _, _, p in ARRIVAL_BUCKETS), 1.0, abs_tol=1e-9)


def test_departure_bucket_probs_sum_to_one():
    assert math.isclose(sum(p for _, _, p in DEPARTURE_BUCKETS), 1.0, abs_tol=1e-9)


def test_calendar_mult_break_is_zero():
    # 4th of July 2025 — guaranteed break / closed.
    assert calendar_multiplier(date(2025, 7, 4)) == 0.0


def test_calendar_mult_table_entries():
    assert CALENDAR_MULT["finals"] == 0.6
    assert CALENDAR_MULT["dead_week"] == 0.8
    assert CALENDAR_MULT["regular"] == 1.0
    assert CALENDAR_MULT["break"] == 0.0
    # Low-activity sessions: ~3k/8k commuters vs 35k baseline.
    assert CALENDAR_MULT["winter_session"] == 0.10
    assert CALENDAR_MULT["summer_session"] == 0.30


# ---------------------------------------------------------------------------
# walk_minutes
# ---------------------------------------------------------------------------


def test_walk_minutes_basic():
    # 80 m/min default → 200 m walk = 2.5 min.
    assert walk_minutes(200) == pytest.approx(2.5)


def test_walk_minutes_custom_speed():
    assert walk_minutes(160, speed_m_per_min=80) == pytest.approx(2.0)


def test_walk_minutes_rejects_zero_speed():
    with pytest.raises(ValueError):
        walk_minutes(100, speed_m_per_min=0)


# ---------------------------------------------------------------------------
# attendees_for_meeting
# ---------------------------------------------------------------------------


def test_attendees_zero_when_break():
    rng = random.Random(0)
    assert attendees_for_meeting(enrollment=100, calendar_mult=0.0, rng=rng) == 0


def test_attendees_zero_when_no_enrollment():
    rng = random.Random(0)
    assert attendees_for_meeting(enrollment=0, calendar_mult=1.0, rng=rng) == 0


def test_attendees_within_bounds():
    rng = random.Random(0)
    # No noise → expected = 100 * 0.80 * 0.85 * 0.80 * 1.0 = 54.4 ≈ 54.
    n = attendees_for_meeting(
        enrollment=100, calendar_mult=1.0, rng=rng, noise_frac=0.0
    )
    assert n == 54


def test_attendees_clipped_to_enrollment():
    rng = random.Random(0)
    # Force massive noise to push above enrollment; result must clip.
    n = attendees_for_meeting(
        enrollment=10, calendar_mult=1.0, rng=rng, noise_frac=10.0
    )
    assert 0 <= n <= 10


# ---------------------------------------------------------------------------
# compute_arrivals / compute_departures
# ---------------------------------------------------------------------------


def test_compute_arrivals_returns_one_per_attendee():
    arrivals = compute_arrivals(class_start_minute=600, attendees=50, rng=random.Random(7))
    assert len(arrivals) == 50


def test_compute_arrivals_majority_pre_class():
    # Spec: 95% of arrivals are pre-class (T-30..T).
    arrivals = compute_arrivals(class_start_minute=600, attendees=2000, rng=random.Random(11))
    pre = sum(1 for m in arrivals if m < 600)
    # 95% target ± 3% sampling slack at n=2000.
    assert pre / len(arrivals) > 0.92


def test_compute_arrivals_clips_to_day():
    # Class at midnight: negative offsets must clip to 0, never negative.
    arrivals = compute_arrivals(class_start_minute=0, attendees=200, rng=random.Random(3))
    assert min(arrivals) >= 0
    assert max(arrivals) <= 1439


def test_compute_departures_majority_immediate():
    # Spec: 70% within 10 min of class end.
    departures = compute_departures(class_end_minute=720, attendees=2000, rng=random.Random(13))
    immediate = sum(1 for m in departures if 720 <= m < 730)
    assert immediate / len(departures) > 0.65


def test_compute_arrivals_zero_attendees():
    assert compute_arrivals(class_start_minute=600, attendees=0, rng=random.Random(0)) == []


# ---------------------------------------------------------------------------
# select_lot_probs (softmax)
# ---------------------------------------------------------------------------


def test_select_lot_probs_sum_to_one():
    candidates = [
        ("L1", 2.0, 0.3, 1.0),
        ("L2", 5.0, 0.6, 1.0),
        ("L3", 4.0, 0.1, 0.0),
    ]
    probs = select_lot_probs(candidates)
    assert math.isclose(sum(probs.values()), 1.0, abs_tol=1e-9)


def test_select_lot_probs_prefers_close_empty_matching():
    near_empty_match = ("NEAR", 1.0, 0.1, 1.0)
    far_full_nomatch = ("FAR", 10.0, 0.95, 0.0)
    probs = select_lot_probs([near_empty_match, far_full_nomatch])
    assert probs["NEAR"] > probs["FAR"]
    # And by a wide margin given β values.
    assert probs["NEAR"] > 0.95


def test_select_lot_probs_empty_returns_empty():
    assert select_lot_probs([]) == {}


def test_select_lot_probs_softmax_betas_applied():
    # Two identical lots except permit; permit β=+1.5 should dominate.
    probs = select_lot_probs([("MATCH", 5.0, 0.5, 1.0), ("NOMATCH", 5.0, 0.5, 0.0)])
    # ratio = exp(1.5) ≈ 4.48 → MATCH gets ~0.817.
    expected = math.exp(LOT_SOFTMAX_BETA["permit"]) / (1 + math.exp(LOT_SOFTMAX_BETA["permit"]))
    assert probs["MATCH"] == pytest.approx(expected, abs=1e-6)


# ---------------------------------------------------------------------------
# _sample_bucket_offsets
# ---------------------------------------------------------------------------


def test_sample_bucket_offsets_zero():
    assert _sample_bucket_offsets(ARRIVAL_BUCKETS, 0, random.Random(0)) == []


def test_sample_bucket_offsets_within_ranges():
    samples = _sample_bucket_offsets(ARRIVAL_BUCKETS, 500, random.Random(1))
    assert len(samples) == 500
    assert all(-30 <= s <= 10 for s in samples)


# ---------------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------------


def test_seeded_rng_reproducible():
    a = compute_arrivals(600, 100, random.Random(99))
    b = compute_arrivals(600, 100, random.Random(99))
    assert a == b


def test_attendees_seeded_reproducible():
    a = attendees_for_meeting(enrollment=80, calendar_mult=1.0, rng=random.Random(7))
    b = attendees_for_meeting(enrollment=80, calendar_mult=1.0, rng=random.Random(7))
    assert a == b


# ---------------------------------------------------------------------------
# day-of-week bitmask
# ---------------------------------------------------------------------------


def test_day_bits_correct_order():
    # Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
    assert _DAY_BITS == (1, 2, 4, 8, 16, 32, 64)


def test_mwf_mask_matches_mon_wed_fri():
    mwf = 1 | 4 | 16  # 21
    # Monday is index 0, Wednesday 2, Friday 4 → bits 1, 4, 16.
    matching = [d for d in range(7) if mwf & _DAY_BITS[d]]
    assert matching == [0, 2, 4]


# ---------------------------------------------------------------------------
# Integration: SyntheticV2Generator with stubbed connection
# ---------------------------------------------------------------------------


def _make_stub_conn(*, lots, proximity, meetings, events):
    """Build a MagicMock psycopg2 connection that returns the supplied
    rows in the order the generator queries them: lots → proximity →
    meetings → events."""
    cursor = MagicMock()
    fetch_queue = [lots, proximity, meetings, events]
    cursor.fetchall.side_effect = fetch_queue
    cursor.__enter__ = MagicMock(return_value=cursor)
    cursor.__exit__ = MagicMock(return_value=False)
    conn = MagicMock()
    conn.cursor.return_value = cursor
    return conn


def test_generator_emits_one_row_per_lot_per_tick():
    lots = [
        ("lot-cuid-1", "G1", 100, ["Student", "Daily"], False),
    ]
    proximity = [("lot-cuid-1", "bld-cuid-1", 150.0, math.exp(-150 / 250))]
    # MWF 10:00-10:50 lecture, 50 enrolled.
    meetings = [
        ("meeting-cuid-1", "bld-cuid-1", 1 | 4 | 16, 600, 650, 50, 50, "LECTURE"),
    ]
    events: list = []

    conn = _make_stub_conn(lots=lots, proximity=proximity, meetings=meetings, events=events)
    gen = SyntheticV2Generator(conn=conn, school_id="school-1", term="Spring_2026", seed=1)
    gen.load()

    # One Monday only.
    rows = list(gen.generate(date(2026, 2, 2), date(2026, 2, 2)))
    assert len(rows) == 1 * sv2.TICKS_PER_DAY
    assert all(r["generator_version"] == "v2" for r in rows)
    assert all(r["term"] == "Spring_2026" for r in rows)
    assert all(0 <= r["occupancy"] <= 100 for r in rows)
    assert all(0.0 <= r["occupancy_rate"] <= 1.0 for r in rows)


def test_generator_skips_break_dates():
    lots = [("lot-cuid-1", "G1", 100, ["Student"], False)]
    proximity = [("lot-cuid-1", "bld-cuid-1", 150.0, 0.5)]
    meetings = [("meeting-cuid-1", "bld-cuid-1", 1 | 4 | 16, 600, 650, 50, 50, "LECTURE")]
    events: list = []
    conn = _make_stub_conn(lots=lots, proximity=proximity, meetings=meetings, events=events)
    gen = SyntheticV2Generator(conn=conn, school_id="s", term="Spring_2026", seed=1)
    gen.load()

    # Christmas Day — definitively a break date.
    rows = list(gen.generate(date(2025, 12, 25), date(2025, 12, 25)))
    # No class load; only off-campus background (5%) + noise. Mean occ
    # over the day should be well below capacity.
    avg_occ = sum(r["occupancy"] for r in rows) / len(rows)
    assert avg_occ < 30  # 100 * 0.05 = 5 nominal + noise band.


def test_generator_requires_load_before_generate():
    conn = _make_stub_conn(lots=[], proximity=[], meetings=[], events=[])
    gen = SyntheticV2Generator(conn=conn, school_id="s", term="Spring_2026", seed=1)
    with pytest.raises(RuntimeError, match="load"):
        list(gen.generate(date(2026, 2, 2), date(2026, 2, 2)))


def test_generator_rejects_inverted_date_range():
    conn = _make_stub_conn(
        lots=[("lot-cuid-1", "G1", 100, ["Student"], False)],
        proximity=[],
        meetings=[],
        events=[],
    )
    gen = SyntheticV2Generator(conn=conn, school_id="s", term="Spring_2026", seed=1)
    gen.load()
    with pytest.raises(ValueError):
        list(gen.generate(date(2026, 2, 5), date(2026, 2, 1)))


def test_generator_seeded_reproducible():
    lots = [("lot-cuid-1", "G1", 100, ["Student", "Daily"], False)]
    proximity = [("lot-cuid-1", "bld-cuid-1", 150.0, 0.5)]
    meetings = [("meeting-cuid-1", "bld-cuid-1", 1 | 4 | 16, 600, 650, 80, 80, "LECTURE")]
    events: list = []

    def make_gen():
        conn = _make_stub_conn(
            lots=lots, proximity=proximity, meetings=meetings, events=events
        )
        gen = SyntheticV2Generator(conn=conn, school_id="s", term="Spring_2026", seed=2026)
        gen.load()
        return gen

    rows_a = [r["occupancy"] for r in make_gen().generate(date(2026, 2, 2), date(2026, 2, 2))]
    rows_b = [r["occupancy"] for r in make_gen().generate(date(2026, 2, 2), date(2026, 2, 2))]
    assert rows_a == rows_b


# ---------------------------------------------------------------------------
# bulk_insert / truncate_existing — verify SQL shape via stub.
# ---------------------------------------------------------------------------


def test_bulk_insert_empty_returns_zero():
    conn = MagicMock()
    assert sv2.bulk_insert(conn, []) == 0


def test_truncate_existing_passes_correct_filter():
    cur = MagicMock()
    cur.__enter__ = MagicMock(return_value=cur)
    cur.__exit__ = MagicMock(return_value=False)
    cur.rowcount = 42
    conn = MagicMock()
    conn.cursor.return_value = cur

    deleted = sv2.truncate_existing(conn, school_id="s1", term="Spring_2026")

    assert deleted == 42
    args, _ = cur.execute.call_args
    sql, params = args
    assert "DELETE FROM synthetic_observations" in sql
    assert params == ("s1", "Spring_2026", "v2")
