"""Unit tests for the CSULB schedule HTML parser (D2)."""

from __future__ import annotations

import pytest

from scripts.ingest_csulb_catalog import (
    BUILDING_PROFILE_DEFAULTS,
    DAY_BITS,
    ParsedSection,
    TYPE_DEFAULT_ENROLLMENT,
    _parse_course_type,
    _parse_days,
    _parse_location,
    _parse_subject_page,
    _parse_time_block,
    _resolve_enrollment,
)


# ─── _parse_time_block ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "token,expected",
    [
        # Plain morning block.
        ("9:00-9:50AM", (9 * 60, 9 * 60 + 50)),
        # Start hour without minutes ("2-3:15PM" form CSULB sometimes uses).
        ("2-3:15PM", (14 * 60, 15 * 60 + 15)),
        # 12 == noon edge case (regression: was parsed as 0:30 AM).
        ("12:30-1:45PM", (12 * 60 + 30, 13 * 60 + 45)),
        # Crosses noon: start AM, end PM.
        ("11:00-1:00PM", (11 * 60, 13 * 60)),
        # Late afternoon, both PM.
        ("3:00-4:50PM", (15 * 60, 16 * 60 + 50)),
        # Whitespace tolerance.
        ("9:00 - 9:50 AM", (9 * 60, 9 * 60 + 50)),
        # Lowercase am/pm tolerance.
        ("9:00-9:50am", (9 * 60, 9 * 60 + 50)),
        # Empty / non-parseable → (None, None).
        ("", (None, None)),
        ("TBA", (None, None)),
        ("ARR", (None, None)),
    ],
)
def test_parse_time_block(token, expected):
    assert _parse_time_block(token) == expected


# ─── _parse_days ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "token,expected_mask",
    [
        ("M", DAY_BITS["M"]),
        ("MW", DAY_BITS["M"] | DAY_BITS["W"]),
        ("TuTh", DAY_BITS["Tu"] | DAY_BITS["Th"]),
        # Two-char tokens (Tu/Th/Sa/Su) MUST win over single-char to avoid
        # misreading "Tu" as "T" + "u" or "Th" as "T" + "h".
        ("MTuWThF", sum(DAY_BITS[d] for d in ("M", "Tu", "W", "Th", "F"))),
        ("Sa", DAY_BITS["Sa"]),
        ("SaSu", DAY_BITS["Sa"] | DAY_BITS["Su"]),
        # CSULB sometimes prints "NA" for arranged sections.
        ("NA", 0),
        ("", 0),
    ],
)
def test_parse_days_mask(token, expected_mask):
    mask, _raw = _parse_days(token)
    assert mask == expected_mask


# ─── _parse_location ──────────────────────────────────────────────────


def test_parse_location_known_building():
    aliases = {"ECS", "VEC", "LA5"}
    assert _parse_location("ECS-105", aliases) == ("ECS", "105")
    assert _parse_location("VEC-516A", aliases) == ("VEC", "516A")
    assert _parse_location("LA5-355", aliases) == ("LA5", "355")


def test_parse_location_unknown_building_returns_none():
    # Unknown alias → don't fabricate a building (safer to fall back to
    # 'type' enrollment than to attribute walking demand to a phantom).
    aliases = {"ECS"}
    assert _parse_location("XYZ-100", aliases) == (None, None)


def test_parse_location_online_and_tba():
    aliases = {"ECS"}
    assert _parse_location("ONLINE", aliases) == (None, None)
    assert _parse_location("ONLINE-ONLY", aliases) == (None, None)
    assert _parse_location("TBA", aliases) == (None, None)


# ─── _parse_course_type fallback ──────────────────────────────────────


def test_parse_course_type_from_notes():
    # Used as fallback when the dedicated TYPE column is empty.
    assert _parse_course_type("see note: LEC") == "LECTURE"
    assert _parse_course_type("LAB") == "LAB"
    assert _parse_course_type("SUP") == "SUPPLEMENTAL"
    # Word-boundary: don't match "LEC" inside "SELECT".
    assert _parse_course_type("SELECT one") is None
    assert _parse_course_type("") is None


# ─── _resolve_enrollment tiered fallback ──────────────────────────────


def _make_section(**kw) -> ParsedSection:
    base = dict(
        subject_code="CECS",
        course_code="CECS 174",
        course_title="x",
        section="01",
        class_number="12345",
        course_type="LECTURE",
        units=3.0,
        days_mask=5,
        days_raw="MW",
        start_minute=540,
        end_minute=590,
        location_raw="ECS-105",
        building_code="ECS",
        room="105",
        instructor="Doe",
        is_online=False,
    )
    base.update(kw)
    return ParsedSection(**base)


def test_resolve_enrollment_override_wins():
    s = _make_section(class_number="99999")
    cap, enr, src = _resolve_enrollment(
        s, {"99999": 42}, {("ECS", "105"): 196}, {}
    )
    assert (enr, src) == (42, "override")
    assert cap == 196  # Cap still surfaced for downstream weighting.


def test_resolve_enrollment_room_capacity_used():
    s = _make_section()
    cap, enr, src = _resolve_enrollment(s, {}, {("ECS", "105"): 196}, {})
    assert (cap, enr, src) == (196, 196, "room")


def test_resolve_enrollment_building_profile_lecture_hall():
    # Building is recognized + has LECTURE_HALL profile, but this specific
    # room isn't in room_capacities. Fall through tier 4, not type default.
    s = _make_section(building_code="USU", room="BALLROOM")
    cap, enr, src = _resolve_enrollment(s, {}, {}, {"USU": "LECTURE_HALL"})
    assert (cap, src) == (None, "building_profile")
    assert enr == BUILDING_PROFILE_DEFAULTS["LECTURE_HALL"]


def test_resolve_enrollment_building_profile_seminar():
    s = _make_section(building_code="FA2", room="X1")
    _, enr, src = _resolve_enrollment(s, {}, {}, {"FA2": "SEMINAR"})
    assert (enr, src) == (BUILDING_PROFILE_DEFAULTS["SEMINAR"], "building_profile")


def test_resolve_enrollment_mixed_profile_falls_through_to_type():
    # MIXED is intentionally absent from BUILDING_PROFILE_DEFAULTS so
    # multi-bucket buildings don't get a misleading single-number guess.
    s = _make_section(building_code="VEC", room="X1")
    _, enr, src = _resolve_enrollment(s, {}, {}, {"VEC": "MIXED"})
    assert src == "type"
    assert enr == TYPE_DEFAULT_ENROLLMENT["LECTURE"]


def test_resolve_enrollment_falls_back_to_type_default():
    s = _make_section(building_code="UNK", room="999")
    cap, enr, src = _resolve_enrollment(s, {}, {}, {})
    assert (cap, src) == (None, "type")
    assert enr == TYPE_DEFAULT_ENROLLMENT["LECTURE"]


def test_resolve_enrollment_online_flag_short_circuits():
    s = _make_section(is_online=True, building_code=None, room=None)
    cap, enr, src = _resolve_enrollment(s, {}, {}, {})
    assert (cap, src) == (None, "online")
    assert enr == TYPE_DEFAULT_ENROLLMENT["LECTURE"]


def test_resolve_enrollment_outdoor_capacity_falls_to_type():
    # PE/outdoor rooms are tagged 999 in the room-capacities table; they're
    # a placeholder, not a real seat count, so we shouldn't propagate that
    # as the section's enrollment estimate.
    s = _make_section(building_code="FLD", room="112")
    cap, enr, src = _resolve_enrollment(s, {}, {("FLD", "112"): 999}, {})
    assert src == "type"
    assert enr == TYPE_DEFAULT_ENROLLMENT["LECTURE"]


# ─── End-to-end HTML parse ────────────────────────────────────────────


_SAMPLE_HTML = """
<html><body>
<div class="courseBlock">
  <div class="courseHeader">
    <h4><span class="courseCode">CECS 174</span> -
        <span class="courseTitle">PROGRAMMING I</span></h4>
    <span class="units">3 Units</span>
  </div>
  <table class="sectionTable">
    <tr>
      <th scope="col">SEC.</th><th scope="col">CLASS #</th>
      <th scope="col">NO MAT</th><th scope="col">RES CAP</th>
      <th scope="col">CLASS NOTES</th><th scope="col">TYPE</th>
      <th scope="col">DAYS</th><th scope="col">TIME</th>
      <th scope="col">OPEN</th><th scope="col">LOCATION</th>
      <th scope="col">INSTRUCTOR</th><th scope="col">COMMENT</th>
    </tr>
    <tr>
      <th scope="row">01</th>
      <td>12345</td><td></td><td></td><td>note</td>
      <td>LEC</td><td>MW</td><td>9:00-9:50AM</td><td></td>
      <td>ECS-105</td><td>Doe J</td>
      <td>Class instruction is: Face to Face - On Campus.</td>
    </tr>
    <tr>
      <th scope="row">02</th>
      <td>12346</td><td></td><td></td><td>note</td>
      <td>LEC</td><td>TuTh</td><td>2-3:15PM</td><td></td>
      <td>ONLINE-ONLY</td><td>Smith K</td>
      <td>Class instruction is: Synch. Online - Meet Times.</td>
    </tr>
  </table>
</div>
</body></html>
"""


def test_parse_subject_page_full_layout():
    aliases = {"ECS"}
    sections = _parse_subject_page(_SAMPLE_HTML, "CECS", aliases)
    assert len(sections) == 2

    s1, s2 = sections
    assert s1.section == "01"
    assert s1.class_number == "12345"
    assert s1.course_type == "LECTURE"
    assert s1.days_mask == DAY_BITS["M"] | DAY_BITS["W"]
    assert s1.start_minute == 9 * 60 and s1.end_minute == 9 * 60 + 50
    assert s1.building_code == "ECS" and s1.room == "105"
    assert s1.is_online is False

    assert s2.section == "02"
    assert s2.start_minute == 14 * 60 and s2.end_minute == 15 * 60 + 15
    assert s2.is_online is True
    assert s2.building_code is None and s2.room is None
