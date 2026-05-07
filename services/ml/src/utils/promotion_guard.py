"""
Auto-promotion guard for SharkPark ML models.

Decides whether a freshly-trained candidate run should be promoted to
``@production`` in the MLflow Model Registry, based on hold-out metrics
recorded by ``evaluate_short_term.py`` / ``evaluate_long_term.py``.

## Decision rules (all must hold)

1. **Candidate has the metric.** ``mae`` (or ``mae_holdout``) must be
   present and finite. Missing metric → no promotion (training run
   probably crashed before evaluation finished).

2. **Absolute floor.** Candidate ``mae`` ≤ ``ML_PROMOTE_MAX_MAE_<HORIZON>``
   (default 0.20 fraction-occupied for short-term, 0.25 for long-term).
   Catches a regression that beats a worse-still production model on
   relative basis but is itself useless.

3. **Relative improvement.** Either:
   a. There is no current ``@production`` model (cold start — promote
      anything that passes the floor), OR
   b. ``candidate.mae`` < ``current.mae`` × (1 - min_improvement_pct/100).
      Default min_improvement_pct = 1.0 — we require at least a 1% MAE
      reduction to justify the version churn. Flipping for noise-level
      gains adds risk (cache busting, R2 downloads, prediction drift)
      without reward.

4. **Coverage sanity.** If the candidate logged ``coverage_80``, it must
   be in [0.7, 0.9] — outside that band means the predicted intervals
   are mis-calibrated, regardless of MAE. A model with great point
   estimates but pathological intervals is worse for users.

## Env overrides

- ``ML_PROMOTE_MIN_IMPROVEMENT_PCT`` (float, default 1.0)
- ``ML_PROMOTE_MAX_MAE_SHORT_TERM`` (float, default 0.20)
- ``ML_PROMOTE_MAX_MAE_LONG_TERM`` (float, default 0.25)

All three are reads at decision time so they can be tuned via Fly /
GitHub Actions secrets without a code change.
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass

import mlflow
from mlflow.tracking import MlflowClient

from src.utils.mlflow_setup import configure_mlflow

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PromotionDecision:
    """Output of the auto-promotion guard."""

    promote: bool
    reason: str
    candidate_metrics: dict[str, float]
    current_metrics: dict[str, float] | None
    candidate_run_id: str
    current_version: str | None


def _floor_for(model_name: str) -> float:
    if "short" in model_name:
        env = "ML_PROMOTE_MAX_MAE_SHORT_TERM"
        default = 0.20
    else:
        env = "ML_PROMOTE_MAX_MAE_LONG_TERM"
        default = 0.25
    raw = os.environ.get(env)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Ignoring non-numeric %s=%r; using default %s", env, raw, default)
        return default


def _min_improvement_pct() -> float:
    raw = os.environ.get("ML_PROMOTE_MIN_IMPROVEMENT_PCT")
    if raw is None:
        return 1.0
    try:
        return float(raw)
    except ValueError:
        logger.warning(
            "Ignoring non-numeric ML_PROMOTE_MIN_IMPROVEMENT_PCT=%r; using default 1.0",
            raw,
        )
        return 1.0


def _extract_mae(metrics: dict[str, float]) -> float | None:
    """``mae_holdout`` (preferred when present, written by evaluate_*) wins
    over ``mae`` (training metric, less trustworthy as a promotion signal)."""
    for key in ("mae_holdout", "mae"):
        val = metrics.get(key)
        if val is None:
            continue
        if isinstance(val, (int, float)) and math.isfinite(val):
            return float(val)
    return None


def evaluate_promotion_candidate(
    candidate_run_id: str,
    model_name: str,
) -> PromotionDecision:
    """
    Apply the four-rule decision matrix above and return a structured verdict.

    Always returns — never raises for "no promotion" outcomes (those are
    expected operating states, not errors). Raises on infrastructure failures
    only (MLflow unreachable, run not found).
    """
    configure_mlflow()
    client = MlflowClient()

    candidate_run = client.get_run(candidate_run_id)
    candidate_metrics = dict(candidate_run.data.metrics or {})
    candidate_mae = _extract_mae(candidate_metrics)

    # Resolve current @production for the relative comparison.
    current_metrics: dict[str, float] | None = None
    current_version: str | None = None
    try:
        current_mv = client.get_model_version_by_alias(model_name, "production")
        current_version = current_mv.version
        current_run = client.get_run(current_mv.run_id) if current_mv.run_id else None
        if current_run is not None:
            current_metrics = dict(current_run.data.metrics or {})
    except mlflow.exceptions.MlflowException:
        # No @production set yet — cold start path.
        current_metrics = None

    def verdict(promote: bool, reason: str) -> PromotionDecision:
        return PromotionDecision(
            promote=promote,
            reason=reason,
            candidate_metrics=candidate_metrics,
            current_metrics=current_metrics,
            candidate_run_id=candidate_run_id,
            current_version=current_version,
        )

    # Rule 1: candidate must have a usable MAE.
    if candidate_mae is None:
        return verdict(False, "candidate has no finite mae/mae_holdout metric")

    # Rule 2: absolute floor.
    floor = _floor_for(model_name)
    if candidate_mae > floor:
        return verdict(
            False,
            f"candidate mae={candidate_mae:.4f} exceeds absolute floor {floor:.4f}",
        )

    # Rule 4 (checked before Rule 3 so coverage failures aren't masked by
    # a missing baseline): coverage sanity if logged.
    cov = candidate_metrics.get("coverage_80")
    if cov is not None and isinstance(cov, (int, float)) and math.isfinite(cov):
        if cov < 0.70 or cov > 0.90:
            return verdict(
                False,
                f"candidate coverage_80={cov:.3f} outside calibrated band [0.70, 0.90]",
            )

    # Rule 3: relative improvement.
    if current_metrics is None:
        return verdict(
            True,
            f"cold start — no current @production; promoting candidate (mae={candidate_mae:.4f})",
        )

    current_mae = _extract_mae(current_metrics)
    if current_mae is None:
        return verdict(
            True,
            f"current @production v{current_version} has no comparable mae; "
            f"promoting candidate (mae={candidate_mae:.4f}) to restore baseline",
        )

    min_pct = _min_improvement_pct()
    threshold = current_mae * (1.0 - min_pct / 100.0)
    if candidate_mae < threshold:
        delta_pct = (current_mae - candidate_mae) / current_mae * 100.0
        return verdict(
            True,
            f"candidate mae={candidate_mae:.4f} beats @production v{current_version} "
            f"mae={current_mae:.4f} by {delta_pct:.2f}% (threshold {min_pct:.2f}%)",
        )

    delta_pct = (current_mae - candidate_mae) / current_mae * 100.0
    return verdict(
        False,
        f"candidate mae={candidate_mae:.4f} does not beat @production v{current_version} "
        f"mae={current_mae:.4f} by {min_pct:.2f}% (actual {delta_pct:+.2f}%)",
    )
