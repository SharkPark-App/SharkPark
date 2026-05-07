"""
Tests for ``BaseXGBoostModel._build_sample_weights`` (D5 — 4-tier weighting
with per-row v2 ``sample_weight`` and per-lot decay for synthetic rows).

The function is a pure ``@staticmethod`` so we exercise it directly without
spinning up the full training loop.

Run from ``services/ml/``::

    python -m pytest tests/models/test_sample_weights.py -v
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.models.short_term import ShortTermModel


_BUILD = ShortTermModel._build_sample_weights


def _make_df(rows: list[dict]) -> pd.DataFrame:
    """Build a minimal feature DF with the columns the weighter inspects."""
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Tier classification + volume normalisation
# ---------------------------------------------------------------------------


def test_returns_uniform_when_source_column_missing():
    df = pd.DataFrame({"lot_id": ["A", "B", "C"]})
    w = _BUILD(df, synthetic_weight=0.1, cold_start_weight=0.5)
    assert w.tolist() == [1.0, 1.0, 1.0]


def test_real_clean_is_reference_tier_and_gets_real_weight():
    # 4 real_clean rows (reference) + 2 v1 synthetic rows.
    # ref_size = 4. real_weight=10 -> per row 10*4/4 = 10. v1 -> 0.1*4/2 = 0.2.
    df = _make_df(
        [
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            {"_source": "synthetic", "is_cold_start": True, "lot_id": "B"},
            {"_source": "synthetic", "is_cold_start": True, "lot_id": "B"},
        ]
    )
    w = _BUILD(
        df,
        synthetic_weight=0.1,
        cold_start_weight=1.0,
        real_weight=10.0,
        synthetic_v2_weight=1.0,
        per_lot_decay=False,
    )
    np.testing.assert_allclose(w[:4], 10.0)
    np.testing.assert_allclose(w[4:], 0.2)


def test_four_tier_split_matches_spec_ratios():
    # 2 of each tier; ref_size = 2 (real_clean wins). Each tier total = weight*2.
    df = _make_df(
        [
            # real_clean
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            # real_cold
            {"_source": "real", "is_cold_start": True, "lot_id": "C"},
            {"_source": "real", "is_cold_start": True, "lot_id": "C"},
            # v2 synthetic
            {
                "_source": "synthetic",
                "is_cold_start": False,
                "lot_id": "D",
                "generator_version": "v2",
                "sample_weight": 1.0,
            },
            {
                "_source": "synthetic",
                "is_cold_start": False,
                "lot_id": "D",
                "generator_version": "v2",
                "sample_weight": 1.0,
            },
            # v1 synthetic
            {
                "_source": "synthetic",
                "is_cold_start": True,
                "lot_id": "E",
                "generator_version": "v1",
            },
            {
                "_source": "synthetic",
                "is_cold_start": True,
                "lot_id": "E",
                "generator_version": "v1",
            },
        ]
    )
    w = _BUILD(
        df,
        synthetic_weight=0.1,
        cold_start_weight=2.0,
        real_weight=10.0,
        synthetic_v2_weight=1.0,
        per_lot_decay=False,
    )
    # ref_size = 2; per-row weight = tier_weight * ref_size / n_in_tier.
    assert pytest.approx(w[0]) == 10.0  # real_clean
    assert pytest.approx(w[2]) == 2.0  # real_cold
    assert pytest.approx(w[4]) == 1.0  # v2 (uniform per-row)
    assert pytest.approx(w[6]) == 0.1  # v1


def test_per_row_v2_sample_weight_is_mean_normalised():
    # 4 v2 rows with per-row weights [2, 4, 1, 1] (mean = 2). After
    # normalisation per-row factors are [1, 2, 0.5, 0.5]. With
    # synthetic_v2_weight=1 and ref_size=n_v2=4, base = 1*4/4 = 1.
    df = _make_df(
        [
            # one real_clean to anchor ref_size at 1 and exercise mixing
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            *(
                {
                    "_source": "synthetic",
                    "is_cold_start": False,
                    "lot_id": "B",
                    "generator_version": "v2",
                    "sample_weight": sw,
                }
                for sw in (2.0, 4.0, 1.0, 1.0)
            ),
        ]
    )
    w = _BUILD(
        df,
        synthetic_weight=0.1,
        cold_start_weight=1.0,
        real_weight=1.0,
        synthetic_v2_weight=1.0,
        per_lot_decay=False,
    )
    # ref_size = 1 (one real_clean), base_v2 = 1*1/4 = 0.25.
    expected = np.array([1.0, 0.25 * 1.0, 0.25 * 2.0, 0.25 * 0.5, 0.25 * 0.5])
    np.testing.assert_allclose(w, expected)


def test_per_row_v2_handles_all_zero_sample_weight_gracefully():
    # All-zero per-row weights would otherwise emit NaN/0. We fall back to
    # uniform per-row scaling so XGBoost still trains.
    df = _make_df(
        [
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            {
                "_source": "synthetic",
                "is_cold_start": False,
                "lot_id": "B",
                "generator_version": "v2",
                "sample_weight": 0.0,
            },
            {
                "_source": "synthetic",
                "is_cold_start": False,
                "lot_id": "B",
                "generator_version": "v2",
                "sample_weight": 0.0,
            },
        ]
    )
    w = _BUILD(
        df,
        synthetic_weight=0.1,
        cold_start_weight=1.0,
        real_weight=1.0,
        synthetic_v2_weight=1.0,
        per_lot_decay=False,
    )
    assert np.all(np.isfinite(w))
    # base_v2 = 1*1/2 = 0.5, per-row falls back to 1.0.
    np.testing.assert_allclose(w[1:], [0.5, 0.5])


# ---------------------------------------------------------------------------
# Per-lot decay
# ---------------------------------------------------------------------------


def test_per_lot_decay_shrinks_synthetic_for_well_covered_lots():
    # Lot A: 100 real rows. Lot B: 0 real rows. Both have 1 synthetic v2 row.
    # Decay: A -> 1/(1+100/100) = 0.5; B -> 1/(1+0/100) = 1.0.
    rows: list[dict] = []
    rows.extend(
        {"_source": "real", "is_cold_start": False, "lot_id": "A"}
        for _ in range(100)
    )
    rows.append(
        {
            "_source": "synthetic",
            "is_cold_start": False,
            "lot_id": "A",
            "generator_version": "v2",
            "sample_weight": 1.0,
        }
    )
    rows.append(
        {
            "_source": "synthetic",
            "is_cold_start": False,
            "lot_id": "B",
            "generator_version": "v2",
            "sample_weight": 1.0,
        }
    )
    df = _make_df(rows)
    w_decay = _BUILD(
        df,
        synthetic_weight=0.1,
        cold_start_weight=1.0,
        real_weight=10.0,
        synthetic_v2_weight=1.0,
        per_lot_decay=True,
    )
    w_no_decay = _BUILD(
        df,
        synthetic_weight=0.1,
        cold_start_weight=1.0,
        real_weight=10.0,
        synthetic_v2_weight=1.0,
        per_lot_decay=False,
    )
    # Real rows unaffected by decay.
    np.testing.assert_allclose(w_decay[:100], w_no_decay[:100])
    # Synthetic-on-A halved; synthetic-on-B unchanged.
    assert pytest.approx(w_decay[-2]) == w_no_decay[-2] * 0.5
    assert pytest.approx(w_decay[-1]) == w_no_decay[-1] * 1.0


def test_per_lot_decay_no_op_when_no_real_rows():
    df = _make_df(
        [
            {
                "_source": "synthetic",
                "is_cold_start": False,
                "lot_id": "A",
                "generator_version": "v2",
                "sample_weight": 1.0,
            },
            {
                "_source": "synthetic",
                "is_cold_start": False,
                "lot_id": "B",
                "generator_version": "v2",
                "sample_weight": 1.0,
            },
        ]
    )
    w = _BUILD(
        df,
        synthetic_weight=0.1,
        cold_start_weight=1.0,
        real_weight=10.0,
        synthetic_v2_weight=1.0,
        per_lot_decay=True,
    )
    # ref_size falls back to v2 (n_v2=2), base = 1*2/2 = 1.0; no decay applied.
    np.testing.assert_allclose(w, [1.0, 1.0])


def test_backward_compat_three_tier_call_signature():
    # Old callers that omit the keyword-only args should still work and
    # produce the legacy 3-tier behaviour (real_weight=1, syn_v2_weight=1).
    df = _make_df(
        [
            {"_source": "real", "is_cold_start": False, "lot_id": "A"},
            {"_source": "real", "is_cold_start": True, "lot_id": "C"},
            {"_source": "synthetic", "is_cold_start": True, "lot_id": "B"},
        ]
    )
    w = _BUILD(df, synthetic_weight=0.3, cold_start_weight=0.5)
    assert pytest.approx(w[0]) == 1.0
    assert pytest.approx(w[1]) == 0.5
    assert pytest.approx(w[2]) == 0.3
