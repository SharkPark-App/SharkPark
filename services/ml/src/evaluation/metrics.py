"""
Metric computation for SharkPark ML model evaluation.

Primary metric: MAE (Mean Absolute Error)
Secondary: RMSE, MAPE
Target: MAE < 10% of lot capacity (i.e. < 0.10 for occupancy rates in [0, 1])

Usage:
    metrics = compute_metrics(y_true, y_pred)
    # {"mae": 0.042, "rmse": 0.058, "mape": 8.3}
"""

import numpy as np

MAE_TARGET_THRESHOLD = 0.10  # Serves as model quality gate


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """
    Compute MAE, RMSE, and MAPE between actual and predicted values.

    Args:
        y_true: Array of actual values.
        y_pred: Array of predicted values.

    Returns:
        Dict with keys: mae, rmse, mape.
        MAPE is expressed as a percentage (e.g. 8.3 means 8.3%).
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)

    # Compute MAE(mean absolute error)
    mae = float(np.mean(np.abs(y_true - y_pred)))

    # Compute RMSE (root mean squared error)
    rmse = float(np.sqrt(np.mean((y_true - y_pred) ** 2)))

    # Compute MAPE (mean absolute percentage error)
    # Exclude near-zero actuals — MAPE is undefined when y_true ≈ 0
    mask = np.abs(y_true) > 0.05
    if np.any(mask):
        mape = float(
            np.mean(np.abs(y_true[mask] - y_pred[mask]) / np.abs(y_true[mask])) * 100
        )
    else:
        mape = float("nan")

    return {"mae": mae, "rmse": rmse, "mape": mape}


def meets_mae_target(mae: float) -> bool:
    """
    Check whether MAE meets the short-term target.

    Args:
        mae: Mean Absolute Error on occupancy rates.

    Returns:
        True if MAE is below the target threshold.
    """
    return mae < MAE_TARGET_THRESHOLD


def compute_directional_accuracy(
    y_true: np.ndarray, y_pred: np.ndarray, y_current: np.ndarray
) -> float:
    """
    Compute directional accuracy: percentage of predictions where the
    predicted direction (up/down from current) matches the actual direction.

    Args:
        y_true: Array of actual future values.
        y_pred: Array of predicted future values.
        y_current: Array of current values (baseline for direction).

    Returns:
        Directional accuracy as a percentage (0-100).
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    y_current = np.asarray(y_current, dtype=float)

    # Convert into trend (1: incr, 0: no change, -1: decr)
    actual_direction = np.sign(y_true - y_current)
    predicted_direction = np.sign(y_pred - y_current)

    correct = np.sum(actual_direction == predicted_direction)
    return float((correct / len(y_true)) * 100) if len(y_true) > 0 else 0.0
