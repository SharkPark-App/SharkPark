"""
Shared pytest fixtures for the ML service test suite.

Centralises sample data creation so that schema changes only need
updating in one place.
"""

import random

import numpy as np
import pandas as pd
import pytest

from src.data.synthetic import LotInfo, generate_all_data, resolve_semester


# =============================================================================
# Reproducibility
# =============================================================================


@pytest.fixture(autouse=True)
def fixed_seed():
    """Fix random seeds for reproducibility across all tests."""
    random.seed(42)
    np.random.seed(42)


# =============================================================================
# Lot definitions
# =============================================================================


@pytest.fixture
def sample_lots():
    """Standard set of lot definitions used across test modules."""
    return [
        LotInfo("G1", 180, "STUDENT"),
        LotInfo("G2", 425, "STUDENT"),
        LotInfo("E1", 185, "EMPLOYEE"),
    ]


@pytest.fixture(scope="module")
def sample_lots_minimal():
    """Minimal two-lot subset for faster tests."""
    return [
        LotInfo("G1", 180, "STUDENT"),
        LotInfo("E1", 185, "EMPLOYEE"),
    ]


# =============================================================================
# Snapshot DataFrames
# =============================================================================


@pytest.fixture
def sample_snapshot_df():
    """A small, valid snapshot DataFrame matching the expected schema.

    Columns: lot_id, timestamp, occupancy, occupancy_rate, confidence,
             semester, academic_period, week_of_semester, is_campus_open.
    """
    return pd.DataFrame(
        {
            "lot_id": ["G1", "G1", "G1"],
            "timestamp": pd.to_datetime(
                [
                    "2025-10-15T10:00:00",
                    "2025-10-15T14:00:00",
                    "2025-10-15T18:00:00",
                ]
            ),
            "occupancy": [50, 100, 80],
            "occupancy_rate": [0.3, 0.6, 0.5],
            "confidence": ["HIGH", "HIGH", "HIGH"],
            "semester": ["fall", "fall", "fall"],
            "academic_period": ["midterms", "midterms", "midterms"],
            "week_of_semester": [5, 5, 5],
            "is_campus_open": [True, True, True],
        }
    )


# =============================================================================
# Synthetic datasets
# =============================================================================


@pytest.fixture
def fall_2025_cfg():
    """Default semester config for tests."""
    return resolve_semester("fall-2025")


@pytest.fixture(scope="module")
def fall_2025_cfg_module():
    """Module-scoped semester config for heavier test fixtures."""
    return resolve_semester("fall-2025")


@pytest.fixture(scope="module")
def synthetic_df(sample_lots_minimal, fall_2025_cfg_module):
    """Generate a small synthetic dataset for training / integration tests."""
    random.seed(42)
    np.random.seed(42)
    return generate_all_data(sample_lots_minimal, fall_2025_cfg_module, max_per_lot=200)
