"""Unit tests for ingest_room_capacities (D2 — room-capacity scraper)."""

from __future__ import annotations

import textwrap

import pytest
from bs4 import BeautifulSoup

from scripts.ingest_room_capacities import (
    OUTDOOR_CAPACITY_SENTINEL,
    BuildingCodeRow,
    CapacityRow,
    _bucket_capacity,
    _column_indexes,
    _dedup,
    _find_table_by_caption,
    _normalize_building,
    _normalize_room,
    _parse_building_codes_table,
    _parse_capacity_table,
    _parse_int,
    _resolve_profile,
    _slugify_room_type,
    _source_priority,
    _table_headers,
)


# ─── Small helpers ────────────────────────────────────────────────────


def _html(s: str) -> BeautifulSoup:
    return BeautifulSoup(textwrap.dedent(s), "lxml")


# ─── Cell-level normalization ─────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [("hsci", "HSCI"), ("  cba ", "CBA"), ("", "")],
)
def test_normalize_building(raw, expected):
    assert _normalize_building(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        # Asterisk suffix is stripped (registrar marks "non-priority" rooms with `*`).
        ("128*", "128"),
        ("128 *", "128"),
        ("  235  ", "235"),
        ("a-100", "A-100"),
        ("", ""),
    ],
)
def test_normalize_room(raw, expected):
    assert _normalize_room(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("48", 48),
        ("  48 ", 48),
        ("1,200", 1200),
        # Trailing junk: peel off leading digits ("48 fixed" → 48).
        ("48 fixed", 48),
        ("", None),
        ("n/a", None),
        (None, None),
    ],
)
def test_parse_int(raw, expected):
    assert _parse_int(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Studio - art", "studio"),
        ("Outdoor field", "outdoor"),
        ("Lab/Bio", "lab"),
        ("PE", "pe"),
        ("", ""),
    ],
)
def test_slugify_room_type(raw, expected):
    assert _slugify_room_type(raw) == expected


# ─── _table_headers — must ignore nested tables ───────────────────────


def test_table_headers_ignores_nested_table_wrapper():
    """
    The lecture-allocations page wraps the real table in an outer
    `<table><thead><tr><th>...inner table...`. The outer table's own
    `<th>` contains the inner table; we must NOT include that wrapper
    cell or any of its descendants in the outer table's headers (it
    should look "header-less" so the finder skips it).
    """
    soup = _html(
        """
        <table id="outer">
          <thead><tr><th>
            <table id="inner">
              <thead><tr><th>TIME</th><th>BUILDING</th><th>ROOM</th><th>CAP</th></tr></thead>
              <tbody><tr><td>9am</td><td>COB</td><td>114</td><td>48</td></tr></tbody>
            </table>
          </th></tr></thead>
        </table>
        """
    )
    outer = soup.find("table", id="outer")
    inner = soup.find("table", id="inner")
    assert _table_headers(outer) == []  # wrapper cell ignored → empty
    assert _table_headers(inner) == ["time", "building", "room", "cap"]


# ─── _column_indexes ──────────────────────────────────────────────────


def test_column_indexes_substring_match():
    headers = ["time", "building", "room", "cap", "college", "comments"]
    cols = _column_indexes(headers, {
        "building": ("building",),
        "room": ("room",),
        "capacity": ("cap", "seats"),
    })
    assert cols == {"building": 1, "room": 2, "capacity": 3}


def test_column_indexes_missing_raises():
    with pytest.raises(ValueError, match="missing column 'capacity'"):
        _column_indexes(["building", "room"], {
            "building": ("building",),
            "room": ("room",),
            "capacity": ("cap", "seats"),
        })


# ─── Auditorium / active-learning style table ─────────────────────────


def test_parse_capacity_table_seats_column():
    soup = _html(
        """
        <table>
          <caption>Auditorium Classroom List</caption>
          <thead><tr><th>Building</th><th>Room</th><th>Seats</th></tr></thead>
          <tbody>
            <tr><td>COB</td><td>139</td><td>117</td></tr>
            <tr><td>HSCI</td><td>128*</td><td>72</td></tr>
            <tr><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        """
    )
    rows = _parse_capacity_table(
        soup.find("table"), source="auditorium",
        capacity_col_candidates=("cap", "seats"),
    )
    assert rows == [
        CapacityRow("COB", "139", 117, "auditorium"),
        # `*` stripped from room number.
        CapacityRow("HSCI", "128", 72, "auditorium"),
    ]


def test_parse_capacity_table_drops_zero_or_blank_capacity():
    soup = _html(
        """
        <table>
          <thead><tr><th>Building</th><th>Room</th><th>Cap</th></tr></thead>
          <tbody>
            <tr><td>FOO</td><td>100</td><td>0</td></tr>
            <tr><td>BAR</td><td>200</td><td></td></tr>
            <tr><td>BAZ</td><td>300</td><td>20</td></tr>
          </tbody>
        </table>
        """
    )
    rows = _parse_capacity_table(soup.find("table"), source="x", capacity_col_candidates=("cap",))
    assert rows == [CapacityRow("BAZ", "300", 20, "x")]


# ─── Conflict-off table (use_room_type_for_source) ───────────────────


def test_parse_capacity_table_conflict_off_uses_room_type_slug():
    soup = _html(
        """
        <table>
          <thead><tr>
            <th>Building</th><th>Room</th><th>Facility ID</th>
            <th>Room Type</th><th>Capacity</th>
          </tr></thead>
          <tbody>
            <tr><td>MUS</td><td>140</td><td>x</td><td>Studio - music</td><td>30</td></tr>
            <tr><td>FLD</td><td>112</td><td>x</td><td>Outdoor field</td><td>0</td></tr>
            <tr><td>FA1</td><td>100</td><td>x</td><td>Lab/Art</td><td>24</td></tr>
          </tbody>
        </table>
        """
    )
    # NOTE: Outdoor field has cap=0 but should still be retained with sentinel.
    rows = _parse_capacity_table(
        soup.find("table"), source="conflict-off",
        capacity_col_candidates=("cap", "seats"),
        use_room_type_for_source=True,
    )
    assert rows == [
        CapacityRow("MUS", "140", 30, "conflict-off-studio"),
        CapacityRow("FLD", "112", OUTDOOR_CAPACITY_SENTINEL, "conflict-off-outdoor"),
        CapacityRow("FA1", "100", 24, "conflict-off-lab"),
    ]


# ─── Building codes table ─────────────────────────────────────────────


def test_parse_building_codes_table():
    soup = _html(
        """
        <table>
          <caption>Building Codes</caption>
          <thead><tr>
            <th>Building Code</th><th>Abbreviation</th>
            <th>Building Name</th><th>Location</th>
          </tr></thead>
          <tbody>
            <tr><td>020</td><td>AS</td><td>Academic Services</td><td>Quad</td></tr>
            <tr><td>050</td><td>vec</td><td>Vivian Engineering Center</td><td>South</td></tr>
            <tr><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        """
    )
    rows = _parse_building_codes_table(soup.find("table"))
    assert rows == [
        BuildingCodeRow("020", "AS", "Academic Services"),
        # Lowercase abbreviation is normalized to upper.
        BuildingCodeRow("050", "VEC", "Vivian Engineering Center"),
    ]


# ─── _find_table_by_caption ───────────────────────────────────────────


def test_find_table_by_caption_substring_case_insensitive():
    soup = _html(
        """
        <div>
          <table><caption>Building Codes (Updated 2025)</caption></table>
          <table><caption>Auditorium Classroom List</caption></table>
        </div>
        """
    )
    t = _find_table_by_caption(soup, "auditorium classroom")
    assert t is not None
    assert "Auditorium" in t.find("caption").get_text()

    # Substring/CI match:
    t2 = _find_table_by_caption(soup, "BUILDING CODES")
    assert t2 is not None and "Building Codes" in t2.find("caption").get_text()

    assert _find_table_by_caption(soup, "nonexistent") is None


# ─── Source priority + dedup ──────────────────────────────────────────


def test_source_priority_ordering():
    # conflict-off (any -* slug) > auditorium > active-learning > lecture-allocation
    assert _source_priority("conflict-off-lab") > _source_priority("auditorium")
    assert _source_priority("auditorium") > _source_priority("active-learning")
    assert _source_priority("active-learning") > _source_priority("lecture-allocation")
    assert _source_priority("conflict-off-studio") == _source_priority("conflict-off-pe")
    assert _source_priority("unknown-source") == 0


def test_dedup_priority_wins_over_capacity():
    """conflict-off must beat lecture-allocation even when its capacity is smaller."""
    rows = [
        CapacityRow("MUS", "140", 200, "lecture-allocation"),  # bigger but lower priority
        CapacityRow("MUS", "140", 30, "conflict-off-studio"),  # smaller but higher
    ]
    out = _dedup(rows)
    assert len(out) == 1
    assert out[0].source == "conflict-off-studio"
    assert out[0].capacity == 30


def test_dedup_max_capacity_breaks_ties():
    """
    Within the same source priority bucket (e.g. lecture-allocation lists
    the same room once per college), the largest capacity wins.
    """
    rows = [
        CapacityRow("ET", "105", 30, "lecture-allocation"),
        CapacityRow("ET", "105", 34, "lecture-allocation"),
        CapacityRow("ET", "105", 28, "lecture-allocation"),
    ]
    out = _dedup(rows)
    assert len(out) == 1
    assert out[0].capacity == 34


def test_dedup_preserves_distinct_keys():
    rows = [
        CapacityRow("ET", "105", 30, "lecture-allocation"),
        CapacityRow("ET", "107", 48, "lecture-allocation"),
        CapacityRow("COB", "139", 117, "auditorium"),
    ]
    out = _dedup(rows)
    assert {(r.building_code, r.room) for r in out} == {
        ("ET", "105"), ("ET", "107"), ("COB", "139"),
    }


# ─── classroom_profile auto-derivation ────────────────────────────────


@pytest.mark.parametrize(
    "capacity, expected",
    [
        (1, "SEMINAR"),
        (24, "SEMINAR"),
        (25, "STANDARD"),
        (50, "STANDARD"),
        (51, "ACTIVE"),
        (80, "ACTIVE"),
        (81, "LECTURE_HALL"),
        (500, "LECTURE_HALL"),
    ],
)
def test_bucket_capacity(capacity, expected):
    assert _bucket_capacity(capacity) == expected


def test_resolve_profile_single_bucket():
    assert _resolve_profile(["STANDARD", "STANDARD", "STANDARD"]) == "STANDARD"


def test_resolve_profile_multi_bucket_returns_mixed():
    assert _resolve_profile(["SEMINAR", "LECTURE_HALL"]) == "MIXED"
    assert _resolve_profile(["STANDARD", "ACTIVE"]) == "MIXED"


def test_resolve_profile_empty_returns_none():
    assert _resolve_profile([]) is None
