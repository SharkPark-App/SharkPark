"""
Model comparison for SharkPark ML.

Compares a candidate model against baselines and (optionally) the current
production model. Determines whether the candidate meets promotion criteria.

Promotion criteria:
    - Must beat all baselines (lower MAE) AND
    - Reduce MAE by >=5% vs production OR improve directional accuracy by >=3%

Baselines used for short-term comparison:
    - PersistenceBaseline: current occupancy stays the same
    - MajorityClassBaseline: always predict global median

Note:
- HistoricalAverageBaseline and SameDayLastWeekBaseline depend on
long_term.py which is not yet implemented. They will be added to the
comparison once available.
- Currently only short-term model comparison is supported. When long-term
is implemented, scripts should accept a --model-type flag to select
which features, model class, and baselines to use.
"""

import logging

import pandas as pd

from src.data.db import get_total_lot_count
from src.models.baselines import MajorityClassBaseline, PersistenceBaseline

logger = logging.getLogger(__name__)

__all__ = [
    "MAE_IMPROVEMENT_THRESHOLD",
    "DIRECTIONAL_ACCURACY_THRESHOLD",
    "COVERAGE_SKIP_THRESHOLD",
    "COVERAGE_PERSISTENCE_THRESHOLD",
    "COVERAGE_ALL_THRESHOLD",
    "COVERAGE_MIN_OBS_BASIC",
    "COVERAGE_MIN_OBS_FULL",
    "compute_data_coverage",
    "beats_baselines",
    "meets_promotion_criteria",
    "compare_against_baselines",
    "compare_models",
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

    # MAE improved by >=5%
    if production_mae > 0:
        mae_improvement = (production_mae - candidate_mae) / production_mae
        if mae_improvement >= MAE_IMPROVEMENT_THRESHOLD:
            return True

    # Directional accuracy improved by >=3 percentage points
    candidate_da = candidate_metrics.get("directional_accuracy")
    production_da = production_metrics.get("directional_accuracy")
    if candidate_da is not None and production_da is not None:
        if candidate_da - production_da >= DIRECTIONAL_ACCURACY_THRESHOLD:
            return True

    return False


# =============================================================================
# Baseline Comparison
# =============================================================================


def compare_against_baselines(
    candidate_metrics: dict,
    test_features: pd.DataFrame,
    raw_df: pd.DataFrame,
) -> dict:
    """
    Compare candidate model against baseline models.

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
        # TODO: add HistoricalAverage and SameDayLastWeek once long_term.py is implemented
    else:
        logger.info(
            "  Full coverage %.0f%% < %.0f%% — using persistence baseline only",
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
) -> dict:
    """
    Run full model comparison: candidate vs baselines vs production.

    Args:
        candidate_metrics: Metrics dict for the candidate model.
        test_features: Test set features with target_occupancy_rate.
        raw_df: Raw snapshot DataFrame for baselines.
        production_metrics: Metrics for current production model, or None.

    Returns:
        Dict with:
            - results: {model_name: metrics_dict}
            - should_promote: bool
            - promotion_reason: str or None
    """
    # Compare candidate metrics w/ baseline
    results = compare_against_baselines(candidate_metrics, test_features, raw_df)

    # Include production metrics
    if production_metrics is not None:
        results["Production"] = production_metrics

    _print_comparison_table(results)

    # Baseline gate; candidate must beat all baselines
    baseline_passed, failed_baselines = beats_baselines(candidate_metrics, results)

    # Production criteria (requires passing baseline gate)
    should_promote = baseline_passed and meets_promotion_criteria(
        candidate_metrics, production_metrics
    )

    # Determine (non)promotion reasoning
    promotion_reason = None
    if not baseline_passed:
        promotion_reason = (
            "Not promoted — candidate did not beat baseline(s): "
            + ", ".join(failed_baselines)
        )
    elif should_promote and production_metrics is not None:
        prod_mae = production_metrics["mae"]
        cand_mae = candidate_metrics["mae"]

        # Compute mae improvement
        if prod_mae > 0:
            mae_pct = (prod_mae - cand_mae) / prod_mae * 100
            promotion_reason = f"MAE improved by {mae_pct:.1f}%"

        # Compute da improvement
        cand_da = candidate_metrics.get("directional_accuracy")
        prod_da = production_metrics.get("directional_accuracy")

        if cand_da is not None and prod_da is not None:
            da_diff = cand_da - prod_da
            if da_diff >= DIRECTIONAL_ACCURACY_THRESHOLD:
                promotion_reason = f"Directional accuracy improved by {da_diff:.1f} pp"
    elif should_promote:
        promotion_reason = "No production model — first deployment"
    elif production_metrics is not None:  # denied promotion
        prod_mae = production_metrics["mae"]
        cand_mae = candidate_metrics["mae"]

        # Compile reasons for denied promotion
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
        promotion_reason = (
            "Not promoted — " + "; ".join(reasons)
            if reasons
            else "Not promoted — no measurable improvement"
        )

    return {
        "results": results,
        "should_promote": should_promote,
        "promotion_reason": promotion_reason,
    }


def _print_comparison_table(results: dict) -> None:
    """Print a formatted comparison table to stdout."""
    logger.info("\n" + "=" * 60)
    logger.info("MODEL COMPARISON")
    logger.info("=" * 60)
    logger.info("%-20s %8s %8s %8s", "Model", "MAE", "RMSE", "MAPE")
    logger.info("-" * 60)
    for name, metrics in results.items():
        mae = metrics.get("mae", float("nan"))
        rmse = metrics.get("rmse", float("nan"))
        mape = metrics.get("mape", float("nan"))
        logger.info("%-20s %8.4f %8.4f %7.1f%%", name, mae, rmse, mape)
    logger.info("=" * 60)
