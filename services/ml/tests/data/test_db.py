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
            "predicted_occupancy": [90, 126, 100],
            "confidence_lower": [72, 108, 81],
            "confidence_upper": [108, 144, 119],
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
    def test_deletes_before_insert(
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

        # First call should be the SELECT (via get_lot_id_map)
        # Second call should be the DELETE
        calls = cursor.execute.call_args_list
        delete_call = calls[1]
        assert "DELETE FROM predictions_short_term" in delete_call[0][0]

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
