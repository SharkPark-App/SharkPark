"""
validate_synthetic_v2.py — D4 deliverable.

Compares the catalog-driven v2 synthetic occupancy generator against
the real `occupancy_snapshots` it is meant to imitate, and renders the
artifact consumed by the F-tier admin dashboard
(`/api/admin/ml-status/dashboard`).

What it does
------------
1. Pulls real `occupancy_snapshots` for [--week-start, --week-start+7d).
2. Pulls v2 `synthetic_observations` for the same window (same school+term).
3. For every (lot, hour-of-day) bucket present in BOTH tables, averages
   `occupancy_rate` separately for each source, then computes
   |real_avg − synth_avg|. Reports per-lot MAE, overall MAE, and a
   pass/fail flag against `--target-mae`.
4. Renders an inline overlay PNG (matplotlib, no GUI) to `--out`:
     * x-axis: hour of day (0..23)
     * y-axis: mean occupancy_rate
     * one subplot per lot, two lines (real solid, synthetic dashed).
   The dashboard streams this file via `/api/admin/ml-status/synthetic-overlay.png`.
5. Emits one `ML_RESULT: {…}` line on stdout for `_ml-runner.ts` to capture
   into `ml_cron_runs.metadata`. Logs go to stderr.

Operator usage
--------------
    cd services/ml
    python -m scripts.validate_synthetic_v2 \
        --school CSULB --term Spring_2026 \
        --week-start 2026-02-23 \
        --out ../../apps/backend/public/ml-artifacts/synthetic_overlay.png \
        --target-mae 0.25

Exit codes
----------
    0 — overlay written; MAE ≤ target.
    2 — overlay written; MAE > target. (Caller decides whether to surface
        as a job failure; F-dashboard renders both states.)
    Any other non-zero — hard error (no DB, no rows, unknown school, etc.).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

from src.data.db import load_real_snapshots, load_synthetic_v2_snapshots

logger = logging.getLogger(__name__)

# Headless backend MUST be set before pyplot import — we never need a GUI.
os.environ.setdefault("MPLBACKEND", "Agg")


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


@dataclass(frozen=True)
class LotMae:
    lot_id: str
    mae: float
    sample_count: int


def _aggregate_by_lot_hour(df: pd.DataFrame, *, label: str) -> pd.DataFrame:
    """
    Reduce a snapshot frame to one row per (lot_id, hour_of_day) with
    `mean_rate` = average `occupancy_rate`. Returns an empty frame
    (with the right columns) when the input is empty.
    """
    if df.empty:
        return pd.DataFrame(columns=["lot_id", "hour", "mean_rate"])
    work = df[["lot_id", "timestamp", "occupancy_rate"]].copy()
    work["timestamp"] = pd.to_datetime(work["timestamp"], utc=True)
    work["hour"] = work["timestamp"].dt.hour.astype(int)
    out = (
        work.groupby(["lot_id", "hour"], as_index=False)["occupancy_rate"]
        .mean()
        .rename(columns={"occupancy_rate": "mean_rate"})
    )
    logger.debug("Aggregated %s frame: %d (lot, hour) rows", label, len(out))
    return out


def compute_mae(real: pd.DataFrame, synth: pd.DataFrame) -> tuple[float, list[LotMae]]:
    """
    Inner-join the per-(lot, hour) means and compute MAE per lot + overall.
    Returns (overall_mae, per_lot). Raises RuntimeError if no overlap.
    """
    real_agg = _aggregate_by_lot_hour(real, label="real")
    synth_agg = _aggregate_by_lot_hour(synth, label="synthetic")
    merged = real_agg.merge(
        synth_agg,
        on=["lot_id", "hour"],
        how="inner",
        suffixes=("_real", "_synth"),
    )
    if merged.empty:
        raise RuntimeError(
            "No (lot, hour) buckets are present in BOTH real and synthetic "
            "frames — cannot compute MAE. Verify the requested week has "
            "overlapping coverage."
        )
    merged["abs_err"] = (merged["mean_rate_real"] - merged["mean_rate_synth"]).abs()
    per_lot_df = (
        merged.groupby("lot_id")
        .agg(mae=("abs_err", "mean"), sample_count=("abs_err", "size"))
        .reset_index()
        .sort_values("lot_id")
    )
    per_lot = [
        LotMae(
            lot_id=str(row.lot_id),
            mae=float(row.mae),
            sample_count=int(row.sample_count),
        )
        for row in per_lot_df.itertuples(index=False)
    ]
    overall = float(merged["abs_err"].mean())
    return overall, per_lot


def render_overlay_png(
    real: pd.DataFrame,
    synth: pd.DataFrame,
    *,
    out_path: Path,
    title: str,
) -> None:
    """
    Render the faceted hourly overlay PNG (one subplot per lot present in
    EITHER frame). Imports matplotlib lazily so test-only callers that
    don't render don't pay the import cost.
    """
    import matplotlib

    matplotlib.use("Agg", force=True)
    import matplotlib.pyplot as plt

    real_agg = _aggregate_by_lot_hour(real, label="real")
    synth_agg = _aggregate_by_lot_hour(synth, label="synthetic")
    lots = sorted(set(real_agg["lot_id"]).union(synth_agg["lot_id"]))
    if not lots:
        raise RuntimeError("No lots in either real or synthetic frames; nothing to plot.")

    n = len(lots)
    cols = min(3, n)
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(
        rows,
        cols,
        figsize=(cols * 4.2, rows * 2.8),
        sharex=True,
        sharey=True,
        squeeze=False,
    )

    hours = list(range(24))
    for idx, lot_id in enumerate(lots):
        r, c = divmod(idx, cols)
        ax = axes[r][c]
        real_lot = real_agg[real_agg["lot_id"] == lot_id].set_index("hour").reindex(hours)
        synth_lot = synth_agg[synth_agg["lot_id"] == lot_id].set_index("hour").reindex(hours)
        ax.plot(
            hours,
            real_lot["mean_rate"].values,
            label="real",
            color="#0d6efd",
            linewidth=1.6,
        )
        ax.plot(
            hours,
            synth_lot["mean_rate"].values,
            label="synthetic v2",
            color="#dc3545",
            linewidth=1.4,
            linestyle="--",
        )
        ax.set_title(lot_id, fontsize=10)
        ax.set_ylim(0.0, 1.0)
        ax.set_xlim(0, 23)
        ax.grid(True, alpha=0.25, linewidth=0.5)
        if c == 0:
            ax.set_ylabel("mean occupancy_rate")
        if r == rows - 1:
            ax.set_xlabel("hour of day (UTC)")

    # Hide leftover empty subplots in the last row.
    for idx in range(n, rows * cols):
        r, c = divmod(idx, cols)
        axes[r][c].set_visible(False)

    handles, labels = axes[0][0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper right", frameon=False)
    fig.suptitle(title, fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, 0.96))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=110, format="png")
    plt.close(fig)
    logger.info("Wrote overlay PNG to %s", out_path)


def run(
    *,
    school: str,
    term: str,
    week_start: date,
    out_path: Path,
    target_mae: float,
) -> tuple[dict, int]:
    """
    Execute the validation pipeline. Returns (metadata, exit_code).
    Exit code matches module docstring contract (0 pass, 2 over-target).
    """
    week_end = week_start + timedelta(days=7)
    start_iso = week_start.isoformat()
    end_iso = week_end.isoformat()
    logger.info(
        "Loading real & synthetic v2 snapshots for %s/%s [%s, %s)",
        school,
        term,
        start_iso,
        end_iso,
    )

    real = load_real_snapshots(start_date=start_iso, end_date=end_iso)
    synth = load_synthetic_v2_snapshots(
        school_short_name=school,
        term=term,
        start_date=start_iso,
        end_date=end_iso,
    )
    if real.empty:
        raise RuntimeError(
            f"No real occupancy_snapshots found in [{start_iso}, {end_iso}). "
            "Pick a --week-start that has real telemetry coverage."
        )
    if synth.empty:
        raise RuntimeError(
            f"No v2 synthetic_observations found for school={school!r} "
            f"term={term!r} in [{start_iso}, {end_iso}). Run "
            "generate_synthetic_v2 first."
        )

    overall_mae, per_lot = compute_mae(real, synth)
    title = (
        f"Synthetic v2 vs real — {school} {term} — "
        f"week of {week_start.isoformat()} — overall MAE {overall_mae:.4f}"
    )
    render_overlay_png(real, synth, out_path=out_path, title=title)

    passed = overall_mae <= target_mae
    metadata = {
        "task": "validate_synthetic_v2",
        "school": school,
        "term": term,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "target_mae": round(float(target_mae), 4),
        "overall_mae": round(float(overall_mae), 4),
        "passed": passed,
        "real_rows": int(len(real)),
        "synthetic_rows": int(len(synth)),
        "lots_evaluated": len(per_lot),
        "per_lot": [
            {"lot_id": p.lot_id, "mae": round(p.mae, 4), "sample_count": p.sample_count}
            for p in per_lot
        ],
        "out_path": str(out_path),
    }
    return metadata, (0 if passed else 2)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--school", required=True, help="School short_name (e.g. CSULB).")
    parser.add_argument("--term", required=True, help="Term tag, e.g. Spring_2026.")
    parser.add_argument(
        "--week-start",
        required=True,
        type=_parse_date,
        help="Inclusive UTC date for the 7-day comparison window (YYYY-MM-DD).",
    )
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Destination PNG path. Parent dir is created if missing.",
    )
    parser.add_argument(
        "--target-mae",
        type=float,
        default=0.25,
        help="Pass threshold for overall MAE (default 0.25).",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    metadata, code = run(
        school=args.school,
        term=args.term,
        week_start=args.week_start,
        out_path=args.out,
        target_mae=args.target_mae,
    )
    print("ML_RESULT: " + json.dumps(metadata))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
