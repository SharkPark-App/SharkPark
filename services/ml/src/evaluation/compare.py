"""
Model comparison for SharkPark ML.

Compares a candidate model against baselines and (optionally) the current
production model. Determines whether the candidate meets promotion criteria.

Promotion criteria (enforced by separate evaluation script):
    - Must beat all baselines (lower MAE) AND
    - Reduce MAE by >=5% vs production OR improve directional accuracy by >=3%

Each evaluate script owns its own promotion decision and thresholds.

Baselines:
    Short-term: PersistenceBaseline, MajorityClassBaseline (coverage-gated)
    Long-term:  caller-provided (Persistence-on-baseline, SameDayLastWeek)
"""

import logging

import pandas as pd

import numpy as np

from src.data.db import get_total_lot_count
from src.models.baselines import (
    HistoricalAverageBaseline,
    MajorityClassBaseline,
    PersistenceBaseline,
    SameDayLastWeekBaseline,
)

logger = logging.getLogger(__name__)

__all__ = [
    "MAE_IMPROVEMENT_THRESHOLD",
    "DIRECTIONAL_ACCURACY_THRESHOLD",
    "COVERAGE_SKIP_THRESHOLD",
    "COVERAGE_PERSISTENCE_THRESHOLD",
    "COVERAGE_ALL_THRESHOLD",
    "COVERAGE_MIN_OBS_BASIC",
    "COVERAGE_MIN_OBS_FULL",
    "COVERAGE_SDLW_THRESHOLD",
    "COVERAGE_MIN_OBS_SDLW",
    "HORIZON_MAE_TARGETS",
    "compute_data_coverage",
    "beats_baselines",
    "meets_promotion_criteria",
    "meets_horizon_targets",
    "build_promotion_reason",
    "build_horizon_promotion_reason",
    "compare_against_baselines",
    "compare_against_long_term_baselines",
    "compare_models",
    "print_comparison_table",
    "print_horizon_table",
]


# =============================================================================
# Promotion Criteria
# =============================================================================

MAE_IMPROVEMENT_THRESHOLD = 0.05  # Serves as promotion criteria
DIRECTIONAL_ACCURACY_THRESHOLD = 3.0  # Percentage points

# Coverage-based baseline validation gates (see Model_Design.md)
COVERAGE_SKIP_THRESHOLD = 0.30
COVERAGE_PERSISTENCE_THRESHOLD = 0.60
COVERAGE_ALL_THRESHOLD = 0.60

COVERAGE_MIN_OBS_BASIC = 2  # min observations per combo for basic gate
COVERAGE_MIN_OBS_FULL = 4  # min observations per combo for full gate

# Long-term SameDayLastWeek needs at least one observation per slot;
# require decent coverage before including it in the comparison.
COVERAGE_SDLW_THRESHOLD = 0.50
COVERAGE_MIN_OBS_SDLW = 1

# Long-term horizon-stratified MAE targets (occupancy-rate scale, 0-1).
# Used as a secondary promotion gate
HORIZON_MAE_TARGETS: dict[int, float] = {
    1: 0.15,
    2: 0.15,
    3: 0.15,
    4: 0.15,
    5: 0.15,
    6: 0.15,
    7: 0.15,
}


def compute_data_coverage(
    raw_df: pd.DataFrame,
    total_lots: int,
    min_observations: int = COVERAGE_MIN_OBS_BASIC,
) -> float:
    """
    Compute data coverage as the fraction of (lot_id, day_of_week, hour)
    combinations with at least `min_observations` real (non-synthetic)
    observations.

    Args:
        raw_df: Raw snapshot DataFrame with lot_id, timestamp columns.
            May contain _source column to filter out synthetic rows.
        total_lots: Total number of lots in the system (from the database).
        min_observations: Minimum observation count per combination.

    Returns:
        Coverage ratio between 0.0 and 1.0.
    """
    df = raw_df.copy()

    # Filter to real data only if _source column exists
    if "_source" in df.columns:
        df = df[df["_source"] != "synthetic"]

    if df.empty:
        return 0.0

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["_dow"] = df["timestamp"].dt.dayofweek
    df["_hour"] = df["timestamp"].dt.hour
    df = df[df["_hour"].between(7, 21)]

    # Count observations per (lot_id, day_of_week, hour)
    counts = df.groupby(["lot_id", "_dow", "_hour"]).size()

    # Total possible combinations across ALL lots in the system
    total_combos = total_lots * 7 * 15  # lots * 7 days × 15 prediction hours (7-21)

    if total_combos == 0:
        return 0.0

    qualifying = (counts >= min_observations).sum()
    return qualifying / total_combos


def beats_baselines(
    candidate_metrics: dict,
    baseline_results: dict,
) -> tuple[bool, list[str]]:
    """
    Check that the candidate model beats all baselines on MAE.

    Args:
        candidate_metrics: Metrics dict with at least "mae" key.
        baseline_results: Dict mapping baseline name to metrics dict.
            Only entries other than "Candidate" and "Production" are checked.

    Returns:
        Tuple of (passed, failed_baselines) where failed_baselines lists
        the names of baselines the candidate did not beat.
    """
    candidate_mae = candidate_metrics["mae"]
    skip = {"Candidate", "Production"}
    failed = []

    # Handles current + future baselines (HistoricalAverage, SameDayLastWeek)
    for name, metrics in baseline_results.items():
        if name in skip:
            continue
        baseline_mae = metrics.get("mae")
        if baseline_mae is not None and candidate_mae >= baseline_mae:
            failed.append(name)

    return (len(failed) == 0, failed)


def meets_promotion_criteria(
    candidate_metrics: dict,
    production_metrics: dict | None = None,
) -> bool:
    """
    Determine if a candidate model should be promoted.

    Args:
        candidate_metrics: Dict with at least "mae" key.
            Optional "directional_accuracy"
        production_metrics: Dict with same keys for current production model.
            None if no production model exists.

    Returns:
        True if the candidate meets promotion criteria.
    """
    if production_metrics is None:
        return True  # Criteria met if production does not exist

    candidate_mae = candidate_metrics["mae"]
    production_mae = production_metrics["mae"]

    # MAE improved by >= threshold
    if production_mae > 0:
        mae_improvement = (production_mae - candidate_mae) / production_mae
        if mae_improvement >= MAE_IMPROVEMENT_THRESHOLD:
            return True

    # Directional accuracy improved by >= threshold percentage points
    candidate_da = candidate_metrics.get("directional_accuracy")
    production_da = production_metrics.get("directional_accuracy")
    if candidate_da is not None and production_da is not None:
        if candidate_da - production_da >= DIRECTIONAL_ACCURACY_THRESHOLD:
            return True

    return False


def meets_horizon_targets(
    horizon_mae: dict[int, float],
    targets: dict[int, float] | None = None,
) -> tuple[bool, list[int]]:
    """
    Check that horizon-stratified MAE meets each horizon's target.

    This is a long-term-specific quality gate: a candidate with poor accuracy
    on specific horizons would pass a flat aggregate-MAE check but should not
    be promoted.

    Args:
        horizon_mae: Dict mapping days_ahead (1-7) to MAE on that horizon.
        targets: Dict mapping days_ahead to target MAE. Defaults to
            HORIZON_MAE_TARGETS.

    Returns:
        Tuple of (passed, failed_days) where failed_days lists horizons that
        exceeded their target.
    """
    if targets is None:
        targets = HORIZON_MAE_TARGETS

    failed = []
    for d, target in targets.items():
        mae = horizon_mae.get(d)
        if mae is None:
            logger.warning("Horizon day %d missing from horizon_mae — skipping target check", d)
            continue
        if mae > target:
            failed.append(d)

    return (len(failed) == 0, failed)


def build_promotion_reason(
    candidate_metrics: dict,
    production_metrics: dict | None,
    should_promote: bool,
    baseline_passed: bool,
    failed_baselines: list[str],
) -> str:
    """
    Build a human-readable promotion reason string.

    Args:
        candidate_metrics: Candidate metrics dict.
        production_metrics: Production metrics dict, or None.
        should_promote: Whether the candidate should be promoted.
        baseline_passed: Whether the candidate beat all baselines.
        failed_baselines: Names of baselines the candidate did not beat.

    Returns:
        Human-readable reason string.
    """
    if not baseline_passed:
        return "Not promoted — candidate did not beat baseline(s): " + ", ".join(
            failed_baselines
        )

    if should_promote and production_metrics is None:
        return "No production model — first deployment"

    if should_promote:
        prod_mae = production_metrics["mae"]
        cand_mae = candidate_metrics["mae"]
        cand_da = candidate_metrics.get("directional_accuracy")
        prod_da = production_metrics.get("directional_accuracy")

        # Report met criterias (MAE/da)
        if cand_da is not None and prod_da is not None:
            da_diff = cand_da - prod_da
            if da_diff >= DIRECTIONAL_ACCURACY_THRESHOLD:
                return f"Directional accuracy improved by {da_diff:.1f} pp"

        mae_pct = (prod_mae - cand_mae) / prod_mae * 100 if prod_mae > 0 else 0
        return f"MAE improved by {mae_pct:.1f}%"

    # Report blocked promotion; actual vs required
    prod_mae = production_metrics["mae"]
    cand_mae = candidate_metrics["mae"]
    reasons = []
    if prod_mae > 0:
        mae_pct = (prod_mae - cand_mae) / prod_mae * 100
        reasons.append(
            f"MAE improved by {mae_pct:.1f}% (need >={MAE_IMPROVEMENT_THRESHOLD * 100:.0f}%)"
        )

    cand_da = candidate_metrics.get("directional_accuracy")
    prod_da = production_metrics.get("directional_accuracy")
    if cand_da is not None and prod_da is not None:
        da_diff = cand_da - prod_da
        reasons.append(
            f"Directional accuracy changed by {da_diff:+.1f} pp (need >={DIRECTIONAL_ACCURACY_THRESHOLD:.0f} pp)"
        )

    return "Not promoted — " + "; ".join(reasons)


# =============================================================================
# Baseline Comparison
# =============================================================================


def compare_against_baselines(
    candidate_metrics: dict,
    test_features: pd.DataFrame,
    raw_df: pd.DataFrame,
    total_lots: int | None = None,
) -> dict:
    """
    Compare candidate model against baseline models using coverage gates.

    Which baselines are included depends on data coverage — the fraction of
    (lot_id, day_of_week, hour) combinations with sufficient real observations.
    See Model_Design.md "Baseline validation gates" for details.

    Coverage gates: <30% skip baselines, 30-60% persistence only, >60% all baselines.

    Args:
        candidate_metrics: Metrics dict for the candidate model.
        test_features: Test set features (from prepare_training_features)
            with target_occupancy_rate column.
        raw_df: Raw snapshot DataFrame used for baseline computation.

    Returns:
        Dict mapping model name to metrics dict. May contain only
        "Candidate" if coverage is too low for baseline comparison.
    """
    results = {"Candidate": candidate_metrics}

    if total_lots is None:
        total_lots = get_total_lot_count()

    # Check basic coverage (≥2 observations per combo)
    basic_coverage = compute_data_coverage(
        raw_df, total_lots, min_observations=COVERAGE_MIN_OBS_BASIC
    )

    if basic_coverage < COVERAGE_SKIP_THRESHOLD:
        logger.info(
            "  Data coverage %.0f%% < %.0f%% — "
            "skipping baseline comparison (not enough real data)",
            basic_coverage * 100,
            COVERAGE_SKIP_THRESHOLD * 100,
        )
        return results

    # Include persistence once we pass the skip threshold
    results["Persistence"] = PersistenceBaseline.evaluate(test_features)

    # Check full coverage (≥4 observations per combo) for pattern-based baselines
    full_coverage = compute_data_coverage(
        raw_df, total_lots, min_observations=COVERAGE_MIN_OBS_FULL
    )

    if full_coverage >= COVERAGE_ALL_THRESHOLD:
        results["MajorityClass"] = MajorityClassBaseline.evaluate(test_features, raw_df)
    else:
        logger.info(
            "  Full coverage %.0f%% < %.0f%% — using persistence baseline only",
            full_coverage * 100,
            COVERAGE_ALL_THRESHOLD * 100,
        )

    return results


def compare_against_long_term_baselines(
    candidate_metrics: dict,
    test_features: pd.DataFrame,
    raw_df: pd.DataFrame,
    actual_rates: np.ndarray,
    total_lots: int | None = None,
) -> dict:
    """
    Compute long-term baseline comparisons using coverage gates.

    Long-term baselines are pattern-based (HistoricalAverage, SameDayLastWeek)
    or global (MajorityClass). Each has different data requirements:

    - MajorityClass: just needs overall data (basic gate ≥30%).
    - HistoricalAverage: needs multiple obs per (lot, dow, hour) to produce
      a trustworthy Stage 1 baseline (full gate ≥60% with ≥4 obs).
    - SameDayLastWeek: needs at least one obs per (lot, dow, hour)
      (dedicated gate ≥50% with ≥1 obs).

    Args:
        candidate_metrics: Candidate model metrics dict.
        test_features: Long-term test features with historical_baseline,
            lot_id, day_of_week, hour.
        raw_df: Raw snapshot DataFrame used to compute baselines.
        actual_rates: Actual occupancy rates for the test set (0-1 scale).
        total_lots: Total lot count for coverage calculation. Fetched from
            DB if not provided.

    Returns:
        Dict mapping model name to metrics dict. Always includes "Candidate";
        each baseline is included only when its coverage gate passes.
    """
    results = {"Candidate": candidate_metrics}

    if total_lots is None:
        total_lots = get_total_lot_count()

    basic_coverage = compute_data_coverage(
        raw_df, total_lots, min_observations=COVERAGE_MIN_OBS_BASIC
    )

    if basic_coverage < COVERAGE_SKIP_THRESHOLD:
        logger.info(
            "  Data coverage %.0f%% < %.0f%% — "
            "skipping baseline comparison (not enough real data)",
            basic_coverage * 100,
            COVERAGE_SKIP_THRESHOLD * 100,
        )
        return results

    # MajorityClass: basic gate is sufficient
    results["MajorityClass"] = MajorityClassBaseline.evaluate(
        test_features, raw_df, actuals=actual_rates
    )

    # SameDayLastWeek: needs at least one obs per slot for most slots
    sdlw_coverage = compute_data_coverage(
        raw_df, total_lots, min_observations=COVERAGE_MIN_OBS_SDLW
    )

    if sdlw_coverage >= COVERAGE_SDLW_THRESHOLD:
        results["SameDayLastWeek"] = SameDayLastWeekBaseline.evaluate(
            test_features, raw_df, actual_rates
        )
    else:
        logger.info(
            "  Slot coverage %.0f%% < %.0f%% — skipping SameDayLastWeek baseline",
            sdlw_coverage * 100,
            COVERAGE_SDLW_THRESHOLD * 100,
        )

    # HistoricalAverage: needs multiple obs per slot for a trustworthy baseline
    full_coverage = compute_data_coverage(
        raw_df, total_lots, min_observations=COVERAGE_MIN_OBS_FULL
    )

    if full_coverage >= COVERAGE_ALL_THRESHOLD:
        results["HistoricalAverage"] = HistoricalAverageBaseline.evaluate(
            test_features, actual_rates
        )
    else:
        logger.info(
            "  Full coverage %.0f%% < %.0f%% — skipping HistoricalAverage baseline",
            full_coverage * 100,
            COVERAGE_ALL_THRESHOLD * 100,
        )

    return results


# =============================================================================
# Full Comparison
# =============================================================================


def compare_models(
    candidate_metrics: dict,
    test_features: pd.DataFrame,
    raw_df: pd.DataFrame,
    production_metrics: dict | None = None,
    total_lots: int | None = None,
    baseline_results: dict | None = None,
) -> dict:
    """
    Run full model comparison: candidate vs baselines vs production.

    Prints the comparison table. Does NOT make a promotion decision —
    each evaluate script owns that via meets_promotion_criteria.

    Args:
        candidate_metrics: Metrics dict for the candidate model.
        test_features: Test set features with target_occupancy_rate.
        raw_df: Raw snapshot DataFrame for coverage-gated baselines.
        production_metrics: Metrics for current production model, or None.
        total_lots: Total lot count for coverage calculation. Fetched from
            DB if not provided (short-term path only).
        baseline_results: Pre-computed baseline metrics dict (long-term path).
            Coverage gating is applied upstream by compare_against_long_term_baselines
            before this is called — only baselines that passed their gates are included.

    Returns:
        Dict with:
            - results: {model_name: metrics_dict}
            - baseline_passed: bool — whether candidate beat all baselines
            - failed_baselines: list[str] — baselines the candidate did not beat
    """
    if baseline_results is not None:
        # Long-term path: coverage gating already applied by compare_against_long_term_baselines
        results = {"Candidate": candidate_metrics, **baseline_results}
    else:
        # Short-term path: coverage-gated baseline selection
        results = compare_against_baselines(
            candidate_metrics, test_features, raw_df, total_lots=total_lots
        )

    if production_metrics is not None:
        results["Production"] = production_metrics

    print_comparison_table(results)

    baseline_passed, failed_baselines = beats_baselines(candidate_metrics, results)

    return {
        "results": results,
        "baseline_passed": baseline_passed,
        "failed_baselines": failed_baselines,
    }


def print_comparison_table(results: dict) -> None:
    """Print a formatted comparison table to stdout."""
    logger.info("\n" + "=" * 60)
    logger.info("MODEL COMPARISON")
    logger.info("=" * 60)
    logger.info("%-30s %8s %8s %8s", "Model", "MAE", "RMSE", "MAPE")
    logger.info("-" * 60)
    for name, metrics in results.items():
        mae = metrics.get("mae", float("nan"))
        rmse = metrics.get("rmse", float("nan"))
        mape = metrics.get("mape", float("nan"))
        logger.info("%-30s %8.4f %8.4f %7.1f%%", name, mae, rmse, mape)
    logger.info("=" * 60)


def print_horizon_table(
    horizon_mae: dict[int, float],
    targets: dict[int, float] | None = None,
) -> None:
    """Print a formatted horizon-stratified MAE table to stdout."""
    if targets is None:
        targets = HORIZON_MAE_TARGETS

    logger.info("\n" + "=" * 55)
    logger.info("HORIZON-STRATIFIED MAE")
    logger.info("=" * 55)
    logger.info("  %-12s %8s  %8s  %s", "Days Ahead", "MAE", "Target", "")
    logger.info("  " + "-" * 45)
    for day in sorted(targets.keys()):
        mae = horizon_mae.get(day, float("nan"))
        target = targets[day]
        status = "PASS" if mae <= target else "FAIL"
        logger.info("  Day %-8d %8.4f  < %.2f    %s", day, mae, target, status)
    logger.info("=" * 55)


def build_horizon_promotion_reason(
    horizon_passed: bool,
    failed_days: list[int],
    targets: dict[int, float] | None = None,
) -> str | None:
    """
    Build a reason string for a horizon-target failure, or None if passed.

    Args:
        horizon_passed: Whether every horizon met its target.
        failed_days: Days that exceeded their target MAE.
        targets: Targets dict used for the check (for error messages).

    Returns:
        Reason string if horizon gate failed, else None.
    """
    if horizon_passed:
        return None

    if targets is None:
        targets = HORIZON_MAE_TARGETS

    pieces = [f"Day {d} (target <{targets[d]:.2f})" for d in failed_days]
    return "Not promoted — horizon targets missed: " + ", ".join(pieces)
