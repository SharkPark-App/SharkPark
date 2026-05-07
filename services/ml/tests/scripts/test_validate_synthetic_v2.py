"""Tests for `scripts.validate_synthetic_v2` (D4 / F5)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest

from scripts import validate_synthetic_v2 as mod


def _make_frame(*, lot_ids: list[str], start: datetime, hours: int, rate_fn) -> pd.DataFrame:
    """Build a snapshot-shaped frame with a single value per (lot, 15-min tick)."""
    rows = []
    for lot in lot_ids:
        for h in range(hours):
            for q in range(4):  # 4 ticks/hour
                ts = start + timedelta(hours=h, minutes=15 * q)
                rows.append(
                    {
                        "lot_id": lot,
                        "timestamp": ts,
                        "occupancy_rate": float(rate_fn(lot, h)),
                    }
                )
    return pd.DataFrame(rows)


def test_aggregate_by_lot_hour_handles_empty_frame():
    out = mod._aggregate_by_lot_hour(pd.DataFrame(), label="x")
    assert list(out.columns) == ["lot_id", "hour", "mean_rate"]
    assert out.empty


def test_aggregate_collapses_ticks_into_hour_means():
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    df = _make_frame(lot_ids=["G1"], start=start, hours=2, rate_fn=lambda lot, h: 0.10 * (h + 1))
    out = mod._aggregate_by_lot_hour(df, label="real")
    assert sorted(out.columns) == ["hour", "lot_id", "mean_rate"]
    assert len(out) == 2  # 2 hours
    assert pytest.approx(out.set_index("hour").loc[0, "mean_rate"]) == 0.10
    assert pytest.approx(out.set_index("hour").loc[1, "mean_rate"]) == 0.20


def test_compute_mae_perfect_match_is_zero():
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    real = _make_frame(lot_ids=["G1", "G2"], start=start, hours=24, rate_fn=lambda lot, h: h / 23.0)
    synth = real.copy()
    overall, per_lot = mod.compute_mae(real, synth)
    assert overall == 0.0
    assert {p.lot_id for p in per_lot} == {"G1", "G2"}
    assert all(p.mae == 0.0 for p in per_lot)
    assert all(p.sample_count == 24 for p in per_lot)


def test_compute_mae_constant_offset_equals_offset():
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    real = _make_frame(lot_ids=["G1"], start=start, hours=24, rate_fn=lambda lot, h: 0.5)
    synth = _make_frame(lot_ids=["G1"], start=start, hours=24, rate_fn=lambda lot, h: 0.3)
    overall, per_lot = mod.compute_mae(real, synth)
    assert pytest.approx(overall, abs=1e-9) == 0.2
    assert pytest.approx(per_lot[0].mae, abs=1e-9) == 0.2


def test_compute_mae_raises_when_no_overlap():
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    real = _make_frame(lot_ids=["A"], start=start, hours=4, rate_fn=lambda lot, h: 0.5)
    synth = _make_frame(lot_ids=["B"], start=start, hours=4, rate_fn=lambda lot, h: 0.5)
    with pytest.raises(RuntimeError, match="No \\(lot, hour\\) buckets"):
        mod.compute_mae(real, synth)


def test_render_overlay_png_writes_file(tmp_path: Path):
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    real = _make_frame(lot_ids=["G1", "G2"], start=start, hours=24, rate_fn=lambda lot, h: 0.4)
    synth = _make_frame(lot_ids=["G1", "G2"], start=start, hours=24, rate_fn=lambda lot, h: 0.5)
    out = tmp_path / "sub" / "synthetic_overlay.png"
    mod.render_overlay_png(real, synth, out_path=out, title="t")
    assert out.is_file()
    # PNG magic header.
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_run_returns_pass_metadata_and_writes_png(tmp_path: Path):
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    real = _make_frame(lot_ids=["G1"], start=start, hours=24, rate_fn=lambda lot, h: 0.5)
    synth = real.copy()  # zero MAE
    out = tmp_path / "synthetic_overlay.png"

    with patch.object(mod, "load_real_snapshots", return_value=real), patch.object(
        mod, "load_synthetic_v2_snapshots", return_value=synth
    ):
        meta, code = mod.run(
            school="CSULB",
            term="Spring_2026",
            week_start=date(2026, 2, 23),
            out_path=out,
            target_mae=0.25,
        )

    assert code == 0
    assert meta["passed"] is True
    assert meta["overall_mae"] == 0.0
    assert meta["lots_evaluated"] == 1
    assert meta["per_lot"][0]["lot_id"] == "G1"
    assert out.is_file()


def test_run_returns_exit_code_2_when_over_target(tmp_path: Path):
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    real = _make_frame(lot_ids=["G1"], start=start, hours=24, rate_fn=lambda lot, h: 0.9)
    synth = _make_frame(lot_ids=["G1"], start=start, hours=24, rate_fn=lambda lot, h: 0.1)
    out = tmp_path / "synthetic_overlay.png"

    with patch.object(mod, "load_real_snapshots", return_value=real), patch.object(
        mod, "load_synthetic_v2_snapshots", return_value=synth
    ):
        meta, code = mod.run(
            school="CSULB",
            term="Spring_2026",
            week_start=date(2026, 2, 23),
            out_path=out,
            target_mae=0.25,
        )

    assert code == 2
    assert meta["passed"] is False
    assert meta["overall_mae"] == pytest.approx(0.8)


def test_run_raises_when_real_empty(tmp_path: Path):
    with patch.object(mod, "load_real_snapshots", return_value=pd.DataFrame()), patch.object(
        mod, "load_synthetic_v2_snapshots", return_value=pd.DataFrame()
    ):
        with pytest.raises(RuntimeError, match="No real occupancy_snapshots"):
            mod.run(
                school="CSULB",
                term="Spring_2026",
                week_start=date(2026, 2, 23),
                out_path=tmp_path / "x.png",
                target_mae=0.25,
            )


def test_run_raises_when_synth_empty(tmp_path: Path):
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    real = _make_frame(lot_ids=["G1"], start=start, hours=4, rate_fn=lambda lot, h: 0.5)
    with patch.object(mod, "load_real_snapshots", return_value=real), patch.object(
        mod, "load_synthetic_v2_snapshots", return_value=pd.DataFrame()
    ):
        with pytest.raises(RuntimeError, match="No v2 synthetic_observations"):
            mod.run(
                school="CSULB",
                term="Spring_2026",
                week_start=date(2026, 2, 23),
                out_path=tmp_path / "x.png",
                target_mae=0.25,
            )


def test_main_emits_ml_result_line(tmp_path: Path, capsys):
    start = datetime(2026, 2, 23, 0, 0, tzinfo=timezone.utc)
    real = _make_frame(lot_ids=["G1"], start=start, hours=4, rate_fn=lambda lot, h: 0.5)
    synth = real.copy()
    out = tmp_path / "synthetic_overlay.png"

    with patch.object(mod, "load_real_snapshots", return_value=real), patch.object(
        mod, "load_synthetic_v2_snapshots", return_value=synth
    ):
        rc = mod.main(
            [
                "--school",
                "CSULB",
                "--term",
                "Spring_2026",
                "--week-start",
                "2026-02-23",
                "--out",
                str(out),
                "--target-mae",
                "0.25",
            ]
        )
    assert rc == 0
    captured = capsys.readouterr()
    line = next(
        (line for line in captured.out.splitlines() if line.startswith("ML_RESULT:")),
        None,
    )
    assert line is not None, captured.out
    assert '"task": "validate_synthetic_v2"' in line
    assert '"passed": true' in line
