"""
Tests for the synthetic occupancy data generator (src.data.synthetic).

Covers:
    - Aurora PostgreSQL lot fetching (success, empty table, connection errors)
    - Full dataset generation (schema, completeness, value ranges)

Run from services/ml/:
    python -m pytest tests/data/test_synthetic.py -v
"""

import random
from unittest.mock import patch, MagicMock

import numpy as np
import psycopg2
import pytest

from src.data.synthetic import (
    LotInfo,
    fetch_lots,
    generate_all_data,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture(autouse=True)
def fixed_seed():
    """Fix random seeds for reproducibility across tests"""
    random.seed(42)
    np.random.seed(42)


@pytest.fixture
def sample_lots():
    """Sample lot definitions"""
    return [
        LotInfo("G1", 180, "STUDENT"),
        LotInfo("G2", 425, "STUDENT"),
        LotInfo("E1", 185, "EMPLOYEE"),
    ]


# =============================================================================
# FETCH LOTS FROM AURORA POSTGRESQL
# =============================================================================


class TestFetchLots:
    """Verify Aurora PostgreSQL lot fetching, deserialization, and error handling."""

    @patch("src.data.synthetic.psycopg2.connect")
    def test_returns_lots_from_aurora(self, mock_connect):
        """
        Nominal case:
            - proper deserialization (numeric field casted)
            - normalization (uppercase)
        """
        mock_conn = MagicMock()
        mock_connect.return_value = mock_conn
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchall.return_value = [
            ("G1", 180, "Student"),
            ("E1", 185, "Employee"),
        ]

        lots = fetch_lots()

        assert len(lots) == 2
        assert lots[0].lot_id == "G1"
        assert lots[0].capacity == 180
        assert lots[0].lot_type == "STUDENT"
        assert lots[1].lot_id == "E1"
        assert lots[1].lot_type == "EMPLOYEE"

    @patch("src.data.synthetic.psycopg2.connect")
    def test_raises_on_empty_lots(self, mock_connect):
        """
        Simulate a successful query returning no rows.
        Without lot definitions, the function should raise an error.
        """
        mock_conn = MagicMock()
        mock_connect.return_value = mock_conn
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchall.return_value = []

        with pytest.raises(RuntimeError, match="No parking lots found"):
            fetch_lots()

    @patch("src.data.synthetic.psycopg2.connect")
    def test_raises_on_connection_error(self, mock_connect):
        """
        Simulate Aurora being unreachable.
        """
        mock_connect.side_effect = psycopg2.OperationalError("connection refused")

        with pytest.raises(RuntimeError, match="Could not connect to Aurora"):
            fetch_lots()

    @patch("src.data.synthetic.psycopg2.connect")
    def test_raises_on_query_error(self, mock_connect):
        """
        Simulate a query failure (e.g. table not found).
        """
        mock_conn = MagicMock()
        mock_connect.return_value = mock_conn
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_cursor.execute.side_effect = psycopg2.ProgrammingError(
            'relation "lots" does not exist'
        )

        with pytest.raises(RuntimeError, match="Aurora query failed"):
            fetch_lots()


# =============================================================================
# FULL DATA GENERATION
# =============================================================================


class TestGenerateAllData:
    """Full dataset generation across all lots. Validates DataFrame schema and content."""

    def test_has_required_columns(self, sample_lots):
        """
        Ensure schema matches downstream ML expectations.
        Missing or renamed columns would break training/inference.
        """
        df = generate_all_data(sample_lots, target_per_lot=50)
        expected_cols = {
            "lot_id",
            "timestamp",
            "occupancy",
            "available",
            "occupancy_rate",
            "confidence",
            "is_cold_start",
            "academic_period",
            "week_of_semester",
            "is_campus_open",
        }
        assert expected_cols == set(df.columns)

    def test_all_lots_represented(self, sample_lots):
        """
        Each input lot must generate data.
        Prevent silent dropping due to filtering or logic errors.
        """
        df = generate_all_data(sample_lots, target_per_lot=50)
        assert set(df["lot_id"].unique()) == {"G1", "G2", "E1"}

    def test_occupancy_rate_in_valid_range(self, sample_lots):
        """
        occupancy_rate must remain normalized in [0, 1].
        Larger sample used to stress boundary behavior.
        """
        df = generate_all_data(sample_lots, target_per_lot=200)
        assert (df["occupancy_rate"] >= 0.0).all()
        assert (df["occupancy_rate"] <= 1.0).all()
