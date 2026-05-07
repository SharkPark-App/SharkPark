"""
build_proximity_matrix.py — D3 (lot × building) proximity matrix.

Computes a haversine distance matrix between every Lot centroid and every
Building centroid for a given school, filters to ≤ 500 m, derives a
softmax-friendly weight `exp(-distance_m / 250)`, and upserts the result
into `lot_building_proximity`.

Why this script exists
----------------------
The D4 synthetic generator (`services/ml/src/data/synthetic_v2.py`) needs
to allocate arriving drivers to lots via a Plackett-Luce softmax that
includes a walk-distance term. Computing distances on every synthetic
tick would be wasteful — lots and buildings are nearly static. Instead
we materialize the matrix into Postgres once a week and let the
generator do an indexed lookup.

Distance choice
---------------
Centroid-to-centroid haversine. The membership-style derivation in
`apps/backend/src/lots/derive-lot-buildings.ts` uses polygon-edge
geometry because it's classifying "does this lot serve this building?"
in a hard yes/no decision near the 250 m boundary, where 30 m of
polygon-vs-centroid error matters. The softmax weight here decays
smoothly — a 30 m error at 200 m moves `weight = exp(-d/250)` from
~0.449 to ~0.398, well inside the noise floor of every other term in
the synthetic model. Centroid-to-centroid is the right tradeoff.

Cap and weight curve
--------------------
Cap = 500 m. At the cap, weight = exp(-2) ≈ 0.135. Beyond 500 m the
walk is implausible enough that the contribution to the softmax should
just be zero (storing rows with `weight < 0.135` adds noise to the
matrix without changing predictions meaningfully). At 250 m the weight
is exp(-1) ≈ 0.368 — matching the historical
`DEFAULT_LOT_BUILDING_RADIUS_M = 250` membership radius, so users of
the matrix who want a "membership-like" cut can threshold at
weight ≥ 0.368 and recover the same set.

Idempotency
-----------
Composite PK `(lot_id, building_id)` + `INSERT ... ON CONFLICT DO
UPDATE`. Stale rows (a building that's been deleted, or moved out of
range) are removed via a `DELETE WHERE NOT IN (current keys)` step
inside the same transaction. The cron monitor sees the
`pairs_inserted / pairs_updated / pairs_deleted` counts in
`ml_cron_runs.metadata`.

Operator usage
--------------
    python -m scripts.build_proximity_matrix              # all schools
    python -m scripts.build_proximity_matrix --school CSULB

Default behavior is "every school"; the catalog & room-capacity scripts
are CSULB-only because their HTML scrapers are CSULB-specific, but this
script is purely numeric and trivially generalizes.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from dataclasses import dataclass
from typing import Optional

from psycopg2.extras import execute_values

from src.data.db import get_connection

logger = logging.getLogger(__name__)

# ─── Tunables ─────────────────────────────────────────────────────────

# WGS84 mean Earth radius in meters. Matches the value used by the
# TS-side `derive-lot-buildings.haversineMeters` so cross-language
# distance computations agree to floating-point precision.
EARTH_RADIUS_M = 6_371_000.0

# Maximum distance retained in the matrix. Beyond this the softmax
# contribution (~0.135 at 500 m) is negligible relative to the in-lot
# fill-rate term, so we cull aggressively to keep the matrix sparse.
MAX_DISTANCE_M = 500.0

# Decay scale for the softmax weight. weight = exp(-distance_m / SCALE).
# SCALE = 250 m chosen to align with the existing membership-radius
# constant in derive-lot-buildings.ts (so weight ≥ 1/e ↔ "served by").
WEIGHT_DECAY_SCALE_M = 250.0


# ─── Data classes ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class LotPoint:
    id: str
    lat: float
    lng: float


@dataclass(frozen=True)
class BuildingPoint:
    id: str
    lat: float
    lng: float


@dataclass(frozen=True)
class ProximityRow:
    lot_id: str
    building_id: str
    distance_m: float
    weight: float


# ─── Geometry ─────────────────────────────────────────────────────────


def haversine_meters(
    lat1: float, lng1: float, lat2: float, lng2: float
) -> float:
    """
    Great-circle distance between two WGS84 lat/lng points in meters.

    Standard haversine — accurate to ~0.5% globally and well below the
    noise floor at campus scale (≪1 m of error per kilometer).
    """
    rlat1 = math.radians(lat1)
    rlat2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    h = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def proximity_weight(distance_m: float) -> float:
    """
    Softmax-friendly weight: `exp(-distance_m / WEIGHT_DECAY_SCALE_M)`.

    Always strictly in (0, 1]. Caller is responsible for cutting off
    pairs whose distance exceeds `MAX_DISTANCE_M`.
    """
    return math.exp(-distance_m / WEIGHT_DECAY_SCALE_M)


def build_matrix(
    lots: list[LotPoint], buildings: list[BuildingPoint]
) -> list[ProximityRow]:
    """
    Pure compute step: produce the (lot × building) rows that survive
    the `MAX_DISTANCE_M` cutoff. Sorted by (lot_id, building_id) for
    deterministic upserts — useful both for tests and for keeping
    EXPLAIN plans on the upsert stable.
    """
    rows: list[ProximityRow] = []
    for lot in lots:
        for b in buildings:
            d = haversine_meters(lot.lat, lot.lng, b.lat, b.lng)
            if d > MAX_DISTANCE_M:
                continue
            rows.append(
                ProximityRow(
                    lot_id=lot.id,
                    building_id=b.id,
                    distance_m=d,
                    weight=proximity_weight(d),
                )
            )
    rows.sort(key=lambda r: (r.lot_id, r.building_id))
    return rows


# ─── DB plumbing ──────────────────────────────────────────────────────


def _resolve_school_ids(conn, short_name: Optional[str]) -> list[tuple[str, str]]:
    """
    Returns `[(school_id, short_name), ...]`. If `short_name` is
    provided, restricts to that one school (and raises if it doesn't
    exist — silent skipping would mask typos).
    """
    with conn.cursor() as cur:
        if short_name:
            cur.execute(
                "SELECT id, short_name FROM schools WHERE short_name = %s",
                (short_name,),
            )
            rows = cur.fetchall()
            if not rows:
                raise ValueError(f"No school with short_name={short_name!r}")
            return [(rid, sn) for rid, sn in rows]
        cur.execute("SELECT id, short_name FROM schools ORDER BY short_name")
        return [(rid, sn) for rid, sn in cur.fetchall()]


def _fetch_lots(conn, school_id: str) -> list[LotPoint]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, center_lat, center_lng
            FROM lots
            WHERE school_id = %s
            """,
            (school_id,),
        )
        return [LotPoint(id=r[0], lat=r[1], lng=r[2]) for r in cur.fetchall()]


def _fetch_buildings(conn, school_id: str) -> list[BuildingPoint]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, center_lat, center_lng
            FROM buildings
            WHERE school_id = %s
            """,
            (school_id,),
        )
        return [BuildingPoint(id=r[0], lat=r[1], lng=r[2]) for r in cur.fetchall()]


def _upsert_rows(
    conn, school_id: str, rows: list[ProximityRow]
) -> tuple[int, int, int]:
    """
    Upserts every row in `rows` and deletes any pre-existing
    (lot, building) keys for `school_id` not present in the new set.

    Returns `(inserted, updated, deleted)`.

    The insert/update split is decided by `xmax = 0` — Postgres'
    standard idiom for "this row was a fresh INSERT in this statement"
    (xmax is the deleting/locking xid; freshly-inserted tuples have it
    zero). Cleaner than RULE/trigger gymnastics.
    """
    if not rows:
        # No lots OR no buildings within range. Still need to clear any
        # stale rows for this school.
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM lot_building_proximity WHERE school_id = %s",
                (school_id,),
            )
            return (0, 0, cur.rowcount)

    sql = """
    INSERT INTO lot_building_proximity
        (lot_id, building_id, school_id, distance_m, weight, computed_at)
    VALUES %s
    ON CONFLICT (lot_id, building_id) DO UPDATE SET
        school_id   = EXCLUDED.school_id,
        distance_m  = EXCLUDED.distance_m,
        weight      = EXCLUDED.weight,
        computed_at = EXCLUDED.computed_at
    RETURNING (xmax = 0) AS inserted
    """
    payload = [
        (r.lot_id, r.building_id, school_id, r.distance_m, r.weight)
        for r in rows
    ]
    template = "(%s, %s, %s, %s, %s, NOW())"
    with conn.cursor() as cur:
        results = execute_values(cur, sql, payload, template=template, fetch=True)

    inserted = sum(1 for (is_insert,) in results if is_insert)
    updated = len(results) - inserted

    # Delete any (lot, building) rows for this school whose key is no
    # longer in the freshly-computed set. Building demolition / lot
    # closure / building moved out of 500 m → row goes away.
    keys = [(r.lot_id, r.building_id) for r in rows]
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM lot_building_proximity
            WHERE school_id = %s
              AND (lot_id, building_id) NOT IN %s
            """,
            (school_id, tuple(keys)),
        )
        deleted = cur.rowcount

    return (inserted, updated, deleted)


# ─── Orchestration ────────────────────────────────────────────────────


def run(school_short_name: Optional[str] = None) -> dict:
    """Top-level orchestration; returns the dict to be emitted as ML_RESULT."""
    logger.info(
        "Building proximity matrix (school=%s)", school_short_name or "ALL"
    )

    by_school: list[dict] = []
    totals = {"inserted": 0, "updated": 0, "deleted": 0, "pairs": 0}

    with get_connection() as conn:
        targets = _resolve_school_ids(conn, school_short_name)
        for school_id, short_name in targets:
            lots = _fetch_lots(conn, school_id)
            buildings = _fetch_buildings(conn, school_id)
            rows = build_matrix(lots, buildings)
            inserted, updated, deleted = _upsert_rows(conn, school_id, rows)
            by_school.append(
                {
                    "school": short_name,
                    "lots": len(lots),
                    "buildings": len(buildings),
                    "pairs": len(rows),
                    "rows_inserted": inserted,
                    "rows_updated": updated,
                    "rows_deleted": deleted,
                }
            )
            totals["inserted"] += inserted
            totals["updated"] += updated
            totals["deleted"] += deleted
            totals["pairs"] += len(rows)
            logger.info(
                "[%s] lots=%d buildings=%d pairs=%d (+%d ~%d -%d)",
                short_name,
                len(lots),
                len(buildings),
                len(rows),
                inserted,
                updated,
                deleted,
            )
        conn.commit()

    return {
        "task": "build_proximity_matrix",
        "schools_processed": len(by_school),
        "pairs_total": totals["pairs"],
        "rows_inserted": totals["inserted"],
        "rows_updated": totals["updated"],
        "rows_deleted": totals["deleted"],
        "per_school": by_school,
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--school",
        help="Restrict to a single school by short_name (default: all).",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    metadata = run(args.school)
    print("ML_RESULT: " + json.dumps(metadata))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
