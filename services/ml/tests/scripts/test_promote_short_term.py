"""
Tests for the promotion script (scripts/promote_short_term.py).

Covers:
    - Happy path: promote registers model and sets production alias
    - Error: invalid run ID returns None
    - Error: registration failure returns None
    - Error: alias failure still returns version

Run from services/ml/:
    python -m pytest tests/scripts/test_promote.py -v
"""

from unittest.mock import patch

import mlflow
import pytest

from scripts.promote_short_term import promote
from scripts.train_short_term import train
from src.config import SHORT_TERM_MODEL_NAME


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def _use_isolated_mlflow(isolated_mlflow):
    """Ensure all tests in this module use isolated MLflow tracking."""


@pytest.fixture()
def trained_run_id(data_parquet):
    """Train a model and return its run ID for promotion tests."""
    return train(data_parquet)


# =============================================================================
# Tests
# =============================================================================


class TestPromote:
    """Verify promotion script registers and aliases models correctly."""

    def test_promote_registers_and_aliases(self, trained_run_id):
        """Promotion should register the model and set the production alias."""
        version = promote(trained_run_id)

        assert version is not None

        # Verify the production alias points to this version
        client = mlflow.tracking.MlflowClient()
        mv = client.get_model_version_by_alias(SHORT_TERM_MODEL_NAME, "production")
        assert mv.version == version
        assert mv.run_id == trained_run_id

    def test_promote_invalid_run_id_returns_none(self):
        """Promotion with a non-existent run ID should return None."""
        result = promote("nonexistent_run_id_12345")
        assert result is None

    def test_promote_mlflow_system_error_raises(self):
        """MLflow system errors should propagate, not return None."""
        exc = mlflow.exceptions.MlflowException(
            "internal error", error_code=mlflow.exceptions.INTERNAL_ERROR
        )
        with patch("mlflow.tracking.MlflowClient.get_run", side_effect=exc):
            with pytest.raises(
                mlflow.exceptions.MlflowException, match="internal error"
            ):
                promote("any-run-id")

    def test_promote_replaces_previous_production(self, data_parquet):
        """Promoting a second model should move the production alias."""
        run_id_1 = train(data_parquet)
        run_id_2 = train(data_parquet)

        version_1 = promote(run_id_1)
        version_2 = promote(run_id_2)

        assert version_1 is not None
        assert version_2 is not None
        assert version_1 != version_2

        # Production alias should point to the latest promotion
        client = mlflow.tracking.MlflowClient()
        mv = client.get_model_version_by_alias(SHORT_TERM_MODEL_NAME, "production")
        assert mv.version == version_2
