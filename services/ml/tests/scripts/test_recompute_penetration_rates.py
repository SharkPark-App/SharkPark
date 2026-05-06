"""
Unit tests for scripts/recompute_penetration_rates.py.

Focus on the pure math + bucket mapping helpers; the DB-glue functions
(_fetch_*, _upsert) are exercised end-to-end in integration tests run
in CI against a Postgres instance and are not duplicated here.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

import pytest

from scripts.recompute_penetration_rates import (
    EWMA_ALPHA,
    BucketKey,
    ExistingState,
    _apply_ewma,
    _resolve_yesterday_window,
    dow_to_bucket,
    recompute,
)


class TestDowToBucket:
    def test_monday_through_friday_are_weekday(self) -> None:
        for iso_weekday in (1, 2, 3, 4, 5):
            assert dow_to_bucket(iso_weekday) == 0

    def test_saturday(self) -> None:
        assert dow_to_bucket(6) == 1

    def test_sunday(self) -> None:
        assert dow_to_bucket(7) == 2


class TestApplyEwma:
    def test_first_sample_seeds_value_with_zero_variance(self) -> None:
        s = _apply_ewma(None, 0.42)
        assert s.ewma_value == 0.42
        assert s.ewma_variance == 0.0
        assert s.sample_count == 1

    def test_first_sample_when_existing_zero_count_seeds(self) -> None:
        s = _apply_ewma(ExistingState(0.0, 0.0, 0), 0.7)
        assert s.ewma_value == 0.7
        assert s.sample_count == 1

    def test_subsequent_update_uses_alpha_blend(self) -> None:
        existing = ExistingState(ewma_value=0.50, ewma_variance=0.0, sample_count=5)
        new = _apply_ewma(existing, 1.00)
        # 0.9*0.50 + 0.1*1.00 = 0.55
        assert new.ewma_value == pytest.approx(0.55)
        # residual = 0.5 -> 0.9*0 + 0.1*0.25 = 0.025
        assert new.ewma_variance == pytest.approx(0.025)
        assert new.sample_count == 6

    def test_variance_stays_non_negative_and_responds_to_residual(self) -> None:
        s = ExistingState(ewma_value=0.30, ewma_variance=0.04, sample_count=20)
        # Negative residual contributes positively to variance (squared).
        new = _apply_ewma(s, 0.10)
        assert new.ewma_variance > 0
        # Both formulas produce identical results for opposite-sign residuals.
        symmetric = _apply_ewma(s, 0.50)
        assert new.ewma_variance == pytest.approx(symmetric.ewma_variance)

    def test_alpha_constant(self) -> None:
        # Defensive: changes here must be coordinated with C3.
        assert EWMA_ALPHA == 0.1


class TestResolveYesterdayWindow:
    def test_default_uses_yesterday_local_midnight(self) -> None:
        tz_name = "America/Los_Angeles"
        tz = ZoneInfo(tz_name)
        utc_start, utc_end, local_date = _resolve_yesterday_window(tz_name, None)
        # Window length is exactly 24 hours (no DST today is fine because
        # DST transitions happen on Sundays at 02:00; we only check delta).
        assert (utc_end - utc_start) in (timedelta(hours=24), timedelta(hours=23), timedelta(hours=25))
        assert utc_start.tzinfo is timezone.utc
        # local_date is yesterday in the school timezone
        expected_yesterday = (datetime.now(tz) - timedelta(days=1)).strftime("%Y-%m-%d")
        assert local_date == expected_yesterday

    def test_override_date_pins_window(self) -> None:
        utc_start, utc_end, local_date = _resolve_yesterday_window(
            "America/Los_Angeles", "2026-05-07"
        )
        assert local_date == "2026-05-07"
        # 2026-05-07 00:00 PDT = 2026-05-07 07:00 UTC (PDT = UTC-7)
        assert utc_start == datetime(2026, 5, 7, 7, 0, tzinfo=timezone.utc)
        assert utc_end == datetime(2026, 5, 8, 7, 0, tzinfo=timezone.utc)


class TestRecomputeIntegrationWithMockedDb:
    """End-to-end of recompute() with the DB layer fully mocked."""

    def _fake_conn_with_rows(self, rows, school_tz: str = "America/Los_Angeles", existing=None):
        cur = MagicMock()
        # Three queries are issued in order:
        #  1. SELECT timezone FROM schools ...
        #  2. SELECT ... FROM consensus_observations ...
        #  3. SELECT ... FROM penetration_rate_estimates WHERE (lot_id, ...) IN %s
        existing_rows = existing or []
        cur.fetchone.return_value = (school_tz,)
        cur.fetchall.side_effect = [rows, existing_rows]

        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        return conn, cur

    def test_no_rows_emits_no_op_marker(self, capsys) -> None:
        conn, cur = self._fake_conn_with_rows([])
        with patch("scripts.recompute_penetration_rates.get_connection") as gc:
            gc.return_value.__enter__.return_value = conn
            metadata = recompute(date_override="2026-05-07")
        assert metadata["buckets_updated"] == 0
        captured = capsys.readouterr()
        assert "ML_RESULT:" in captured.out
        assert '"no_op_reason": "no_ground_truth_rows"' in captured.out

    def test_aggregates_rows_into_buckets_and_upserts(self, capsys) -> None:
        # 2 rows in the same bucket (lot=L1, dow_bucket=0, hour=10) — one
        # day before today PT, weekday at 10 AM local.
        # Use 2026-05-07 (Thursday, ISO weekday 4) — dow_bucket=0.
        utc_10am_pdt = datetime(2026, 5, 7, 17, 0, tzinfo=timezone.utc)  # 10:00 PDT
        rows = [
            ("L1", utc_10am_pdt, 6, 30),  # sample = 0.20
            ("L1", utc_10am_pdt + timedelta(minutes=5), 8, 32),  # sample = 0.25
        ]
        conn, cur = self._fake_conn_with_rows(rows)
        with patch("scripts.recompute_penetration_rates.get_connection") as gc:
            gc.return_value.__enter__.return_value = conn
            metadata = recompute(date_override="2026-05-07")

        assert metadata["buckets_updated"] == 1
        assert metadata["rows_examined"] == 2
        assert metadata["alpha"] == 0.1
        # The aggregated sample = (0.20 + 0.25) / 2 = 0.225, first time so EWMA seeds.
        # Find the INSERT call:
        insert_calls = [c for c in cur.execute.call_args_list if "INSERT INTO penetration_rate_estimates" in c.args[0]]
        assert len(insert_calls) == 1
        params = insert_calls[0].args[1]
        # params = (lot_id, dow, hour, ewma_value, ewma_variance, sample_count, last_updated)
        assert params[0] == "L1"
        assert params[1] == 0  # weekday bucket
        assert params[2] == 10  # 10:00 local
        assert params[3] == pytest.approx(0.225)
        assert params[4] == 0.0
        assert params[5] == 1
        conn.commit.assert_called_once()

    def test_clamps_extreme_samples(self, capsys) -> None:
        # contributor=100, observed=1 → sample would be 100 → clamp to 1.0
        utc = datetime(2026, 5, 7, 17, 0, tzinfo=timezone.utc)
        rows = [("L1", utc, 100, 1)]
        conn, cur = self._fake_conn_with_rows(rows)
        with patch("scripts.recompute_penetration_rates.get_connection") as gc:
            gc.return_value.__enter__.return_value = conn
            recompute(date_override="2026-05-07")
        insert_call = next(c for c in cur.execute.call_args_list if "INSERT INTO penetration_rate_estimates" in c.args[0])
        params = insert_call.args[1]
        assert params[3] == 1.0  # clamped to SAMPLE_MAX
