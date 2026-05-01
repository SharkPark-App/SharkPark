"""
Inspection tool for long-term predictions in the database.

Usage:
    python -m scripts.check_long_term_predictions
    python -m scripts.check_long_term_predictions --limit 20
    python -m scripts.check_long_term_predictions --lot G1
    python -m scripts.check_long_term_predictions --date 2026-04-10
    python -m scripts.check_long_term_predictions --days-ahead 1
    python -m scripts.check_long_term_predictions --summary
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
    days_ahead: int | None = None,
    summary: bool = False,
) -> list[tuple]:
    """
    Query and display long-term predictions from the database.

    Args:
        limit: Maximum rows to display (1-1000).
        lot: Filter by human-readable lot_id (e.g. "G1").
        date: Filter by target_date (YYYY-MM-DD).
        days_ahead: Filter to predictions N days from today (1-7).
        summary: Print coverage summary instead of row data.

    Returns:
        List of matching prediction rows.
    """
    limit = max(1, min(limit, 1000))

    with closing(get_connection()) as conn:
        with conn.cursor() as cur:
            lot_id_map = get_lot_id_map(conn)
            reverse_map = {v: k for k, v in lot_id_map.items()}

            if summary:
                cur.execute("""
                    SELECT
                        DATE(target_date) AS target_date,
                        COUNT(DISTINCT lot_id) AS lots,
                        COUNT(*) AS total_rows,
                        AVG(predicted_occupancy) AS avg_predicted,
                        MIN(predicted_at) AS predicted_at
                    FROM predictions_long_term
                    GROUP BY DATE(target_date)
                    ORDER BY target_date
                """)
                rows = cur.fetchall()

                if not rows:
                    logger.info("No long-term predictions found in database.")
                    return rows

                logger.info("\nLong-Term Predictions Summary:")
                logger.info("=" * 65)
                logger.info(
                    "%-12s %6s %10s %12s  %s",
                    "Date",
                    "Lots",
                    "Rows",
                    "Avg Pred",
                    "Predicted At",
                )

                logger.info("-" * 65)
                for target_date, lots, total_rows, avg_predicted, predicted_at in rows:
                    logger.info(
                        "%-12s %6d %10d %12.3f  %s",
                        str(target_date)[:10],
                        int(lots),
                        int(total_rows),
                        float(avg_predicted),
                        str(predicted_at)[:19],
                    )
                logger.info("=" * 65)
                return rows

            # Build query with optional filters
            conditions = []
            params = []

            if lot:
                lot_upper = lot.upper()
                if lot_upper not in lot_id_map:
                    raise ValueError(f"Lot '{lot_upper}' not found in database.")
                conditions.append("p.lot_id = %s")
                params.append(lot_id_map[lot_upper])

            if date:
                conditions.append("DATE(p.target_date) = %s")
                params.append(date)

            if days_ahead is not None:
                conditions.append(
                    "DATE(p.target_date) = DATE(NOW() + make_interval(days => %s))"
                )
                params.append(days_ahead)

            where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"""
                SELECT p.lot_id, p.predicted_at, p.target_date, p.target_hour,
                       p.predicted_occupancy, p.confidence_lower, p.confidence_upper,
                       p.model_version
                FROM predictions_long_term p
                {where}
                ORDER BY p.target_date, p.target_hour, p.lot_id
                LIMIT %s
            """,
                params + [limit],
            )

            rows = cur.fetchall()

    if not rows:
        logger.info("No predictions found matching the given filters.")
        return rows

    logger.info("\nLong-Term Predictions (%d rows):", len(rows))
    logger.info("=" * 90)
    logger.info(
        "%-8s %-19s %-12s %5s %10s %10s %10s %s",
        "Lot",
        "Predicted At",
        "Target Date",
        "Hour",
        "Predicted",
        "Lower",
        "Upper",
        "Version",
    )
    logger.info("-" * 90)
    for lot_cuid, predicted_at, target_date, hour, pred, lower, upper, ver in rows:
        lot_label = reverse_map.get(lot_cuid, lot_cuid)
        logger.info(
            "%-8s %-19s %-12s %5d %10.3f %10.3f %10.3f %s",
            lot_label,
            str(predicted_at)[:19],
            str(target_date)[:10],
            int(hour),
            pred,
            lower,
            upper,
            ver,
        )
    logger.info("=" * 90)

    return rows


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(
        description="Inspect long-term predictions in the database"
    )
    parser.add_argument(
        "--limit", type=int, default=50, help="Max rows to display (default: 50)"
    )
    parser.add_argument("--lot", default=None, help='Filter by lot_id (e.g. "G1")')
    parser.add_argument(
        "--date", default=None, help="Filter by target_date (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--days-ahead",
        type=int,
        default=None,
        metavar="N",
        help="Filter to predictions N days from today (1-7)",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Print coverage summary instead of individual rows",
    )
    args = parser.parse_args()

    check_predictions(
        limit=args.limit,
        lot=args.lot,
        date=args.date,
        days_ahead=args.days_ahead,
        summary=args.summary,
    )
