"""
Tests for the synthetic occupancy data generator (src.data.synthetic).

Covers:
    - DynamoDB lot fetching (success, empty table, connection errors, missing resources)
    - Full dataset generation (schema, completeness, value ranges)

Run from services/ml/:
    python -m pytest tests/data/test_synthetic.py -v
"""

import random
from unittest.mock import patch, MagicMock

import numpy as np
import pytest
from botocore.exceptions import ClientError

from src.data.synthetic import (
    LotInfo,
    fetch_lots_from_dynamodb,
    generate_all_data,
)


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture(autouse=True)
def fixed_seed():
    """Fix random seeds for reproducibility across tests
    """
    random.seed(42)
    np.random.seed(42)


@pytest.fixture
def sample_lots():
    """Sample lot definitions
    """
    return [
        LotInfo("G1", 180, "STUDENT"),
        LotInfo("G2", 425, "STUDENT"),
        LotInfo("E1", 185, "EMPLOYEE"),
    ]


# =============================================================================
# FETCH LOTS FROM DYNAMODB
# =============================================================================

class TestFetchLotsFromDynamoDB:
    """Verify DynamoDB lot fetching, deserialization, and error handling.    
    """

    @patch("src.data.synthetic.boto3.client")
    def test_returns_lots_from_dynamodb(self, mock_boto_client):
        """
        Nominal case:
            - proper deserialization (numeric field casted)
            - normalization (uppercase)
        """
        # Mock DynamoDB low-level AttributeValue response
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.query.return_value = {
            "Items": [
                {
                    "lot_id": {"S": "G1"},
                    "capacity": {"N": "180"},
                    "lot_type": {"S": "Student"},
                },
                {
                    "lot_id": {"S": "E1"},
                    "capacity": {"N": "185"},
                    "lot_type": {"S": "Employee"},
                },
            ]
        }

        lots = fetch_lots_from_dynamodb()

        assert len(lots) == 2
        assert lots[0].lot_id == "G1"
        assert lots[0].capacity == 180
        assert lots[0].lot_type == "STUDENT"
        assert lots[1].lot_id == "E1"
        assert lots[1].lot_type == "EMPLOYEE"

    @patch("src.data.synthetic.boto3.client")
    def test_raises_on_empty_lots(self, mock_boto_client):
        """
        Simulate a successful query returning no Items
        Without lot definitions, the function should raise an error.
        """
        # 
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.query.return_value = {"Items": []}
        
        # Generation cannot proceed without lot metadata
        with pytest.raises(RuntimeError, match="No parking lots found"):
            fetch_lots_from_dynamodb()

    @patch("src.data.synthetic.boto3.client")
    def test_raises_on_connection_refused(self, mock_boto_client):
        """ 
        Simulate DynamoDB being unreachable (e.g. local endpoint down)
        """        
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.query.side_effect = ConnectionRefusedError()

        with pytest.raises(RuntimeError, match="Could not connect to DynamoDB"):
            fetch_lots_from_dynamodb()

    @patch("src.data.synthetic.boto3.client")
    def test_raises_on_resource_not_found(self, mock_boto_client):
        """
        Simulate the DynamoDB table not existing — AWS returns a
        ClientError with code "ResourceNotFoundException".
        """
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.query.side_effect = ClientError(
            {"Error": {"Code": "ResourceNotFoundException", "Message": "Table not found"}},
            "Query",
        )

        with pytest.raises(RuntimeError, match="table.*not found"):
            fetch_lots_from_dynamodb()

    @patch("src.data.synthetic.boto3.client")
    def test_raises_on_generic_exception(self, mock_boto_client):
        """
        Catch-all: any unexpected error (e.g. network timeout) should be
        wrapped in a RuntimeError with a descriptive message.
        """
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.query.side_effect = Exception("network timeout")

        with pytest.raises(RuntimeError, match="Failed to fetch lots from DynamoDB"):
            fetch_lots_from_dynamodb()


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
        expected_cols = {"lot_id", "timestamp", "occupancy", "available", "occupancy_rate", "confidence", "source"}
        assert expected_cols == set(df.columns)

    def test_all_lots_represented(self, sample_lots):
        """
        Each input lot must generate data.
        Prevent silent dropping due to filtering or logic errors.
        """
        df = generate_all_data(sample_lots, target_per_lot=50)
        assert set(df["lot_id"].unique()) == {"G1", "G2", "E1"}

    def test_source_always_synthetic(self, sample_lots):
        """
        Source column should explicitly tag synthetic origin.
        Enables downstream separation of real vs synthetic data.
        """
        df = generate_all_data(sample_lots, target_per_lot=50)
        assert (df["source"] == "synthetic").all()

    def test_occupancy_rate_in_valid_range(self, sample_lots):
        """
        occupancy_rate must remain normalized in [0, 1].
        Larger sample used to stress boundary behavior.
        """
        df = generate_all_data(sample_lots, target_per_lot=200)
        assert (df["occupancy_rate"] >= 0.0).all()
        assert (df["occupancy_rate"] <= 1.0).all()
