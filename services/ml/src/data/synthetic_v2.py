"""
SharkPark synthetic occupancy generator v2 (D4).

Catalog-driven cold-start training set. Where v1 (`synthetic.py`) used
hand-tuned per-lot time-of-day curves, v2 builds occupancy bottom-up
from the actual CSULB course schedule (D2) routed through the
lot↔building proximity matrix (D3):

  ┌─────────────────────┐   ┌──────────────────────┐
  │ course_meetings     │──▶│ student arrivals &   │
  │  (term, days_mask,  │   │ departures sampled   │
  │   start/end_minute, │   │ around class times   │
  │   building_id,      │   └──────────┬───────────┘
  │   enrollment)       │              │
  └─────────────────────┘              │
                                       ▼
              ┌──────────────────────────────────────┐
              │ lot_building_proximity (D3 weights)  │
              │   + lot.permit_types match           │──▶ softmax → lot
              │   + live fill rate                   │
              └──────────────────────────────────────┘
                                       │
                                       ▼
                ┌──────────────────────────────────┐
                │ background load:                 │
                │  - faculty 0.15·cap M-F 7-18     │
                │  - off-campus 0.05·cap 9-16      │
                │  - campus_events spread to       │
                │    nearby lots                   │
                └──────────────┬───────────────────┘
                               ▼
              SyntheticObservation (lot, 15-min UTC tick,
              occupancy, occupancy_rate, sample_weight)

All randomness threads through an injected `random.Random` so a fixed
seed produces identical output (required by `test_seeded_rng_reproducible`
and by the production CLI's `--seed` reproducibility guarantee).

Volume: ~70 lots × 96 ticks/day × 16 weeks × 7 days ≈ 750k rows per
term. Bulk-inserted via `psycopg2.extras.execute_values` in 5k batches.

D5 will read these rows alongside `consensus_observations` in
`train_short_term.py` / `train_long_term.py` with a `sample_weight`
column (1.0 here; per-lot decay vs real-data count applied at train
time, not stored).
"""

from __future__ import annotations

import logging
import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterator
from zoneinfo import ZoneInfo

import numpy as np
from psycopg2.extras import execute_values

from src.academic_calendar import get_week_of_semester
from src.data.db import _generate_cuid

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants (frozen defaults from the D4 spec, lines 88-106).
# Override via the CLI's `--commuter-rate` etc. for sensitivity studies.
# ---------------------------------------------------------------------------

#: Fraction of enrolled students who commute (vs. residents/online-only).
COMMUTER_RATE: float = 0.80
#: Of commuters, fraction who drive (vs. transit/bike/walk).
DRIVE_SHARE: float = 0.85
#: Of drivers, fraction who actually attend on a given regular class day.
ATTENDANCE_BASE: float = 0.80

#: Walking speed for the walk-time feature in lot softmax (m/min).
WALK_SPEED_M_PER_MIN: float = 80.0

#: Per-tick gaussian noise std as a fraction of lot capacity.
NOISE_FRAC: float = 0.05

#: Background loads (fraction of lot capacity).
FACULTY_LOAD_FRAC: float = 0.15
OFFCAMPUS_LOAD_FRAC: float = 0.05
EVENT_LOAD_FRAC_NEAR_BUILDING: float = 0.10

#: Snapshot quantum — must match the real `OccupancySnapshot` cadence so
#: train scripts can `UNION ALL` real + synthetic without resampling.
TICK_MINUTES: int = 15
TICKS_PER_DAY: int = 24 * 60 // TICK_MINUTES  # 96

#: Arrival distribution: (start_offset_min, end_offset_min, probability).
#: Offsets are minutes relative to class start (negative = before).
ARRIVAL_BUCKETS: tuple[tuple[int, int, float], ...] = (
    (-30, -20, 0.40),
    (-20, -10, 0.35),
    (-10, 0, 0.20),
    (0, 10, 0.05),
)

#: Departure distribution: minutes after class end.
DEPARTURE_BUCKETS: tuple[tuple[int, int, float], ...] = (
    (0, 10, 0.70),
    (10, 30, 0.20),
    (30, 180, 0.10),
)

#: Softmax coefficients for lot selection. `walk` and `fill` push
#: away from the lot; `permit` pulls toward matching lots.
LOT_SOFTMAX_BETA: dict[str, float] = {
    "walk": -0.4,
    "fill": -2.0,
    "permit": +1.5,
}

#: Calendar overlay multiplier on student attendance.
#: `period` strings come from `get_week_of_semester()`.
#:
#: Winter / summer intersessions carry only ~3k / ~8k commuters vs the
#: ~35k of a regular fall/spring weekday (see ``academic-calendar.ts``
#: ``COMMUTER_MAP``). Scaling student attendance by the same ratio
#: prevents the synthetic generator from emitting fall-level pulses
#: during low-activity terms when the catalog ingest still finds a few
#: meetings (e.g. an Express-Winter cohort).
CALENDAR_MULT: dict[str, float] = {
    "break": 0.0,
    "winter_session": 0.10,   # ~3k / 35k commuters
    "summer_session": 0.30,   # ~8k / 35k commuters, plus shorter days
    "finals": 0.6,
    "dead_week": 0.8,
    "early": 0.95,
    "regular": 1.0,
    "midterms": 1.05,
    "late": 0.95,
}

#: Day-of-week bitmask used by `course_meetings.days_mask`.
#: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
_DAY_BITS: tuple[int, ...] = (1, 2, 4, 8, 16, 32, 64)

#: Permit-string set treated as "student-eligible" for lot matching.
#: Sourced from `apps/backend/prisma/lot-data.ts`.
STUDENT_PERMITS: frozenset[str] = frozenset({"Student", "Daily"})
EMPLOYEE_PERMITS: frozenset[str] = frozenset({"Employee", "Emeriti"})

GENERATOR_VERSION: str = "v2"


# ---------------------------------------------------------------------------
# Data records (one struct per DB table to keep the generator's working set
# typed and cheap to copy).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LotRecord:
    id: str
    lot_id: str
    capacity: int
    permit_types: tuple[str, ...]
    daily_permit_allowed: bool

    @property
    def accepts_student(self) -> bool:
        return self.daily_permit_allowed or bool(
            STUDENT_PERMITS.intersection(self.permit_types)
        )

    @property
    def accepts_employee(self) -> bool:
        return bool(EMPLOYEE_PERMITS.intersection(self.permit_types))


@dataclass(frozen=True)
class MeetingRecord:
    id: str
    building_id: str
    days_mask: int
    start_minute: int
    end_minute: int
    enrollment: int
    capacity_used: int  # the resolved capacity (room_capacity / override / fallback)
    course_type: str | None


@dataclass(frozen=True)
class ProximityEdge:
    lot_id: str
    building_id: str
    distance_m: float
    weight: float  # exp(-distance_m / 250) from D3


@dataclass(frozen=True)
class CampusEventRecord:
    id: str
    building_id: str | None
    start_time: datetime  # tz-aware UTC
    end_time: datetime    # tz-aware UTC


# ---------------------------------------------------------------------------
# Pure functions (each one is independently unit-tested in
# `tests/data/test_synthetic_v2.py`).
# ---------------------------------------------------------------------------


def walk_minutes(distance_m: float, speed_m_per_min: float = WALK_SPEED_M_PER_MIN) -> float:
    """Convert a walking distance to minutes at a fixed speed."""
    if speed_m_per_min <= 0:
        raise ValueError("speed_m_per_min must be positive")
    return distance_m / speed_m_per_min


def calendar_multiplier(d: date) -> float:
    """
    Calendar overlay multiplier on attendance for a date.

    Combines `get_week_of_semester(d)` (period) with the table in
    `CALENDAR_MULT`. Unknown periods fall back to 1.0; weekends inherit
    the period multiplier (background "M-F only" gating is applied
    separately for faculty/off-campus loads).
    """
    _, period = get_week_of_semester(d)
    return CALENDAR_MULT.get(period, 1.0)


def attendees_for_meeting(
    *,
    enrollment: int,
    calendar_mult: float,
    rng: random.Random,
    commuter_rate: float = COMMUTER_RATE,
    drive_share: float = DRIVE_SHARE,
    attendance: float = ATTENDANCE_BASE,
    noise_frac: float = NOISE_FRAC,
) -> int:
    """
    Number of cars actually parked for one meeting on one day.

    expected = enrollment · COMMUTER · DRIVE · ATTENDANCE · calendar_mult
    + N(0, noise_frac · enrollment), clipped to [0, enrollment].
    """
    if enrollment <= 0 or calendar_mult <= 0:
        return 0
    expected = enrollment * commuter_rate * drive_share * attendance * calendar_mult
    noise = rng.gauss(0.0, noise_frac * enrollment)
    return max(0, min(enrollment, int(round(expected + noise))))


def _sample_bucket_offsets(
    buckets: tuple[tuple[int, int, float], ...],
    n: int,
    rng: random.Random,
) -> list[int]:
    """
    Sample `n` minute offsets from a bucket distribution.

    Each bucket is `(start, end, prob)`; we draw the bucket via the cumulative
    prob, then a uniform integer offset within `[start, end)`. Returns a list
    of length `n` (empty if n == 0).
    """
    if n <= 0:
        return []
    total_p = sum(p for _, _, p in buckets)
    if total_p <= 0:
        raise ValueError("bucket probabilities must sum > 0")
    out: list[int] = []
    for _ in range(n):
        u = rng.random() * total_p
        acc = 0.0
        for start, end, prob in buckets:
            acc += prob
            if u <= acc:
                # Uniform within bucket; end is exclusive.
                out.append(rng.randrange(start, end) if end > start else start)
                break
        else:  # pragma: no cover - safeguard for fp drift
            start, end, _ = buckets[-1]
            out.append(rng.randrange(start, end) if end > start else start)
    return out


def compute_arrivals(
    class_start_minute: int,
    attendees: int,
    rng: random.Random,
) -> list[int]:
    """
    Sample one arrival minute (0..1439, local clock) per attendee.

    Negative offsets pre-class are clipped to 0 (parked at midnight makes
    no sense); positive offsets that overflow past 1439 are clipped to
    the last minute of the day (rare — the latest bucket only goes T+10).
    """
    offsets = _sample_bucket_offsets(ARRIVAL_BUCKETS, attendees, rng)
    return [max(0, min(1439, class_start_minute + off)) for off in offsets]


def compute_departures(
    class_end_minute: int,
    attendees: int,
    rng: random.Random,
) -> list[int]:
    """
    Sample one departure minute (0..1439, local clock) per attendee.

    Symmetric to `compute_arrivals` but biased post-class. Overflow past
    midnight is clipped (we don't carry vehicles into the next day's
    snapshot — a small bias for late-evening classes; acceptable).
    """
    offsets = _sample_bucket_offsets(DEPARTURE_BUCKETS, attendees, rng)
    return [max(0, min(1439, class_end_minute + off)) for off in offsets]


def select_lot_probs(
    candidates: list[tuple[str, float, float, float]],
) -> dict[str, float]:
    """
    Compute lot-selection softmax probabilities.

    `candidates` is a list of `(lot_id, walk_minutes, fill_rate, permit_match)`.
    Returns `{lot_id: probability}` summing to 1.0. Empty input → {}.

    Score = β_walk·walk + β_fill·fill + β_permit·permit
            (β_walk and β_fill are negative, so closer/emptier wins).
    Subtract max(score) before exp for numerical stability.
    """
    if not candidates:
        return {}
    scores: list[float] = []
    for _, walk, fill, permit in candidates:
        score = (
            LOT_SOFTMAX_BETA["walk"] * walk
            + LOT_SOFTMAX_BETA["fill"] * fill
            + LOT_SOFTMAX_BETA["permit"] * permit
        )
        scores.append(score)
    s_max = max(scores)
    exps = [math.exp(s - s_max) for s in scores]
    z = sum(exps)
    if z <= 0:  # pragma: no cover
        # All scores were -inf (impossible with finite betas); uniform fallback.
        n = len(candidates)
        return {lot_id: 1.0 / n for lot_id, *_ in candidates}
    return {candidates[i][0]: exps[i] / z for i in range(len(candidates))}


# ---------------------------------------------------------------------------
# Generator orchestration
# ---------------------------------------------------------------------------


@dataclass
class _LotState:
    record: LotRecord
    # 1-D float array sized [n_days * TICKS_PER_DAY]; start at 0.
    occupancy: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))


class SyntheticV2Generator:
    """
    Catalog-driven synthetic occupancy generator.

    Construct with a live psycopg2 connection plus the school/term to
    target, then call :py:meth:`generate` with a date range. Yields one
    dict per (lot, 15-min UTC tick) ready for `execute_values` insert
    into `synthetic_observations`.

    The generator holds the entire term's per-lot occupancy timeline in
    memory as float32 numpy arrays — for CSULB (~70 lots × 96 ticks ×
    ~120 days) that's ~3 MB total, negligible.
    """

    def __init__(
        self,
        *,
        conn,
        school_id: str,
        term: str,
        timezone_name: str = "America/Los_Angeles",
        seed: int = 42,
    ) -> None:
        self.conn = conn
        self.school_id = school_id
        self.term = term
        self.tz = ZoneInfo(timezone_name)
        self.rng = random.Random(seed)
        self._np_rng = np.random.default_rng(seed)

        self.lots: dict[str, _LotState] = {}
        # building_id → list[ProximityEdge]
        self.proximity_by_building: dict[str, list[ProximityEdge]] = defaultdict(list)
        self.meetings: list[MeetingRecord] = []
        self.events: list[CampusEventRecord] = []

    # -- loading ----------------------------------------------------------

    def load(self) -> None:
        """Fetch lots, meetings, proximity edges, campus events for the term."""
        self._load_lots()
        self._load_proximity()
        self._load_meetings()
        self._load_events_window_unbounded()
        log.info(
            "synthetic_v2 load complete: %d lots, %d meetings, %d proximity edges, %d events",
            len(self.lots),
            len(self.meetings),
            sum(len(v) for v in self.proximity_by_building.values()),
            len(self.events),
        )

    def _load_lots(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, lot_id, capacity, permit_types, daily_permit_allowed
                FROM lots
                WHERE school_id = %s
                """,
                (self.school_id,),
            )
            for row in cur.fetchall():
                rec = LotRecord(
                    id=row[0],
                    lot_id=row[1],
                    capacity=int(row[2]),
                    permit_types=tuple(row[3] or []),
                    daily_permit_allowed=bool(row[4]),
                )
                self.lots[rec.id] = _LotState(record=rec)

    def _load_proximity(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT lot_id, building_id, distance_m, weight
                FROM lot_building_proximity
                WHERE school_id = %s
                """,
                (self.school_id,),
            )
            for row in cur.fetchall():
                edge = ProximityEdge(
                    lot_id=row[0],
                    building_id=row[1],
                    distance_m=float(row[2]),
                    weight=float(row[3]),
                )
                self.proximity_by_building[edge.building_id].append(edge)

    def _load_meetings(self) -> None:
        # Resolve enrollment/capacity in SQL: SectionEnrollmentOverride wins,
        # else CourseMeeting.enrollment, else RoomCapacity (matched on
        # building.alternate_names → cm.room), else 30 (typical seminar).
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    cm.id,
                    cm.building_id,
                    cm.days_mask,
                    cm.start_minute,
                    cm.end_minute,
                    COALESCE(seo.enrollment, cm.enrollment, cm.room_capacity, 30) AS enrollment,
                    COALESCE(cm.room_capacity, cm.enrollment, 30) AS capacity_used,
                    cm.course_type
                FROM course_meetings cm
                LEFT JOIN section_enrollment_overrides seo
                    ON seo.school_id = cm.school_id
                   AND seo.class_number = cm.class_number
                WHERE cm.school_id = %s
                  AND cm.term = %s
                  AND cm.days_mask > 0
                  AND cm.start_minute IS NOT NULL
                  AND cm.end_minute IS NOT NULL
                  AND cm.building_id IS NOT NULL
                """,
                (self.school_id, self.term),
            )
            for row in cur.fetchall():
                self.meetings.append(
                    MeetingRecord(
                        id=row[0],
                        building_id=row[1],
                        days_mask=int(row[2]),
                        start_minute=int(row[3]),
                        end_minute=int(row[4]),
                        enrollment=int(row[5]),
                        capacity_used=int(row[6]),
                        course_type=row[7],
                    )
                )

    def _load_events_window_unbounded(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, building_id, start_time, end_time
                FROM campus_events
                WHERE school_id = %s
                  AND building_id IS NOT NULL
                  AND end_time IS NOT NULL
                """,
                (self.school_id,),
            )
            for row in cur.fetchall():
                start = row[2]
                end = row[3]
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                if end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
                self.events.append(
                    CampusEventRecord(
                        id=row[0],
                        building_id=row[1],
                        start_time=start,
                        end_time=end,
                    )
                )

    # -- simulation -------------------------------------------------------

    def generate(self, start_date: date, end_date: date) -> Iterator[dict]:
        """
        Run the simulation for [start_date, end_date] inclusive and yield
        one row per (lot, 15-min UTC tick).

        Caller owns the DB write — typically `_bulk_insert(rows)` below.
        """
        if end_date < start_date:
            raise ValueError("end_date must be >= start_date")
        if not self.lots:
            raise RuntimeError("call load() before generate()")

        n_days = (end_date - start_date).days + 1
        n_ticks = n_days * TICKS_PER_DAY
        for state in self.lots.values():
            state.occupancy = np.zeros(n_ticks, dtype=np.float32)

        days = [start_date + timedelta(days=i) for i in range(n_days)]

        for day_idx, d in enumerate(days):
            mult = calendar_multiplier(d)
            self._simulate_day_classes(day_idx, d, mult)
            self._simulate_day_background(day_idx, d, mult)
            self._simulate_day_events(day_idx, d)

        # Per-tick gaussian noise + clip to [0, capacity], then yield.
        for state in self.lots.values():
            cap = state.record.capacity
            noise = self._np_rng.normal(
                loc=0.0, scale=NOISE_FRAC * cap, size=n_ticks
            ).astype(np.float32)
            occ = np.clip(state.occupancy + noise, 0.0, cap).astype(np.int32)
            for tick_idx in range(n_ticks):
                day_offset, t = divmod(tick_idx, TICKS_PER_DAY)
                local_dt = datetime.combine(
                    days[day_offset],
                    time(hour=t * TICK_MINUTES // 60, minute=(t * TICK_MINUTES) % 60),
                    tzinfo=self.tz,
                )
                ts_utc = local_dt.astimezone(timezone.utc)
                yield {
                    "id": _generate_cuid(),
                    "school_id": self.school_id,
                    "lot_id": state.record.id,
                    "timestamp": ts_utc,
                    "occupancy": int(occ[tick_idx]),
                    "occupancy_rate": round(float(occ[tick_idx]) / cap, 4) if cap else 0.0,
                    "generator_version": GENERATOR_VERSION,
                    "term": self.term,
                    "sample_weight": 1.0,
                }

    # -- per-day simulation pieces ---------------------------------------

    def _simulate_day_classes(self, day_idx: int, d: date, mult: float) -> None:
        """Add per-class arrival/departure pulses to each lot's timeline."""
        if mult <= 0:
            return
        # Mon=0..Sun=6 → bit 1<<dow.
        day_bit = _DAY_BITS[d.weekday()]
        for meeting in self.meetings:
            if not (meeting.days_mask & day_bit):
                continue
            if meeting.building_id not in self.proximity_by_building:
                # Building has no proximity edges; cannot route attendees.
                continue
            attendees = attendees_for_meeting(
                enrollment=meeting.enrollment,
                calendar_mult=mult,
                rng=self.rng,
            )
            if attendees == 0:
                continue
            self._distribute_meeting(day_idx, meeting, attendees)

    def _distribute_meeting(
        self, day_idx: int, meeting: MeetingRecord, attendees: int
    ) -> None:
        """
        For one meeting on one day, sample arrivals/departures and route
        each attendee to a candidate lot via softmax. Lot fill at routing
        time is a snapshot from the start-of-meeting tick (good enough —
        within-meeting feedback is second-order).
        """
        edges = self.proximity_by_building[meeting.building_id]
        # Snapshot tick at class start for fill-rate input.
        start_tick_local = day_idx * TICKS_PER_DAY + meeting.start_minute // TICK_MINUTES
        start_tick_local = max(0, min(start_tick_local, day_idx * TICKS_PER_DAY + TICKS_PER_DAY - 1))

        candidates: list[tuple[str, float, float, float]] = []
        for edge in edges:
            state = self.lots.get(edge.lot_id)
            if state is None or state.record.capacity <= 0:
                continue
            walk = walk_minutes(edge.distance_m)
            fill = float(state.occupancy[start_tick_local]) / state.record.capacity
            permit = 1.0 if state.record.accepts_student else 0.0
            candidates.append((edge.lot_id, walk, fill, permit))

        if not candidates:
            return

        probs = select_lot_probs(candidates)
        lot_ids = list(probs.keys())
        weights = np.array([probs[lid] for lid in lot_ids], dtype=np.float64)
        # Multinomial sample: per-lot attendee count.
        per_lot_counts = self._np_rng.multinomial(attendees, weights / weights.sum())

        arrivals = compute_arrivals(meeting.start_minute, attendees, self.rng)
        departures = compute_departures(meeting.end_minute, attendees, self.rng)
        # Shuffle arrivals/departures together so per-attendee assignment
        # to a chosen lot is a random pairing (no positional correlation).
        pairs = list(zip(arrivals, departures))
        self.rng.shuffle(pairs)

        cursor = 0
        for lot_id, count in zip(lot_ids, per_lot_counts):
            if count == 0:
                continue
            state = self.lots[lot_id]
            for arr_min, dep_min in pairs[cursor : cursor + count]:
                if dep_min <= arr_min:
                    # Edge case: very short class with off-by-one sample;
                    # guarantee at least one occupied tick.
                    dep_min = arr_min + TICK_MINUTES
                arr_tick = arr_min // TICK_MINUTES
                dep_tick = min(TICKS_PER_DAY, (dep_min + TICK_MINUTES - 1) // TICK_MINUTES)
                base = day_idx * TICKS_PER_DAY
                state.occupancy[base + arr_tick : base + dep_tick] += 1.0
            cursor += count

    def _simulate_day_background(self, day_idx: int, d: date, mult: float) -> None:
        """
        Faculty load (M-F 7am-6pm, FACULTY_LOAD_FRAC of capacity, gated
        by calendar mult) + off-campus background (every day 9am-4pm,
        OFFCAMPUS_LOAD_FRAC of capacity, no calendar gate).
        """
        base = day_idx * TICKS_PER_DAY
        is_weekday = d.weekday() < 5

        if is_weekday and mult > 0:
            fac_start = 7 * 60 // TICK_MINUTES
            fac_end = 18 * 60 // TICK_MINUTES
            for state in self.lots.values():
                if not state.record.accepts_employee:
                    continue
                load = FACULTY_LOAD_FRAC * state.record.capacity * mult
                state.occupancy[base + fac_start : base + fac_end] += load

        oc_start = 9 * 60 // TICK_MINUTES
        oc_end = 16 * 60 // TICK_MINUTES
        for state in self.lots.values():
            load = OFFCAMPUS_LOAD_FRAC * state.record.capacity
            state.occupancy[base + oc_start : base + oc_end] += load

    def _simulate_day_events(self, day_idx: int, d: date) -> None:
        """
        For each campus event whose UTC start_time falls on this local
        day, add EVENT_LOAD_FRAC × capacity to each lot proximate to the
        event's building, scaled by the D3 proximity weight, for the
        event's duration. Sports / large-cap events would ideally scale
        by attendance, but `campus_events` doesn't carry that field
        publicly — flat fraction is a known underestimate documented
        in the model design doc.
        """
        for event in self.events:
            local_start = event.start_time.astimezone(self.tz)
            if local_start.date() != d:
                continue
            if event.building_id not in self.proximity_by_building:
                continue
            local_end = event.end_time.astimezone(self.tz)
            start_min = local_start.hour * 60 + local_start.minute
            end_min = local_end.hour * 60 + local_end.minute
            if local_end.date() != d:
                end_min = 24 * 60  # truncate to end-of-day
            start_tick = max(0, start_min // TICK_MINUTES)
            end_tick = min(TICKS_PER_DAY, (end_min + TICK_MINUTES - 1) // TICK_MINUTES)
            if end_tick <= start_tick:
                continue
            base = day_idx * TICKS_PER_DAY
            for edge in self.proximity_by_building[event.building_id]:
                state = self.lots.get(edge.lot_id)
                if state is None:
                    continue
                load = EVENT_LOAD_FRAC_NEAR_BUILDING * state.record.capacity * edge.weight
                state.occupancy[base + start_tick : base + end_tick] += load


# ---------------------------------------------------------------------------
# DB write helpers (used by `services/ml/scripts/generate_synthetic_v2.py`).
# ---------------------------------------------------------------------------


def truncate_existing(conn, *, school_id: str, term: str) -> int:
    """
    Delete any prior `synthetic_v2` rows for (school, term). Returns the
    deleted row count. Caller is responsible for `conn.commit()`.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM synthetic_observations
            WHERE school_id = %s AND term = %s AND generator_version = %s
            """,
            (school_id, term, GENERATOR_VERSION),
        )
        return cur.rowcount


def bulk_insert(conn, rows: list[dict], *, batch_size: int = 5_000) -> int:
    """
    Bulk insert rows yielded by `SyntheticV2Generator.generate()`.

    Uses `execute_values` for ~50× speedup over per-row INSERTs. Returns
    the total inserted count. Caller commits.
    """
    if not rows:
        return 0
    deduped: dict[tuple[str, datetime, str], dict] = {}
    for row in rows:
        key = (row["lot_id"], row["timestamp"], row["generator_version"])
        deduped[key] = row

    if len(deduped) != len(rows):
        log.warning(
            "Deduplicated %d synthetic rows before bulk insert",
            len(rows) - len(deduped),
        )

    rows = list(deduped.values())

    columns = (
        "id",
        "school_id",
        "lot_id",
        "timestamp",
        "occupancy",
        "occupancy_rate",
        "generator_version",
        "term",
        "sample_weight",
    )
    sql = f"""
        INSERT INTO synthetic_observations ({", ".join(columns)})
        VALUES %s
        ON CONFLICT (lot_id, timestamp, generator_version) DO UPDATE SET
            occupancy = EXCLUDED.occupancy,
            occupancy_rate = EXCLUDED.occupancy_rate,
            sample_weight = EXCLUDED.sample_weight,
            term = EXCLUDED.term,
            generated_at = CURRENT_TIMESTAMP
    """
    template = "(" + ", ".join(["%s"] * len(columns)) + ")"
    inserted = 0
    with conn.cursor() as cur:
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            values = [tuple(r[c] for c in columns) for r in batch]
            execute_values(cur, sql, values, template=template, page_size=batch_size)
            inserted += len(batch)
    return inserted
