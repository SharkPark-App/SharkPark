"""
D2: Refresh `room_capacities` and `Building` reference data from CSULB
Academic Scheduling pages.

Why this script exists
----------------------
The catalog ingest (``ingest_csulb_catalog.py``) needs (BUILDING, ROOM) →
seat-count to estimate per-section enrollment. CSULB publishes that data
free on two public pages — but it changes every term as registrar
re-allocates rooms, adds new active-learning conversions, and tweaks
auditorium seat counts. Hard-coding from a CSV would go stale within a
semester. So this script re-scrapes weekly and upserts into the DB.

Sources
-------
1. ``/enrollment-services/faculty-and-staff-resources/academic-scheduling``
   — single page that contains four reference tables:

     * **Building Codes** (58 rows) — Building Code | Abbreviation |
       Building Name | Location. Used to refresh
       ``Building.alternate_names`` so newly-added building codes are
       recognized by the catalog parser.
     * **Auditorium Classroom List** (~25 rows) — Building | Room | Seats.
       Source = ``auditorium``.
     * **Active Learning Classrooms** (~7 rows) — Building | Room Number |
       Seats | Scheduling Priority. Source = ``active-learning``.
     * **Rooms the Conflict Checking Turned Off** (~33 rows) — Building |
       Room | Facility ID | Room Type | Capacity. Source =
       ``conflict-off-{room_type_slug}`` so downstream code can preserve
       the room-type signal (lab/music/outdoor/studio/etc.).

2. ``/student-records/{spring|fall}-lecture-room-allocations`` — term-
   specific page with a flat table of every room allocated to a college
   for general lecture use this term. Columns: TIME | BUILDING | ROOM |
   CAP | COLLEGE | COMMENTS. Same room appears multiple times (once per
   college that holds it); we dedup by (building, room) taking the MAX
   capacity. Source = ``lecture-allocation``.

   Summer page is not published as a separate URL; summer schedule reuses
   the most recent fall/spring allocation. The script picks the URL based
   on ``get_semester(today)`` and falls back to spring if the term page
   404s.

Outdoor / PE-range rooms
------------------------
The conflict-off table includes outdoor practice fields (PETC pool,
softball range, etc.) with no fixed capacity. They are stored with
``capacity = 999`` (sentinel); the catalog ingest's enrollment fallback
treats 999 as "no real room data" and falls through to the per-course-
type default.

Idempotency
-----------
Each run does ``INSERT ... ON CONFLICT (school_id, building_code, room)
DO UPDATE SET capacity, source, fetched_at``. There is no operator-wins
clause: every row in this table is sourced from the public scrape, so a
fresh scrape always represents truth. (The operator-wins escape hatch
lives in ``section_enrollment_overrides``, which is a different table
and is the right place for manual corrections.)

Failure tolerance
-----------------
If any one source page fails (404, timeout, parse error), the script
logs a WARNING and *continues* with the remaining sources. Existing
rows for the missing source remain in the DB (they are not deleted),
so a transient page outage cannot wipe reference data. ``ML_RESULT``
records ``pages_failed`` for observability.

Output marker
-------------
Final stdout line: ``ML_RESULT: {...}`` consumed by CronRunnerService.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, Optional

import requests
from bs4 import BeautifulSoup, Tag
from psycopg2.extras import execute_values

from src.academic_calendar import get_semester
from src.data.db import get_connection, _generate_cuid

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────

ACADEMIC_SCHEDULING_URL = (
    "https://www.csulb.edu/enrollment-services/"
    "faculty-and-staff-resources/academic-scheduling"
)
LECTURE_ALLOCATION_URL = (
    "https://www.csulb.edu/student-records/{semester}-lecture-room-allocations"
)

USER_AGENT = (
    "SharkPark-RoomCapacity-Ingest/1.0 "
    "(+https://github.com/SharkPark-App/SharkPark; CSULB Senior Capstone)"
)

# Sentinel capacity used for outdoor / PE-range / non-classroom rooms
# from the conflict-off table that have no fixed seat count. The catalog
# ingest treats this value as "no real room data" and falls through to
# per-course-type defaults.
OUTDOOR_CAPACITY_SENTINEL = 999

# Substrings in the conflict-off "Room Type" column that mark a room as
# outdoor / unbounded capacity. Anything matching these gets the sentinel
# capacity regardless of the published number (which is often 0 or blank).
OUTDOOR_ROOM_TYPE_MARKERS = ("outdoor", "field", "range", "pool", "court")

# Captions used to identify each table on the academic-scheduling page.
# Match is substring/case-insensitive so minor copy edits ("Active
# Learning Classrooms List") don't break the parser.
CAPTION_AUDITORIUM = "auditorium classroom"
CAPTION_ACTIVE_LEARNING = "active learning"
CAPTION_CONFLICT_OFF = "conflict checking turned off"
CAPTION_BUILDING_CODES = "building codes"

# Term-from-semester for the lecture-allocations URL. CSULB doesn't
# publish a separate page per intersession (winter / summer) or break,
# so those terms reuse the nearest primary-term page — the building
# code + capacity tables don't change between intersession and the
# primary term they run inside, so this fallback is safe. The
# ``ML_RESULT`` payload records the original semester so the operator
# can see when a winter run scraped the spring page.
LECTURE_PAGE_SEMESTER = {
    "fall": "fall",
    "spring": "spring",
    "summer": "spring",
    "session": "spring",
    "break": "fall",
}

#: Semesters whose own page doesn't exist on the CSULB site — mapped
#: above to whichever primary term shares its calendar slot.
LOW_ACTIVITY_SEMESTERS = frozenset({"summer", "session", "break"})

# Auto-derived `Building.classroom_profile` buckets. Each (building_code)
# group's rooms are bucketed individually; a building with rooms in only
# one bucket gets that profile, otherwise MIXED. The catalog ingest reads
# these profiles to pick a sane enrollment default when it sees a section
# meeting in a known building but unknown room. Outdoor sentinel rooms
# (cap == OUTDOOR_CAPACITY_SENTINEL) are excluded from the calculation.
PROFILE_BUCKETS: tuple[tuple[int, str], ...] = (
    # (upper_bound_inclusive, profile_name) — first match wins.
    (24, "SEMINAR"),
    (50, "STANDARD"),
    (80, "ACTIVE"),
)
PROFILE_BUCKET_LARGE = "LECTURE_HALL"  # > 80 seats
PROFILE_MIXED = "MIXED"


# ─── Data classes ─────────────────────────────────────────────────────


@dataclass
class CapacityRow:
    building_code: str
    room: str
    capacity: int
    source: str


@dataclass
class BuildingCodeRow:
    code: str           # 3-digit numeric code (e.g. "020")
    abbreviation: str   # 3-letter alpha code (e.g. "AS")
    name: str           # full name (e.g. "Academic Services")


@dataclass
class ScrapeResult:
    rows: list[CapacityRow] = field(default_factory=list)
    buildings: list[BuildingCodeRow] = field(default_factory=list)
    pages_failed: list[str] = field(default_factory=list)


# ─── HTTP fetch ───────────────────────────────────────────────────────


def _build_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html"})
    return s


def _fetch_html(session: requests.Session, url: str, retries: int = 2) -> Optional[str]:
    """
    Fetch a URL, returning HTML body or ``None`` on permanent 404.

    Other transient failures are retried once with linear backoff before
    raising. The caller (``_scrape``) translates exceptions into a
    ``pages_failed`` entry so a single bad page doesn't abort the whole
    run.
    """
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            resp = session.get(url, timeout=30)
            if resp.status_code == 404:
                logger.warning("404 at %s (treated as missing source)", url)
                return None
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(1.0 + attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_exc}")


# ─── HTML parsing ─────────────────────────────────────────────────────


_ROOM_SUFFIX_RE = re.compile(r"[*\s]+$")


def _normalize_building(raw: str) -> str:
    return raw.strip().upper()


def _normalize_room(raw: str) -> str:
    """Strip ``*`` suffix, trim whitespace, uppercase."""
    return _ROOM_SUFFIX_RE.sub("", raw.strip()).upper()


def _parse_int(raw: str) -> Optional[int]:
    """Parse an integer from a possibly-messy cell value (e.g. ``'48 '``)."""
    if raw is None:
        return None
    txt = raw.strip().replace(",", "")
    if not txt:
        return None
    try:
        return int(txt)
    except ValueError:
        # Fall back to extracting the leading digits ("48 fixed" → 48)
        m = re.match(r"\d+", txt)
        return int(m.group(0)) if m else None


def _find_table_by_caption(soup: BeautifulSoup, caption_substring: str) -> Optional[Tag]:
    """Return the first ``<table>`` whose caption contains ``caption_substring`` (CI)."""
    needle = caption_substring.lower()
    for table in soup.find_all("table"):
        caption = table.find("caption")
        if caption and needle in caption.get_text(strip=True).lower():
            return table
    return None


def _table_headers(table: Tag) -> list[str]:
    """
    Return the lowercased text of the table's *own* header cells.

    We deliberately look only at the direct ``thead > tr > th`` children
    rather than ``select('thead th')`` so that wrapper tables on the
    lecture-allocation page (which embed the real data table inside an
    outer ``<table><thead><tr><th>...inner table...``) don't pollute the
    header list with descendant headers.
    """
    thead = table.find("thead", recursive=False)
    if thead is None:
        return []
    headers: list[str] = []
    for tr in thead.find_all("tr", recursive=False):
        for th in tr.find_all("th", recursive=False):
            # If this `<th>` itself contains a nested table, the cell is
            # a layout wrapper (not a real header); ignore it.
            if th.find("table") is not None:
                continue
            headers.append(th.get_text(strip=True).lower())
    return headers


def _table_body_rows(table: Tag) -> list[list[str]]:
    """Return ``<tbody>`` rows as list-of-lists of cell text."""
    rows: list[list[str]] = []
    tbody = table.find("tbody")
    if tbody is None:
        return rows
    for tr in tbody.find_all("tr", recursive=False):
        cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"], recursive=False)]
        if cells:
            rows.append(cells)
    return rows


def _column_indexes(headers: list[str], required: dict[str, tuple[str, ...]]) -> dict[str, int]:
    """
    Map logical column names to header indexes by substring match.

    ``required`` maps a logical name (e.g. ``'building'``) to a tuple of
    acceptable substrings (e.g. ``('building',)``). Raises
    ``ValueError`` if any required column is missing — the caller catches
    this and logs the source as failed.
    """
    out: dict[str, int] = {}
    for logical, candidates in required.items():
        idx: Optional[int] = None
        for i, header in enumerate(headers):
            if any(c in header for c in candidates):
                idx = i
                break
        if idx is None:
            raise ValueError(
                f"missing column {logical!r} (looked for {candidates}); "
                f"got headers={headers}"
            )
        out[logical] = idx
    return out


def _parse_capacity_table(
    table: Tag,
    *,
    source: str,
    capacity_col_candidates: tuple[str, ...] = ("cap", "seats"),
    use_room_type_for_source: bool = False,
) -> list[CapacityRow]:
    """
    Parse a (Building, Room, Capacity) table.

    Args:
        table: ``<table>`` element with ``<thead>`` + ``<tbody>``.
        source: Fixed source label, OR the *prefix* if
            ``use_room_type_for_source`` is True (then a per-row room-type
            slug is appended).
        capacity_col_candidates: substrings to match the capacity header
            (the auditorium/active-learning pages use ``Seats``; the
            lecture-allocation page uses ``Cap``).
        use_room_type_for_source: when True, expects a ``Room Type``
            column and uses ``conflict-off-{slug}`` as source. Outdoor
            room types also override the parsed capacity to the sentinel.
    """
    headers = _table_headers(table)
    required: dict[str, tuple[str, ...]] = {
        "building": ("building",),
        "room": ("room",),
        "capacity": capacity_col_candidates,
    }
    if use_room_type_for_source:
        required["room_type"] = ("room type", "type")
    cols = _column_indexes(headers, required)

    rows: list[CapacityRow] = []
    for cells in _table_body_rows(table):
        if len(cells) <= max(cols.values()):
            continue

        building = _normalize_building(cells[cols["building"]])
        room = _normalize_room(cells[cols["room"]])
        if not building or not room:
            continue

        capacity = _parse_int(cells[cols["capacity"]])
        row_source = source

        if use_room_type_for_source:
            room_type_raw = cells[cols["room_type"]].strip()
            slug = _slugify_room_type(room_type_raw)
            row_source = f"{source}-{slug}" if slug else source
            if any(m in room_type_raw.lower() for m in OUTDOOR_ROOM_TYPE_MARKERS):
                capacity = OUTDOOR_CAPACITY_SENTINEL

        if capacity is None or capacity <= 0:
            # Conflict-off table sometimes has blank capacity for
            # specialty rooms — drop those rather than store a meaningless
            # zero. (Outdoor rows already got the sentinel above.)
            continue

        rows.append(CapacityRow(
            building_code=building, room=room,
            capacity=capacity, source=row_source,
        ))
    return rows


def _slugify_room_type(raw: str) -> str:
    """``'Studio - art'`` → ``'studio'``; ``'Outdoor field'`` → ``'outdoor'``."""
    txt = raw.strip().lower()
    if not txt:
        return ""
    # Take the first word/segment as the canonical slug so
    # ``conflict-off-lab`` covers "Lab", "Lab - chem", "Lab- bio", etc.
    first = re.split(r"[\s\-/]+", txt, maxsplit=1)[0]
    return re.sub(r"[^a-z0-9]+", "", first)


def _parse_building_codes_table(table: Tag) -> list[BuildingCodeRow]:
    """Parse the Building Codes table into BuildingCodeRow records."""
    headers = _table_headers(table)
    cols = _column_indexes(headers, {
        "code": ("building code", "code"),
        "abbreviation": ("abbreviation", "abbrev"),
        "name": ("building name", "name"),
    })

    out: list[BuildingCodeRow] = []
    for cells in _table_body_rows(table):
        if len(cells) <= max(cols.values()):
            continue
        code = cells[cols["code"]].strip()
        abbr = cells[cols["abbreviation"]].strip().upper()
        name = cells[cols["name"]].strip()
        if not abbr or not name:
            continue
        out.append(BuildingCodeRow(code=code, abbreviation=abbr, name=name))
    return out


# ─── Source-by-source scrape ──────────────────────────────────────────


def _scrape_academic_scheduling_page(
    session: requests.Session, result: ScrapeResult
) -> None:
    """Fetch + parse all four tables on the academic-scheduling page."""
    try:
        html = _fetch_html(session, ACADEMIC_SCHEDULING_URL)
    except Exception as exc:
        logger.error("Academic scheduling page fetch failed: %s", exc)
        result.pages_failed.append(ACADEMIC_SCHEDULING_URL)
        return
    if html is None:
        result.pages_failed.append(ACADEMIC_SCHEDULING_URL)
        return

    soup = BeautifulSoup(html, "lxml")

    # Each table is parsed independently — one bad table doesn't kill the
    # others.
    for caption, source, room_type_mode, label in [
        (CAPTION_AUDITORIUM, "auditorium", False, "auditorium"),
        (CAPTION_ACTIVE_LEARNING, "active-learning", False, "active-learning"),
        (CAPTION_CONFLICT_OFF, "conflict-off", True, "conflict-off"),
    ]:
        table = _find_table_by_caption(soup, caption)
        if table is None:
            logger.warning("Table %r not found on academic-scheduling page", caption)
            result.pages_failed.append(f"{ACADEMIC_SCHEDULING_URL}#{label}")
            continue
        try:
            parsed = _parse_capacity_table(
                table, source=source, capacity_col_candidates=("cap", "seats"),
                use_room_type_for_source=room_type_mode,
            )
        except ValueError as exc:
            logger.warning("Failed to parse %s table: %s", label, exc)
            result.pages_failed.append(f"{ACADEMIC_SCHEDULING_URL}#{label}")
            continue
        logger.info("Parsed %d rows from %s table", len(parsed), label)
        result.rows.extend(parsed)

    # Building codes
    bc_table = _find_table_by_caption(soup, CAPTION_BUILDING_CODES)
    if bc_table is None:
        logger.warning("Building codes table not found on academic-scheduling page")
        result.pages_failed.append(f"{ACADEMIC_SCHEDULING_URL}#building-codes")
    else:
        try:
            buildings = _parse_building_codes_table(bc_table)
        except ValueError as exc:
            logger.warning("Failed to parse building codes table: %s", exc)
            result.pages_failed.append(f"{ACADEMIC_SCHEDULING_URL}#building-codes")
        else:
            logger.info("Parsed %d building codes", len(buildings))
            result.buildings.extend(buildings)


def _scrape_lecture_allocations(
    session: requests.Session, result: ScrapeResult, semester: str
) -> None:
    """Fetch + parse the (term-specific) lecture-room-allocations page."""
    page_semester = LECTURE_PAGE_SEMESTER.get(semester, "spring")
    url = LECTURE_ALLOCATION_URL.format(semester=page_semester)

    try:
        html = _fetch_html(session, url)
    except Exception as exc:
        logger.error("Lecture allocations fetch failed: %s", exc)
        result.pages_failed.append(url)
        return
    if html is None:
        result.pages_failed.append(url)
        return

    soup = BeautifulSoup(html, "lxml")

    # The lecture-allocations page nests the data table inside an outer
    # wrapper table (one row, one cell, one inner table). We find by
    # header signature instead of caption since the inner table has no
    # caption of its own.
    target: Optional[Tag] = None
    for table in soup.find_all("table"):
        headers = _table_headers(table)
        if "building" in headers and "room" in headers and "cap" in headers:
            target = table
            break
    if target is None:
        logger.warning("Lecture-allocation table not found at %s", url)
        result.pages_failed.append(url)
        return

    try:
        parsed = _parse_capacity_table(
            target, source="lecture-allocation",
            capacity_col_candidates=("cap",),
        )
    except ValueError as exc:
        logger.warning("Failed to parse lecture-allocation table: %s", exc)
        result.pages_failed.append(url)
        return

    logger.info("Parsed %d rows from lecture-allocation table", len(parsed))
    result.rows.extend(parsed)


# ─── Dedup ────────────────────────────────────────────────────────────


# Source priority order: when the same (building, room) appears in
# multiple source tables, the higher-priority source wins. Conflict-off
# is the most specific (registrar's manual list of rooms with known
# special handling) so it wins; lecture-allocation is the broadest catch-
# all so it loses ties. Within a priority bucket, MAX capacity wins
# (lecture-allocation lists the same room once per college; pick the
# largest published number).
_SOURCE_PRIORITY = {
    "conflict-off": 100,  # any conflict-off-* prefix → handled below
    "auditorium": 80,
    "active-learning": 70,
    "lecture-allocation": 50,
}


def _source_priority(source: str) -> int:
    if source.startswith("conflict-off"):
        return _SOURCE_PRIORITY["conflict-off"]
    return _SOURCE_PRIORITY.get(source, 0)


def _dedup(rows: Iterable[CapacityRow]) -> list[CapacityRow]:
    """Dedup by (building, room): higher source-priority wins, then MAX capacity."""
    best: dict[tuple[str, str], CapacityRow] = {}
    for row in rows:
        key = (row.building_code, row.room)
        existing = best.get(key)
        if existing is None:
            best[key] = row
            continue
        new_p = _source_priority(row.source)
        old_p = _source_priority(existing.source)
        if new_p > old_p:
            best[key] = row
        elif new_p == old_p and row.capacity > existing.capacity:
            best[key] = row
    return list(best.values())


# ─── Database upsert ──────────────────────────────────────────────────


def _resolve_school_id(conn) -> str:
    """Look up the (single, for now) CSULB school row's id.

    The ``schools`` table uses ``short_name`` (Prisma field) for the
    school code; an earlier draft of this script queried ``acronym``,
    which never existed in the production schema.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM schools WHERE short_name = 'CSULB' LIMIT 1")
        row = cur.fetchone()
    if not row:
        raise RuntimeError("No CSULB school row found in `schools` table")
    return row[0]


def _upsert_capacities(
    conn, school_id: str, rows: list[CapacityRow]
) -> tuple[int, int]:
    """
    Upsert ``rows`` into ``room_capacities``.

    Returns ``(inserted, updated)`` counts. We use ``RETURNING (xmax = 0)``
    to distinguish inserts (xmax==0) from updates (xmax!=0) — standard
    Postgres trick for execute_values upserts.
    """
    if not rows:
        return (0, 0)

    payload = [
        (_generate_cuid(), school_id, r.building_code, r.room, r.capacity, r.source)
        for r in rows
    ]

    sql = """
        INSERT INTO room_capacities
            (id, school_id, building_code, room, capacity, source, fetched_at)
        VALUES %s
        ON CONFLICT (school_id, building_code, room) DO UPDATE SET
            capacity   = EXCLUDED.capacity,
            source     = EXCLUDED.source,
            fetched_at = NOW()
        RETURNING (xmax = 0) AS inserted
    """
    template = "(%s, %s, %s, %s, %s, %s, NOW())"
    with conn.cursor() as cur:
        results = execute_values(cur, sql, payload, template=template, fetch=True)
    inserted = sum(1 for (is_insert,) in results if is_insert)
    updated = len(results) - inserted
    return (inserted, updated)


# ─── classroom_profile auto-derivation ────────────────────────────────


def _bucket_capacity(capacity: int) -> str:
    """
    Map a single room capacity to a `ClassroomProfile` enum bucket.

    Boundaries match the catalog ingest's `BUILDING_PROFILE_DEFAULTS`
    median targets: SEMINAR≤24, STANDARD 25–50, ACTIVE 51–80, LECTURE_HALL >80.
    """
    for upper, name in PROFILE_BUCKETS:
        if capacity <= upper:
            return name
    return PROFILE_BUCKET_LARGE


def _resolve_profile(buckets: Iterable[str]) -> Optional[str]:
    """
    Decide a single `ClassroomProfile` for a building from its rooms' buckets.

    All rooms in one bucket → that bucket. Two or more distinct buckets →
    MIXED (catalog ingest deliberately falls through MIXED to the per-
    course-type default since the building's room mix gives no useful
    signal). Empty input → None (caller should leave profile NULL).
    """
    distinct = {b for b in buckets}
    if not distinct:
        return None
    if len(distinct) == 1:
        return next(iter(distinct))
    return PROFILE_MIXED


def _derive_building_profiles(conn, school_id: str) -> int:
    """
    Set `Building.classroom_profile` for every building that has at least
    one (non-outdoor-sentinel) row in `room_capacities`.

    Uses `Building.alternate_names` to map building_code → building_id
    (same UNNEST trick the catalog ingest uses). Buildings whose profile
    already matches the derived value are skipped (no-op UPDATE) to keep
    the row's `updated_at` honest. Returns the number of rows actually
    written.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT building_code, capacity
            FROM room_capacities
            WHERE school_id = %s AND capacity < %s
            """,
            (school_id, OUTDOOR_CAPACITY_SENTINEL),
        )
        rows = cur.fetchall()

    by_code: dict[str, list[str]] = defaultdict(list)
    for code, cap in rows:
        by_code[code.strip().upper()].append(_bucket_capacity(cap))

    if not by_code:
        return 0

    # Resolve building_code → (building_id, current profile) via aliases.
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT b.id, b.classroom_profile, alias
            FROM buildings b, UNNEST(b.alternate_names) AS alias
            WHERE b.school_id = %s
            """,
            (school_id,),
        )
        alias_rows = cur.fetchall()

    alias_to_building: dict[str, tuple[str, Optional[str]]] = {
        alias.strip().upper(): (bid, profile)
        for bid, profile, alias in alias_rows
        if alias
    }

    # Group room buckets by building_id (a building may have multiple
    # aliases pointing at it; merge their bucket lists).
    by_building: dict[str, tuple[Optional[str], list[str]]] = {}
    for code, buckets in by_code.items():
        match = alias_to_building.get(code)
        if match is None:
            # building_code from scrape isn't a known alias yet — the
            # _refresh_building_aliases pass earlier in this run will
            # have added it if there's a name match, so this branch is
            # the "truly unknown building" case. Skip silently.
            continue
        bid, current = match
        existing = by_building.get(bid)
        if existing is None:
            by_building[bid] = (current, list(buckets))
        else:
            existing[1].extend(buckets)

    updates: list[tuple[str, str]] = []  # (profile, building_id)
    for bid, (current, buckets) in by_building.items():
        derived = _resolve_profile(buckets)
        if derived is None or derived == current:
            continue
        updates.append((derived, bid))

    if updates:
        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE buildings SET classroom_profile = %s WHERE id = %s",
                updates,
            )
    return len(updates)


def _refresh_building_aliases(
    conn, school_id: str, buildings: list[BuildingCodeRow]
) -> int:
    """
    Add scraped abbreviations to ``Building.alternate_names`` where they
    are missing. We never *remove* aliases (operators may have curated
    additional ones in the seed) and we never create new buildings (those
    are managed in the seed file with lat/lng). Returns the number of
    buildings whose alternate_names array was extended.

    Match key: case-insensitive containment of the official name in
    ``Building.name`` OR exact-match against an existing alias.
    """
    if not buildings:
        return 0

    # Load existing buildings once
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, alternate_names FROM buildings WHERE school_id = %s",
            (school_id,),
        )
        existing = cur.fetchall()  # [(id, name, alternate_names[]), ...]

    name_to_row = {row[1].lower(): row for row in existing}
    alias_to_row: dict[str, tuple] = {}
    for row in existing:
        for alias in (row[2] or []):
            alias_to_row[alias.upper()] = row

    updates: list[tuple[list[str], str]] = []  # (new_aliases, building_id)
    extended = 0
    for b in buildings:
        match = alias_to_row.get(b.abbreviation.upper())
        if match is None:
            # Try matching by name (full or substring either direction)
            for nm_key, row in name_to_row.items():
                if nm_key == b.name.lower() or b.name.lower() in nm_key or nm_key in b.name.lower():
                    match = row
                    break
        if match is None:
            # Building not in DB — skip silently (seed file owns the
            # canonical building list with coordinates).
            continue

        building_id, _, current_aliases = match
        current_set = {a.upper() for a in (current_aliases or [])}
        if b.abbreviation.upper() in current_set:
            continue
        new_aliases = list(current_aliases or []) + [b.abbreviation]
        updates.append((new_aliases, building_id))
        extended += 1

    if updates:
        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE buildings SET alternate_names = %s WHERE id = %s",
                updates,
            )
    return extended


# ─── Main orchestration ───────────────────────────────────────────────


def _scrape(semester: str) -> ScrapeResult:
    session = _build_session()
    result = ScrapeResult()
    _scrape_academic_scheduling_page(session, result)
    _scrape_lecture_allocations(session, result, semester)
    return result


def run(semester: Optional[str] = None) -> dict:
    """Top-level orchestration; returns the dict to be emitted as ML_RESULT."""
    sem = semester or get_semester(date.today())
    page_sem = LECTURE_PAGE_SEMESTER.get(sem, "spring")
    if sem in LOW_ACTIVITY_SEMESTERS:
        logger.info(
            "Semester %r has no dedicated lecture-allocations page; "
            "falling back to the %r page.", sem, page_sem,
        )
    logger.info("Starting room capacity ingest for semester=%s", sem)

    raw = _scrape(sem)
    deduped = _dedup(raw.rows)

    by_source: dict[str, int] = defaultdict(int)
    for row in deduped:
        by_source[row.source] += 1

    with get_connection() as conn:
        school_id = _resolve_school_id(conn)
        inserted, updated = _upsert_capacities(conn, school_id, deduped)
        aliases_added = _refresh_building_aliases(conn, school_id, raw.buildings)
        # Profile derivation MUST run after alias refresh so newly-added
        # building_codes resolve to their building_id via UNNEST.
        profiles_updated = _derive_building_profiles(conn, school_id)
        conn.commit()

    metadata = {
        "task": "ingest_room_capacities",
        "semester": sem,
        "rows_scraped": len(raw.rows),
        "rows_after_dedup": len(deduped),
        "rows_inserted": inserted,
        "rows_updated": updated,
        "building_aliases_added": aliases_added,
        "building_profiles_updated": profiles_updated,
        "pages_failed": raw.pages_failed,
        "rows_by_source": dict(by_source),
    }
    if sem in LOW_ACTIVITY_SEMESTERS:
        metadata["low_activity_rollover"] = sem
        metadata["page_semester"] = page_sem
    return metadata


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--semester",
        choices=["fall", "spring", "summer", "session", "break"],
        help="Override semester used to pick the lecture-allocations URL "
             "(default: derived from today via academic_calendar.get_semester)",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    metadata = run(args.semester)
    print("ML_RESULT: " + json.dumps(metadata))

    # Failing the run when ALL pages failed gives the cron monitor a
    # signal; partial failures (some pages OK) still exit 0 so the
    # successful sources are persisted.
    if metadata["pages_failed"] and metadata["rows_inserted"] + metadata["rows_updated"] == 0:
        logger.error("All source pages failed; no rows persisted.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
