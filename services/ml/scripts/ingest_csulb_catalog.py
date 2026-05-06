"""
D2: Ingest CSULB public Schedule of Classes → upsert into `course_meetings`.

Why this script exists
----------------------
Synthetic-v2 (D4) needs to know, for each parking lot at each 5-min slice
of a school day, an estimate of how many students just left a classroom
and started walking back to their car. The shape of that signal is driven
by the term schedule: which course meets in which building at which
time. CSULB publishes that schedule for free at:

    https://web.csulb.edu/depts/enrollment/registration/class_schedule/
        {Term}_{Year}/By_Subject/{SUBJ}.html

What the public HTML provides
-----------------------------
- Section number, class number (5-digit ID), course code/title, units
- Course type marker (LEC/LAB/SEM/ACT/SUP) — extracted from class-notes column
- Days (M/Tu/W/Th/F/Sa/Su, single-OR-two-char tokens)
- Time block (e.g. "9:00-9:50 AM"; start AM/PM is *implicit* on the start
  side and inferred from the end side)
- Location string (e.g. "ECS-105", "ONLINE", "TBA")
- Instructor name

What the public HTML does NOT provide
-------------------------------------
- Per-section enrollment count (just a green/blank "seats available" icon)
- Per-section enrollment cap (the number set in PeopleSoft)
- Per-room seat count

The auth-required reports (LBSR0419, Available Rooms Standard Times) on
Ad Astra and CS-Link have all of the above, but scraping them requires
SSO + DUO MFA, would violate CSULB acceptable-use, and would break every
time the session cookie expires. We DON'T do that.

Enrollment estimate — tiered fallback
-------------------------------------
For each parsed section we tag a `room_capacity` and `enrollment` plus an
`enrollment_source` label that's surfaced through /admin/ml-status (F):

    1. `override`         class_number found in `section_enrollment_overrides`
                          DB table (operator-curated). The override row's
                          `enrollment` value wins.
    2. `online`           location is "ONLINE" / "ONLN" / starts with
                          "ONL", or COMMENT cell mentions online. Walking
                          demand is gated to zero downstream; we still
                          store a type-default enrollment for visibility.
    3. `room`             location parsed to a (BUILDING, ROOM) present
                          in `room_capacities` (refreshed weekly by
                          `ingest_room_capacities.py`). Seat count is
                          used as both `room_capacity` and `enrollment`.
                          Outdoor sentinel rows (cap=999) fall through.
    4. `building_profile` location's BUILDING is known and has a
                          `classroom_profile` set on `Building` (auto-
                          derived from per-building median room capacity
                          by the room-capacity ingest), but the specific
                          ROOM is not in `room_capacities`. Pick a
                          per-profile default (STANDARD=40, LECTURE_HALL=
                          150, ACTIVE=38, SEMINAR=20, LAB=24). MIXED is
                          intentionally absent so it falls through.
    5. `type`             neither room nor building profile gives us a
                          number → fall back to per-course-type default
                          (LEC=35, SEM=20, LAB=24, ACT=22, SUP=10).
    6. (`sso`)            reserved for operator-supplied verified
                          PeopleSoft numbers entered directly in the DB;
                          preserved on update like `override`.

Idempotency
-----------
Upsert key is (school_id, term, subject_code, course_code, section). Re-
running mid-term is safe and refreshes everything except the
`enrollment_source` field when the existing row has source='sso' or
'override' — those wins are preserved (operator wins over scraper).

Term selection
--------------
Default = current academic term derived via
`src.academic_calendar.get_semester(date.today())`. Override with
`--term Spring --year 2026`. The script supports historical scrapes for
backfill, but synthetic-v2 only consumes the current term.

Output marker
-------------
Final stdout line: `ML_RESULT: {...}` consumed by CronRunnerService.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Iterable, Optional

import psycopg2
import requests
from bs4 import BeautifulSoup
from cuid2 import cuid_wrapper
from psycopg2.extras import execute_values

from src.academic_calendar import get_semester
from src.data.db import get_connection

logger = logging.getLogger(__name__)

_generate_cuid = cuid_wrapper()

# ─── Constants ────────────────────────────────────────────────────────

SCHEDULE_BASE = (
    "https://web.csulb.edu/depts/enrollment/registration/class_schedule"
)
SUBJECT_INDEX_URL = SCHEDULE_BASE + "/{term}_{year}/By_Subject/index.html"
SUBJECT_PAGE_URL = SCHEDULE_BASE + "/{term}_{year}/By_Subject/{subject}.html"

# Per-spec D2: type-based default enrollments (used when we don't have a
# room capacity for the section's location). Numbers come from CSULB's
# public Lecture Room Allocation median (~35) and per-college lab seating
# (~24); SUP=10 is intentionally small because most SUP sections are
# directed-study and don't physically meet.
TYPE_DEFAULT_ENROLLMENT = {
    "LECTURE": 35,
    "LAB": 24,
    "SEMINAR": 20,
    "ACTIVITY": 22,
    "SUPPLEMENTAL": 10,
}

# Course-type marker → enum value. Markers come from the Class Notes
# column on the CSULB schedule HTML.
COURSE_TYPE_MARKERS = {
    "LEC": "LECTURE",
    "LAB": "LAB",
    "SEM": "SEMINAR",
    "ACT": "ACTIVITY",
    "SUP": "SUPPLEMENTAL",
}

# Day-token mask bits (matches schema docstring on CourseMeeting.days_mask).
DAY_BITS = {
    "M": 1,
    "Tu": 2,
    "W": 4,
    "Th": 8,
    "F": 16,
    "Sa": 32,
    "Su": 64,
}
# Two-char codes MUST be matched first to avoid greedy single-char misreads.
DAY_TOKEN_RE = re.compile(r"Tu|Th|Sa|Su|M|W|F")

# Time block regex — tolerates "9:00-9:50AM" / "9:00 - 9:50 AM" /
# "2-3:15PM" (start minutes omitted) / "2:00 PM- 4:30 PM" etc. The end
# AM/PM marker is REQUIRED; CSULB always emits it on the end side.
TIME_RE = re.compile(
    r"(?P<sh>\d{1,2})(?::(?P<sm>\d{2}))?"
    r"\s*-\s*"
    r"(?P<eh>\d{1,2}):(?P<em>\d{2})"
    r"\s*(?P<ampm>[AaPp][Mm])"
)

# Location like "ECS-105" / "VEC-516A" / "OLN-XX" / "ONLINE" / "TBA".
LOCATION_RE = re.compile(r"^([A-Z][A-Z0-9]*)[-\s]([A-Z0-9]+)$")

# Tokens that appear in the LOCATION column for non-physical sections.
# CSULB uses "ONLINE-ONLY" today; the bare forms are kept for forward-
# compat in case the registrar normalizes the spelling.
ONLINE_TOKENS = {
    "ONLINE", "ONLINE-ONLY", "ONLN", "ON-LINE",
    "ASYNC", "SYNC-ONLINE, NA",
}
TBA_TOKENS = {"TBA", "TBD", "ARRANGED", "ARR"}

# Substrings in the COMMENT column ([11]) that mark a section as online
# even when the LOCATION column has a building name (rare hybrid case).
ONLINE_COMMENT_MARKERS = ("online", "asynch", "synch. online")

# CSULB term names. Winter and any future intersession-only term are not
# published as separate catalog pages on the CSULB schedule site, so
# `_resolve_term` rolls them forward to the next primary term and the
# resulting metadata records that the run was a low-activity rollover.
TERM_FROM_SEMESTER = {
    "fall": "Fall",
    "spring": "Spring",
    "summer": "Summer",
}

#: Semesters that don't have their own published catalog page. Cron runs
#: that land on these still ingest — they roll forward to the next
#: primary term — but the result metadata flags it so the operator can
#: distinguish a regular Spring run from a winter-intersession rollover.
LOW_ACTIVITY_SEMESTERS = frozenset({"winter", "session", "break"})

USER_AGENT = (
    "SharkPark-Catalog-Ingest/1.0 "
    "(+https://github.com/SharkPark-App/SharkPark; CSULB Senior Capstone)"
)

# Per-`Building.classroom_profile` enrollment defaults, used as the 4th
# fallback tier when we know the building but not the specific room.
# Profiles are auto-derived from the median room capacity per building by
# `ingest_room_capacities.py`. MIXED is intentionally absent here so that
# multi-bucket buildings fall through to the per-course-type default
# (more accurate than guessing one number for "could be anything").
BUILDING_PROFILE_DEFAULTS = {
    "STANDARD": 40,
    "LECTURE_HALL": 150,
    "ACTIVE": 38,
    "SEMINAR": 20,
    "LAB": 24,
}


# ─── HTTP fetch ───────────────────────────────────────────────────────


def _build_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html"})
    return s


def _fetch_html(session: requests.Session, url: str, retries: int = 2) -> Optional[str]:
    """
    Fetch a URL, returning HTML body or None on permanent 404.

    404 is the signal that a subject doesn't exist in the chosen term
    (e.g. CECS only offered in Fall) — we treat that as "skip", not error.
    Any other failure is retried once with linear backoff before raising.
    """
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            resp = session.get(url, timeout=30)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(1.0 + attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_exc}")


def _discover_subjects(session: requests.Session, term: str, year: int) -> list[str]:
    """
    Discover the list of subject codes published for the term.

    The schedule index page lists every subject as a relative anchor
    href like `CECS.html`. Pulling them dynamically means we never have
    to maintain a hand-curated subject list as CSULB adds/removes
    departments.
    """
    url = SUBJECT_INDEX_URL.format(term=term, year=year)
    html = _fetch_html(session, url)
    if html is None:
        raise RuntimeError(
            f"Subject index 404 at {url}. Check --term/--year arguments; "
            f"valid terms are {sorted(TERM_FROM_SEMESTER.values())}."
        )
    soup = BeautifulSoup(html, "lxml")
    subjects: set[str] = set()
    for a in soup.find_all("a", href=True):
        m = re.match(r"^([A-Z]{2,5})\.html$", a["href"].strip())
        if m:
            subjects.add(m.group(1))
    if not subjects:
        raise RuntimeError(
            f"Subject index at {url} parsed 0 anchors — page layout may have changed."
        )
    return sorted(subjects)


# ─── Schedule HTML parsers ────────────────────────────────────────────


@dataclass
class ParsedSection:
    subject_code: str
    course_code: str            # "CECS 174"
    course_title: Optional[str]
    section: str                # "01"
    class_number: Optional[str] # "12345"
    course_type: Optional[str]  # "LECTURE" / "LAB" / ...
    units: Optional[float]
    days_mask: int
    days_raw: Optional[str]
    start_minute: Optional[int]
    end_minute: Optional[int]
    location_raw: Optional[str]
    building_code: Optional[str]
    room: Optional[str]
    instructor: Optional[str]
    is_online: bool = False     # COMMENT says online OR location is ONLINE-ONLY


def _parse_days(token: str) -> tuple[int, str]:
    """Return (days_mask, raw_token) parsing CSULB day shorthand."""
    if not token:
        return 0, ""
    cleaned = token.strip()
    mask = 0
    for match in DAY_TOKEN_RE.findall(cleaned):
        mask |= DAY_BITS[match]
    return mask, cleaned


def _parse_time_block(token: str) -> tuple[Optional[int], Optional[int]]:
    """
    Parse "9:00-9:50AM" / "2-3:15PM" / "12:30-1:45PM" into
    (start_minute, end_minute) measured in minutes since midnight.

    Start AM/PM is INFERRED from end (CSULB only prints the end marker):

        - End is AM                  → start is AM.
        - End is PM and start_hour == 12 → start is PM (12 = noon, e.g.
          "12:30-1:45PM" is 12:30 PM → 1:45 PM, not 0:30 AM → 1:45 PM).
        - End is PM and start_hour > end_hour → start crosses noon, so
          start is AM (e.g. "11-1PM" = 11 AM → 1 PM).
        - End is PM and start_hour <= end_hour → start is PM.

    Returns (None, None) for empty / unparseable tokens ("TBA", "ARR").
    """
    if not token:
        return None, None
    m = TIME_RE.search(token)
    if not m:
        return None, None
    sh = int(m.group("sh"))
    sm = int(m.group("sm") or 0)
    eh = int(m.group("eh"))
    em = int(m.group("em"))
    end_pm = m.group("ampm").lower() == "pm"

    end_hour_24 = _to_24h(eh, end_pm)
    end_minute = end_hour_24 * 60 + em

    if not end_pm:
        start_pm = False
    elif sh == 12:
        start_pm = True
    elif sh > eh:
        start_pm = False
    else:
        start_pm = True

    start_hour_24 = _to_24h(sh, start_pm)
    start_minute = start_hour_24 * 60 + sm

    if start_minute > end_minute:
        # Defensive fallback: if our inference produced an inverted block,
        # flip the start to AM and recompute. Real CSULB rows shouldn't
        # trigger this, but guards against future format quirks.
        start_minute = _to_24h(sh, False) * 60 + sm
    return start_minute, end_minute


def _to_24h(hour_12: int, is_pm: bool) -> int:
    """Convert a 12-hour clock hour + AM/PM flag → 0..23."""
    if is_pm:
        return 12 if hour_12 == 12 else hour_12 + 12
    return 0 if hour_12 == 12 else hour_12


def _parse_location(
    raw: str, building_aliases: set[str]
) -> tuple[Optional[str], Optional[str]]:
    """
    Split a raw location string into (building_code, room).

    Returns (None, None) for ONLINE / TBA / unrecognized. Building must
    appear in `building_aliases` to count as on-campus; this filters out
    junk like "OLN-001" (online with a fake room) without requiring an
    exhaustive negative list.
    """
    if not raw:
        return None, None
    cleaned = raw.strip().upper()
    if cleaned in ONLINE_TOKENS or cleaned in TBA_TOKENS:
        return None, None
    m = LOCATION_RE.match(cleaned)
    if not m:
        return None, None
    building = m.group(1)
    room = m.group(2)
    if building not in building_aliases:
        return None, None
    return building, room


def _parse_course_type(notes_cell_text: str) -> Optional[str]:
    """Pull the course-type marker (LEC/LAB/...) out of the class-notes cell."""
    if not notes_cell_text:
        return None
    upper = notes_cell_text.upper()
    for marker, enum_val in COURSE_TYPE_MARKERS.items():
        # Word-boundary match so we don't catch "LEC" inside "SELECT".
        if re.search(rf"\b{marker}\b", upper):
            return enum_val
    return None


def _parse_subject_page(
    html: str, subject_code: str, building_aliases: set[str]
) -> list[ParsedSection]:
    """
    Parse one By_Subject/{SUBJ}.html page → list of ParsedSection.

    The CSULB schedule page wraps each course in a `div.courseBlock`,
    with one `div.courseHeader` (course code/title/units) and one or
    more `table.sectionTable` rows (one row per scheduled meeting).
    A multi-meeting section (e.g. lecture MW + discussion F) emits ONE
    row per meeting; we keep them as separate ParsedSection entries with
    the same `section` number — synthetic-v2 will iterate all of them.
    """
    soup = BeautifulSoup(html, "lxml")
    parsed: list[ParsedSection] = []

    for block in soup.select("div.courseBlock"):
        header = block.select_one("div.courseHeader")
        course_code = ""
        course_title: Optional[str] = None
        units: Optional[float] = None
        if header:
            cc = header.select_one(".courseCode")
            ct = header.select_one(".courseTitle")
            cu = header.select_one(".units")
            if cc:
                course_code = cc.get_text(" ", strip=True)
            if ct:
                course_title = ct.get_text(" ", strip=True) or None
            if cu:
                u_text = cu.get_text(strip=True)
                m = re.search(r"(\d+(?:\.\d+)?)", u_text)
                if m:
                    try:
                        units = float(m.group(1))
                    except ValueError:
                        units = None

        for table in block.select("table.sectionTable"):
            for tr in table.find_all("tr"):
                # Section number lives in <th scope="row">, the rest in <td>.
                # Combining both lets us index by the column order shown in
                # the page header: SEC | CLASS# | NO-MAT | RES-CAP | NOTES |
                # TYPE | DAYS | TIME | OPEN-SEATS | LOCATION | INSTRUCTOR |
                # COMMENT  (12 columns total).
                cells = tr.find_all(["th", "td"])
                if len(cells) < 12:
                    # Malformed / partial row — skip silently.
                    continue
                # Skip the column-header row whose first cell is a <th
                # scope="col"> reading "SEC.".
                first = cells[0]
                if first.name == "th" and first.get("scope") == "col":
                    continue

                texts = [c.get_text(" ", strip=True) for c in cells]
                section_number = texts[0]
                class_number = texts[1] or None
                notes_text = texts[4]
                type_text = texts[5]
                days_text = texts[6]
                time_text = texts[7]
                location_text = texts[9]
                instructor_text = texts[10]
                comment_text = texts[11] if len(texts) > 11 else ""

                if not section_number:
                    continue

                # CSULB uses an explicit TYPE column — no need to fish the
                # marker out of the notes cell. We still fall back to the
                # notes parser for resilience against missing TYPE values.
                course_type = (
                    COURSE_TYPE_MARKERS.get(type_text.strip().upper())
                    or _parse_course_type(notes_text)
                )
                days_mask, days_raw = _parse_days(days_text)
                start_min, end_min = _parse_time_block(time_text)
                building, room = _parse_location(location_text, building_aliases)

                # Hybrid override: the LOCATION cell may show a building
                # while the COMMENT column says "Synch. Online". Treat
                # those as online so we don't double-count walking demand.
                lower_comment = comment_text.lower()
                location_upper = (location_text or "").strip().upper()
                is_online = (
                    location_upper in ONLINE_TOKENS
                    or any(mk in lower_comment for mk in ONLINE_COMMENT_MARKERS)
                )
                if is_online:
                    building = None
                    room = None

                parsed.append(
                    ParsedSection(
                        subject_code=subject_code,
                        course_code=course_code or f"{subject_code} ?",
                        course_title=course_title,
                        section=section_number,
                        class_number=class_number,
                        course_type=course_type,
                        units=units,
                        days_mask=days_mask,
                        days_raw=days_raw or None,
                        start_minute=start_min,
                        end_minute=end_min,
                        location_raw=location_text or None,
                        building_code=building,
                        room=room,
                        instructor=instructor_text or None,
                        is_online=is_online,
                    )
                )
    return parsed


# ─── DB lookups + upsert ──────────────────────────────────────────────


def _fetch_school_id(conn) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM schools ORDER BY created_at ASC LIMIT 1")
        row = cur.fetchone()
    if not row:
        raise RuntimeError("No row in `schools` table; cannot ingest.")
    return row[0]


def _fetch_buildings(
    conn, school_id: str
) -> tuple[dict[str, str], dict[str, Optional[str]]]:
    """
    Build (alias → building_id, alias → classroom_profile) maps.

    `Building.alternate_names` is a Postgres text[]; we UNNEST so a single
    round-trip yields one row per alias. The same ``building_id`` may
    appear multiple times (one per alias); ``classroom_profile`` is
    duplicated across those rows since it's a per-building attribute.

    Aliases are uppercased; callers query with already-uppercased codes
    coming from the parser. The keyset of the returned id-map doubles as
    the ``building_aliases`` set used by ``_parse_location`` to filter
    junk like ``OLN-001`` (online section pretending to be a room).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT b.id, b.classroom_profile, alias
            FROM buildings b, UNNEST(b.alternate_names) AS alias
            WHERE b.school_id = %s
            """,
            (school_id,),
        )
        rows = cur.fetchall()
    ids: dict[str, str] = {}
    profiles: dict[str, Optional[str]] = {}
    for bid, profile, alias in rows:
        if not alias:
            continue
        key = alias.strip().upper()
        ids[key] = bid
        profiles[key] = profile  # may be None for buildings without a derived profile
    return ids, profiles


def _fetch_room_capacities(
    conn, school_id: str
) -> dict[tuple[str, str], int]:
    """Load (BUILDING_CODE, ROOM) → capacity from `room_capacities`."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT building_code, room, capacity
            FROM room_capacities
            WHERE school_id = %s
            """,
            (school_id,),
        )
        rows = cur.fetchall()
    table = {
        (bc.strip().upper(), rm.strip().upper()): cap
        for bc, rm, cap in rows
    }
    logger.info("Loaded %d room capacities from DB", len(table))
    return table


def _fetch_enrollment_overrides(conn, school_id: str) -> dict[str, int]:
    """Load class_number → enrollment from `section_enrollment_overrides`."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT class_number, enrollment
            FROM section_enrollment_overrides
            WHERE school_id = %s
            """,
            (school_id,),
        )
        rows = cur.fetchall()
    table = {cn.strip(): enr for cn, enr in rows if cn}
    if table:
        logger.info("Loaded %d enrollment overrides from DB", len(table))
    return table


def _resolve_enrollment(
    section: ParsedSection,
    overrides: dict[str, int],
    room_capacities: dict[tuple[str, str], int],
    building_profiles: dict[str, Optional[str]],
) -> tuple[Optional[int], Optional[int], str]:
    """
    Decide (room_capacity, enrollment, enrollment_source) for a section.

    See module docstring "Enrollment estimate — tiered fallback" for the
    full ranking. `enrollment_source` is the surface the operator dashboard
    uses to gauge how much of synthetic-v2's signal is real vs. heuristic.
    """
    # 1. Operator-curated DB override.
    if section.class_number and section.class_number in overrides:
        enrollment = overrides[section.class_number]
        cap = (
            room_capacities.get((section.building_code, section.room))
            if section.building_code and section.room
            else None
        )
        return cap, enrollment, "override"

    # 2. Online — explicit flag set by the parser (covers ONLINE-ONLY in
    # the LOCATION column AND "Synch./Asynch. Online" in the COMMENT col).
    if section.is_online:
        type_default = TYPE_DEFAULT_ENROLLMENT.get(
            section.course_type or "LECTURE", TYPE_DEFAULT_ENROLLMENT["LECTURE"]
        )
        return None, type_default, "online"

    # 3. Known room capacity. Outdoor sentinel rooms (cap=999) are tagged
    # by the room-capacity scraper as a placeholder, not a real seat
    # count — fall through so they don't pollute walking-demand estimates.
    if section.building_code and section.room:
        cap = room_capacities.get((section.building_code, section.room))
        if cap is not None and cap < 999:
            # CSULB lecture/lab rooms run at ~95% fill in the AM/PM peak
            # so cap is a tight upper bound on actual seated bodies.
            return cap, cap, "room"

    # 4. Building profile fallback — building is recognized and has a
    # `classroom_profile` derived from per-building median capacity, but
    # the specific room isn't in the reference table (often because it's
    # a newly added or rarely scheduled room). Pick a per-profile default.
    # MIXED is intentionally absent → falls through to type default.
    if section.building_code:
        profile = building_profiles.get(section.building_code)
        if profile is not None:
            profile_default = BUILDING_PROFILE_DEFAULTS.get(profile)
            if profile_default is not None:
                return None, profile_default, "building_profile"

    # 5. Type default — last resort.
    type_default = TYPE_DEFAULT_ENROLLMENT.get(
        section.course_type or "LECTURE", TYPE_DEFAULT_ENROLLMENT["LECTURE"]
    )
    return None, type_default, "type"


def _upsert_sections(
    conn,
    school_id: str,
    term: str,
    sections: list[ParsedSection],
    building_ids: dict[str, str],
    overrides: dict[str, int],
    room_capacities: dict[tuple[str, str], int],
    building_profiles: dict[str, Optional[str]],
) -> tuple[int, int, dict[str, int]]:
    """
    Bulk-upsert ParsedSection rows into `course_meetings`.

    Returns (rows_inserted, rows_updated, source_counts) for ML_RESULT.
    Operator wins: if an existing row already has enrollment_source in
    {'override', 'sso'}, we preserve those three columns (room_capacity,
    enrollment, enrollment_source) and update everything else.
    """
    if not sections:
        return 0, 0, {}

    now = datetime.now(timezone.utc)
    source_counts: dict[str, int] = defaultdict(int)
    rows_to_insert: list[tuple] = []

    for s in sections:
        building_id = building_ids.get(s.building_code) if s.building_code else None
        cap, enrollment, source = _resolve_enrollment(
            s, overrides, room_capacities, building_profiles
        )
        source_counts[source] += 1
        rows_to_insert.append(
            (
                _generate_cuid(),
                school_id,
                term,
                s.subject_code,
                s.course_code,
                s.course_title,
                s.section,
                s.class_number,
                s.course_type,
                s.units,
                s.days_mask,
                s.days_raw,
                s.start_minute,
                s.end_minute,
                s.location_raw,
                building_id,
                s.room,
                s.instructor,
                enrollment,
                source,
                cap,
                now,
                now,
            )
        )

    sql = """
    INSERT INTO course_meetings (
        id, school_id, term, subject_code, course_code, course_title,
        section, class_number, course_type, units,
        days_mask, days_raw, start_minute, end_minute,
        location_raw, building_id, room, instructor,
        enrollment, enrollment_source, room_capacity,
        created_at, updated_at
    ) VALUES %s
    ON CONFLICT (school_id, term, subject_code, course_code, section)
    DO UPDATE SET
        course_title  = EXCLUDED.course_title,
        class_number  = EXCLUDED.class_number,
        course_type   = EXCLUDED.course_type,
        units         = EXCLUDED.units,
        days_mask     = EXCLUDED.days_mask,
        days_raw      = EXCLUDED.days_raw,
        start_minute  = EXCLUDED.start_minute,
        end_minute    = EXCLUDED.end_minute,
        location_raw  = EXCLUDED.location_raw,
        building_id   = EXCLUDED.building_id,
        room          = EXCLUDED.room,
        instructor    = EXCLUDED.instructor,
        -- Operator-supplied enrollment data wins over scraper updates.
        enrollment    = CASE
            WHEN course_meetings.enrollment_source IN ('override', 'sso')
                THEN course_meetings.enrollment
            ELSE EXCLUDED.enrollment
        END,
        enrollment_source = CASE
            WHEN course_meetings.enrollment_source IN ('override', 'sso')
                THEN course_meetings.enrollment_source
            ELSE EXCLUDED.enrollment_source
        END,
        room_capacity = CASE
            WHEN course_meetings.enrollment_source IN ('override', 'sso')
                THEN course_meetings.room_capacity
            ELSE EXCLUDED.room_capacity
        END,
        updated_at    = EXCLUDED.updated_at
    RETURNING (xmax = 0) AS inserted
    """

    with conn.cursor() as cur:
        result = execute_values(cur, sql, rows_to_insert, fetch=True)
    inserted = sum(1 for r in result if r[0])
    updated = len(result) - inserted
    return inserted, updated, dict(source_counts)


# ─── Main ─────────────────────────────────────────────────────────────


def _resolve_term(arg_term: Optional[str], arg_year: Optional[int]) -> tuple[str, int, Optional[str]]:
    """
    Resolve (Term, Year, fallback_reason) from CLI args, else from today's
    academic semester.

    `get_semester` returns one of fall/spring/summer/session/break. The
    'session' (winter intersession) and 'break' values fall back to the
    nearest upcoming primary term so the cron always has something to
    ingest — e.g. running in late December → 'session' → use Spring next year.

    The third tuple element is ``None`` for a direct match (regular
    fall/spring/summer run) or the original low-activity semester name
    when the run was rolled forward (winter → spring, etc.). Callers
    surface this via ``ML_RESULT`` so the admin dashboard can display
    "this was a winter rollover" instead of a misleading "Spring run".
    """
    today = date.today()
    if arg_term and arg_year:
        return arg_term, arg_year, None

    sem = get_semester(today)
    year = today.year

    if sem in ("fall", "spring", "summer"):
        return TERM_FROM_SEMESTER[sem], year, None

    # Off-term: roll forward to the next primary term and record why.
    if today.month >= 8:
        return "Fall", year, sem
    if today.month >= 5:
        return "Fall", year, sem
    if today.month >= 1:
        return "Spring", year, sem
    return "Spring", year, sem


def _scrape_term(term: str, year: int, only_subjects: Optional[list[str]] = None) -> dict:
    session = _build_session()

    total_inserted = 0
    total_updated = 0
    total_parsed = 0
    aggregated_source_counts: dict[str, int] = defaultdict(int)
    skipped_subjects: list[str] = []

    with get_connection() as conn:
        school_id = _fetch_school_id(conn)
        building_ids, building_profiles = _fetch_buildings(conn, school_id)
        if not building_ids:
            raise RuntimeError(
                f"No buildings with alternate_names found for school {school_id}; "
                "run the seed (`pnpm prisma:seed`) before catalog ingest."
            )
        building_aliases = set(building_ids.keys())
        room_capacities = _fetch_room_capacities(conn, school_id)
        overrides = _fetch_enrollment_overrides(conn, school_id)
        logger.info(
            "Resolved %d building aliases (%d with profile) against school %s",
            len(building_ids),
            sum(1 for p in building_profiles.values() if p is not None),
            school_id,
        )

        if only_subjects:
            subjects = sorted(s.upper() for s in only_subjects)
        else:
            subjects = _discover_subjects(session, term, year)
        logger.info("Discovered %d subjects for %s %d", len(subjects), term, year)

        for subject in subjects:
            url = SUBJECT_PAGE_URL.format(term=term, year=year, subject=subject)
            html = _fetch_html(session, url)
            if html is None:
                skipped_subjects.append(subject)
                continue
            parsed = _parse_subject_page(html, subject, building_aliases)
            total_parsed += len(parsed)

            inserted, updated, src_counts = _upsert_sections(
                conn, school_id, term, parsed,
                building_ids, overrides, room_capacities, building_profiles,
            )
            total_inserted += inserted
            total_updated += updated
            for k, v in src_counts.items():
                aggregated_source_counts[k] += v

            logger.info(
                "%s: parsed=%d inserted=%d updated=%d sources=%s",
                subject, len(parsed), inserted, updated, dict(src_counts),
            )
            # Be polite to the static-HTML server; 100ms ≈ 10 req/s ceiling.
            time.sleep(0.1)

        conn.commit()

    return {
        "task": "ingest_csulb_catalog",
        "term": term,
        "year": year,
        "subjects_total": len(subjects),
        "subjects_with_no_page": len(skipped_subjects),
        "rows_parsed": total_parsed,
        "rows_inserted": total_inserted,
        "rows_updated": total_updated,
        "enrollment_source_counts": dict(aggregated_source_counts),
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--term", help="e.g. Spring/Fall/Summer (default: current academic term)")
    parser.add_argument("--year", type=int, help="e.g. 2026 (default: current calendar year)")
    parser.add_argument(
        "--subjects",
        help="Comma-separated subject codes for partial scrape (default: all)",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    term, year, fallback_reason = _resolve_term(args.term, args.year)
    only = [s.strip() for s in args.subjects.split(",")] if args.subjects else None

    if fallback_reason:
        logger.info(
            "Current academic semester is %r (no published catalog); "
            "rolling forward to %s %d.",
            fallback_reason, term, year,
        )

    metadata = _scrape_term(term, year, only)
    if fallback_reason:
        metadata["low_activity_rollover"] = fallback_reason
    print("ML_RESULT: " + json.dumps(metadata))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
