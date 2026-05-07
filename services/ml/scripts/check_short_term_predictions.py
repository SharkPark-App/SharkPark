"""
Inspection tool for short-term predictions in the database.

predictions_short_term is append-only; this script dedupes to the
freshest `predicted_at` per (lot_id, target_time) so output reflects the
current forecast, matching how the backend serves it.

Usage (from services/ml/):
    python -m scripts.check_short_term_predictions
    python -m scripts.check_short_term_predictions --limit 20
    python -m scripts.check_short_term_predictions --lot G1 --date 2026-03-31
    python -m scripts.check_short_term_predictions --version v1.2.0
"""

import argparse
import logging
from contextlib import closing

from src.data.db import get_connection, get_lot_id_map

logger = logging.getLogger(__name__)


def check_predictions(
    limit: int = 50,
    lot: str | None = None,
    date: str | None = None,
    version: str | None = None,
) -> list[tuple]:
    """
    Query and display short-term predictions from the database.

    Args:
        limit: Maximum rows to display (1-1000).
        lot: Filter by human-readable lot_id (e.g. "G1").
        date: Filter by target_time date (YYYY-MM-DD).
        version: Filter by model_version.

    Returns:
        List of matching prediction rows.
    """
    limit = max(1, min(limit, 1000))

    with closing(get_connection()) as conn:
        with conn.cursor() as cur:
            lot_id_map = get_lot_id_map(conn)
            reverse_map = {v: k for k, v in lot_id_map.items()}

            conditions = []
            params = []

            if lot:
                lot_upper = lot.upper()
                cuid = lot_id_map.get(lot_upper)
                if cuid is None:
                    known = ", ".join(sorted(lot_id_map))
                    raise ValueError(
                        f"Lot '{lot_upper}' not found. Known lots: {known}"
                    )
                conditions.append("lot_id = %s")
                params.append(cuid)
            if date:
                conditions.append("target_time::date = %s")
                params.append(date)
            if version:
                conditions.append("model_version = %s")
                params.append(version)

            where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"""
                SELECT * FROM (
                    SELECT DISTINCT ON (lot_id, target_time)
                           lot_id, predicted_at, target_time,
                           predicted_occupancy, confidence_lower, confidence_upper,
                           model_version
                    FROM predictions_short_term
                    {where}
                    ORDER BY lot_id, target_time, predicted_at DESC
                ) latest
                ORDER BY lot_id, target_time
                LIMIT %s
            """,
                params + [limit],
            )

            rows = cur.fetchall()

    if not rows:
        logger.info("(no predictions found)")
        return rows

    logger.info("\nShort-Term Predictions (%d rows):", len(rows))
    logger.info(
        "%-10s %-22s %-22s %6s %6s %6s %7s",
        "lot_id",
        "predicted_at",
        "target_time",
        "occ",
        "low",
        "high",
        "version",
    )
    logger.info("-" * 80)
    for row in rows:
        lot_cuid, predicted_at, target_time, occ, low, high, ver = row
        lot_label = reverse_map.get(lot_cuid, lot_cuid)
        logger.info(
            "%-10s %-22s %-22s %6.3f %6.3f %6.3f %7s",
            lot_label,
            str(predicted_at)[:22],
            str(target_time)[:22],
            occ,
            low,
            high,
            ver,
        )

    if len(rows) == limit:
        logger.info("\n(showing %d rows — use --limit to see more)", limit)

    return rows


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(
        description="Inspect short-term predictions in the database"
    )
    parser.add_argument(
        "--limit", type=int, default=50, help="Max rows to display (default: 50)"
    )
    parser.add_argument("--lot", default=None, help='Filter by lot_id (e.g. "G1")')
    parser.add_argument(
        "--date", default=None, help="Filter by target_time date (YYYY-MM-DD)"
    )
    parser.add_argument("--version", default=None, help="Filter by model_version")
    args = parser.parse_args()

    check_predictions(
        limit=args.limit,
        lot=args.lot,
        date=args.date,
        version=args.version,
    )
