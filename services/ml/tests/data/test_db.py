"""
Tests for database write utilities (src/data/db.py).

Uses mock psycopg2 connections to avoid requiring a live database.

Run from services/ml/:
    python -m pytest tests/data/test_db.py -v
"""

from unittest.mock import MagicMock, patch

import pandas as pd
import psycopg2
import pytest

from src.data.db import (
    fetch_recent_snapshots,
    get_lot_id_map,
    load_real_snapshots,
    write_short_term_predictions,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sample_predictions():
    """Sample prediction DataFrame using human-readable lot_ids."""
    return pd.DataFrame(
        {
            "lot_id": ["G1", "G1", "E1"],
            "predicted_at": [
                "2025-10-15T09:00:00",
                "2025-10-15T09:00:00",
                "2025-10-15T09:00:00",
            ],
            "target_time": [
                "2025-10-15T10:00:00",
                "2025-10-15T11:00:00",
                "2025-10-15T10:00:00",
            ],
            "predicted_occupancy": [0.45, 0.63, 0.50],
            "confidence_lower": [0.36, 0.54, 0.40],
            "confidence_upper": [0.54, 0.72, 0.60],
            "model_version": ["v1", "v1", "v1"],
        }
    )


@pytest.fixture
def mock_conn():
    """Mock psycopg2 connection with cursor context manager."""
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return conn, cursor


@pytest.fixture
def lot_id_rows():
    """Rows returned by SELECT id, lot_id FROM lots."""
    return [
        ("cuid_g1_abc123", "G1"),
        ("cuid_e1_def456", "E1"),
    ]


# =============================================================================
# Tests — get_lot_id_map
# =============================================================================


class TestGetLotIdMap:
    def test_psycopg2_returns_mapping(self, mock_conn, lot_id_rows):
        conn, cursor = mock_conn
        cursor.fetchall.return_value = lot_id_rows

        result = get_lot_id_map(conn)

        assert result == {"G1": "cuid_g1_abc123", "E1": "cuid_e1_def456"}
        cursor.execute.assert_called_once_with("SELECT id, lot_id FROM lots")

    def test_psycopg2_empty_lots(self, mock_conn):
        conn, cursor = mock_conn
        cursor.fetchall.return_value = []

        result = get_lot_id_map(conn)

        assert result == {}

    def test_sqlalchemy_connection(self, lot_id_rows):
        """get_lot_id_map should also work with a SQLAlchemy connection."""
        sa_conn = MagicMock(spec=["execute"])  # has execute but no cursor
        sa_conn.execute.return_value = lot_id_rows

        result = get_lot_id_map(sa_conn)

        assert result == {"G1": "cuid_g1_abc123", "E1": "cuid_e1_def456"}
        sa_conn.execute.assert_called_once()

    def test_sqlalchemy_connection_empty(self):
        """SQLAlchemy path should return empty dict when no lots exist."""
        sa_conn = MagicMock(spec=["execute"])
        sa_conn.execute.return_value = []

        result = get_lot_id_map(sa_conn)

        assert result == {}


# =============================================================================
# Tests — write_short_term_predictions
# =============================================================================


class TestWritePredictions:
    @patch("src.data.db.execute_values")
    @patch("src.data.db.get_connection")
    def test_writes_correct_row_count(
        self,
        mock_get_conn,
        mock_exec_values,
        sample_predictions,
        mock_conn,
        lot_id_rows,
    ):
        conn, cursor = mock_conn
        cursor.fetchall.return_value = lot_id_rows
        mock_get_conn.return_value = conn

        result = write_short_term_predictions(sample_predictions)

        assert result == 3
        conn.commit.assert_called_once()
        conn.close.assert_called_once()

    @patch("src.data.db.execute_values")
    @patch("src.data.db.get_connection")
    def test_does_not_delete_existing_predictions(
        self,
        mock_get_conn,
        mock_exec_values,
        sample_predictions,
        mock_conn,
        lot_id_rows,
    ):
        conn, cursor = mock_conn
        cursor.fetchall.return_value = lot_id_rows
        mock_get_conn.return_value = conn

        write_short_term_predictions(sample_predictions)

        for call in cursor.execute.call_args_list:
            sql = call[0][0]
            assert "DELETE" not in sql.upper(), (
                f"Writer must not issue DELETE; got: {sql}"
            )

    @patch("src.data.db.execute_values")
    @patch("src.data.db.get_connection")
    def test_inserts_with_execute_values(
        self,
        mock_get_conn,
        mock_exec_values,
        sample_predictions,
        mock_conn,
        lot_id_rows,
    ):
        conn, cursor = mock_conn
        cursor.fetchall.return_value = lot_id_rows
        mock_get_conn.return_value = conn

        write_short_term_predictions(sample_predictions)

        mock_exec_values.assert_called_once()
        insert_sql = mock_exec_values.call_args[0][1]
        assert "INSERT INTO predictions_short_term" in insert_sql
        rows = mock_exec_values.call_args[0][2]
        assert len(rows) == 3

    @patch("src.data.db.execute_values")
    @patch("src.data.db.get_connection")
    def test_resolves_lot_ids_to_cuids(
        self,
        mock_get_conn,
        mock_exec_values,
        sample_predictions,
        mock_conn,
        lot_id_rows,
    ):
        conn, cursor = mock_conn
        cursor.fetchall.return_value = lot_id_rows
        mock_get_conn.return_value = conn

        write_short_term_predictions(sample_predictions)

        rows = mock_exec_values.call_args[0][2]
        # Row format: (id, lot_id_cuid, predicted_at, ...)
        lot_cuids = [r[1] for r in rows]
        assert lot_cuids == ["cuid_g1_abc123", "cuid_g1_abc123", "cuid_e1_def456"]

    @patch("src.data.db.get_connection")
    def test_raises_on_missing_lot_id(
        self, mock_get_conn, sample_predictions, mock_conn
    ):
        conn, cursor = mock_conn
        # Only G1 exists, E1 is missing
        cursor.fetchall.return_value = [("cuid_g1_abc123", "G1")]
        mock_get_conn.return_value = conn

        with pytest.raises(RuntimeError, match="Cannot resolve lot_id"):
            write_short_term_predictions(sample_predictions)

    def test_empty_dataframe_returns_zero(self):
        result = write_short_term_predictions(pd.DataFrame())
        assert result == 0

    @patch("src.data.db.get_connection")
    def test_operational_error_raises_runtime(self, mock_get_conn, sample_predictions):
        conn = MagicMock()
        mock_get_conn.return_value = conn
        conn.cursor.return_value.__enter__ = MagicMock(
            side_effect=psycopg2.OperationalError("connection refused")
        )
        conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        # get_lot_id_map is called before the cursor context manager that fails
        # We need get_lot_id_map to succeed first, then the DELETE cursor to fail
        lot_rows = [("cuid_g1_abc123", "G1"), ("cuid_e1_def456", "E1")]

        call_count = 0

        def cursor_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First cursor call: get_lot_id_map
                ctx = MagicMock()
                cur = MagicMock()
                cur.fetchall.return_value = lot_rows
                ctx.__enter__ = MagicMock(return_value=cur)
                ctx.__exit__ = MagicMock(return_value=False)
                return ctx
            else:
                # Second cursor call: the write — raise OperationalError
                raise psycopg2.OperationalError("connection lost")

        conn.cursor.side_effect = cursor_side_effect

        with pytest.raises(RuntimeError, match="Could not connect"):
            write_short_term_predictions(sample_predictions)

    @patch(
        "src.data.db.execute_values", side_effect=psycopg2.ProgrammingError("bad SQL")
    )
    @patch("src.data.db.get_connection")
    def test_programming_error_triggers_rollback(
        self,
        mock_get_conn,
        mock_exec_values,
        sample_predictions,
        mock_conn,
        lot_id_rows,
    ):
        conn, cursor = mock_conn
        cursor.fetchall.return_value = lot_id_rows
        mock_get_conn.return_value = conn

        with pytest.raises(RuntimeError, match="Database write failed"):
            write_short_term_predictions(sample_predictions)

        conn.rollback.assert_called_once()
        conn.close.assert_called_once()


# =============================================================================
# Tests — fetch_recent_snapshots
# =============================================================================


class TestFetchRecentSnapshots:
    @patch("src.data.db.pd.read_sql")
    @patch("src.data.db.get_lot_id_map")
    @patch("src.data.db.get_engine")
    def test_returns_mapped_lot_ids(self, mock_get_engine, mock_lot_map, mock_read_sql):
        mock_conn = MagicMock()
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine

        mock_lot_map.return_value = {"G1": "cuid_g1_abc123", "E1": "cuid_e1_def456"}

        snapshot_df = pd.DataFrame(
            {
                "lot_id": ["cuid_g1_abc123", "cuid_e1_def456"],
                "timestamp": pd.to_datetime(["2025-10-15T10:00", "2025-10-15T10:00"]),
                "occupancy": [50, 80],
                "available": [130, 105],
                "occupancy_rate": [0.28, 0.43],
                "confidence": ["HIGH", "HIGH"],
                "is_cold_start": [False, False],
                "academic_period": ["midterms", "midterms"],
                "week_of_semester": [5, 5],
                "is_campus_open": [True, True],
                "semester": ["fall", "fall"],
            }
        )
        mock_read_sql.return_value = snapshot_df

        result = fetch_recent_snapshots(lookback_hours=2)

        assert list(result["lot_id"]) == ["G1", "E1"]

    @patch("src.data.db.pd.read_sql")
    @patch("src.data.db.get_lot_id_map")
    @patch("src.data.db.get_engine")
    def test_raises_on_empty_snapshots(
        self, mock_get_engine, mock_lot_map, mock_read_sql
    ):
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine

        mock_lot_map.return_value = {}
        mock_read_sql.return_value = pd.DataFrame()

        with pytest.raises(RuntimeError, match="No snapshots found"):
            fetch_recent_snapshots()


# =============================================================================
# Tests — load_real_snapshots
# =============================================================================


class TestLoadRealSnapshots:
    @patch("src.data.db.pd.read_sql")
    @patch("src.data.db.get_lot_id_map")
    @patch("src.data.db.get_engine")
    def test_returns_mapped_lot_ids(self, mock_get_engine, mock_lot_map, mock_read_sql):
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine

        mock_lot_map.return_value = {"G1": "cuid_g1_abc123"}

        snapshot_df = pd.DataFrame(
            {
                "lot_id": ["cuid_g1_abc123"],
                "timestamp": pd.to_datetime(["2025-10-15T10:00"]),
                "occupancy": [50],
                "available": [130],
                "occupancy_rate": [0.28],
                "confidence": ["HIGH"],
                "is_cold_start": [False],
                "academic_period": ["midterms"],
                "week_of_semester": [5],
                "is_campus_open": [True],
                "semester": ["fall"],
            }
        )
        mock_read_sql.return_value = snapshot_df

        result = load_real_snapshots()

        assert list(result["lot_id"]) == ["G1"]

    @patch("src.data.db.pd.read_sql")
    @patch("src.data.db.get_lot_id_map")
    @patch("src.data.db.get_engine")
    def test_returns_empty_df_when_no_data(
        self, mock_get_engine, mock_lot_map, mock_read_sql
    ):
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine

        mock_lot_map.return_value = {}
        mock_read_sql.return_value = pd.DataFrame()

        result = load_real_snapshots()

        assert result.empty

    @patch("src.data.db.pd.read_sql")
    @patch("src.data.db.get_lot_id_map")
    @patch("src.data.db.get_engine")
    def test_no_date_filters(self, mock_get_engine, mock_lot_map, mock_read_sql):
        """Calling without date params should not append WHERE clauses."""
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine

        mock_lot_map.return_value = {}
        mock_read_sql.return_value = pd.DataFrame()

        load_real_snapshots()

        call_args = mock_read_sql.call_args
        assert call_args[1]["params"] is None


# =============================================================================
# Tests — load_synthetic_v2_snapshots (D5)
# =============================================================================


from src.data.db import load_synthetic_v2_snapshots  # noqa: E402


class TestLoadSyntheticV2Snapshots:
    @patch("src.data.db.pd.read_sql")
    @patch("src.data.db.get_lot_id_map")
    @patch("src.data.db.get_engine")
    def test_derives_full_schema_from_v2_rows(
        self, mock_get_engine, mock_lot_map, mock_read_sql
    ):
        sa_conn = MagicMock()
        sa_conn.execute.return_value.first.return_value = ("school_cuid",)
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=sa_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine
        mock_lot_map.return_value = {"G1": "lot_cuid_g1"}

        # Mid-spring 2026 timestamp (regular session, campus open).
        mock_read_sql.return_value = pd.DataFrame(
            {
                "lot_cuid": ["lot_cuid_g1", "lot_cuid_g1"],
                "timestamp": pd.to_datetime(
                    ["2026-02-15T10:00:00Z", "2026-02-15T10:15:00Z"]
                ),
                "occupancy": [40, 60],
                "occupancy_rate": [0.4, 0.6],
                "sample_weight": [1.0, 0.5],
                "term": ["Spring_2026", "Spring_2026"],
                "generator_version": ["v2", "v2"],
                "total_spaces": [100, 100],
            }
        )

        df = load_synthetic_v2_snapshots(
            school_short_name="CSULB", term="Spring_2026"
        )

        assert list(df["lot_id"]) == ["G1", "G1"]
        assert list(df["available"]) == [60, 40]
        assert (df["confidence"] == "HIGH").all()
        assert (df["is_cold_start"] == False).all()  # noqa: E712
        assert (df["_source"] == "synthetic").all()
        assert (df["generator_version"] == "v2").all()
        assert list(df["sample_weight"]) == [1.0, 0.5]
        assert (df["semester"] == "Spring_2026").all()
        # academic_period / week_of_semester / is_campus_open populated.
        assert df["academic_period"].notna().all()
        assert df["week_of_semester"].notna().all()
        assert df["is_campus_open"].dtype == bool

    @patch("src.data.db.pd.read_sql")
    @patch("src.data.db.get_lot_id_map")
    @patch("src.data.db.get_engine")
    def test_returns_empty_when_no_rows(
        self, mock_get_engine, mock_lot_map, mock_read_sql
    ):
        sa_conn = MagicMock()
        sa_conn.execute.return_value.first.return_value = ("school_cuid",)
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=sa_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine
        mock_lot_map.return_value = {}
        mock_read_sql.return_value = pd.DataFrame()

        df = load_synthetic_v2_snapshots(school_short_name="CSULB", term="Spring_2026")
        assert df.empty

    @patch("src.data.db.get_engine")
    def test_unknown_school_short_name_raises(self, mock_get_engine):
        sa_conn = MagicMock()
        sa_conn.execute.return_value.first.return_value = None  # not found
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=sa_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine

        with pytest.raises(RuntimeError, match="not found"):
            load_synthetic_v2_snapshots(school_short_name="NOPE")

    def test_invalid_date_raises(self):
        with pytest.raises(ValueError, match="Invalid start_date"):
            load_synthetic_v2_snapshots(start_date="not-a-date")

    def test_inverted_range_raises(self):
        with pytest.raises(ValueError, match="must be before"):
            load_synthetic_v2_snapshots(
                start_date="2026-02-10", end_date="2026-02-01"
            )

    @patch("src.data.db.pd.read_sql")
    @patch("src.data.db.get_lot_id_map")
    @patch("src.data.db.get_engine")
    def test_unknown_lot_cuid_raises(
        self, mock_get_engine, mock_lot_map, mock_read_sql
    ):
        sa_conn = MagicMock()
        sa_conn.execute.return_value.first.return_value = ("school_cuid",)
        mock_engine = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=sa_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_engine.return_value = mock_engine
        mock_lot_map.return_value = {"G1": "lot_cuid_g1"}  # missing G2

        mock_read_sql.return_value = pd.DataFrame(
            {
                "lot_cuid": ["lot_cuid_g2"],  # unknown
                "timestamp": pd.to_datetime(["2026-02-15T10:00:00Z"]),
                "occupancy": [40],
                "occupancy_rate": [0.4],
                "sample_weight": [1.0],
                "term": ["Spring_2026"],
                "generator_version": ["v2"],
                "total_spaces": [100],
            }
        )

        with pytest.raises(RuntimeError, match="unknown lot IDs"):
            load_synthetic_v2_snapshots(school_short_name="CSULB")
