"""
Quick helper to inspect predictions_short_term rows in the database.

Usage (from services/ml/):
    python -m scripts.check_predictions
    python -m scripts.check_predictions --limit 20
    python -m scripts.check_predictions --lot G1 --date 2026-03-31
    python -m scripts.check_predictions --version v1.2.0
"""

import argparse
from contextlib import closing

from src.data.db import get_connection, get_lot_id_map


def main():
    parser = argparse.ArgumentParser(description="Inspect predictions_short_term rows.")
    parser.add_argument(
        "--limit", type=int, default=50, help="Max rows to fetch (default: 50)"
    )
    parser.add_argument("--lot", type=str, default=None, help="Filter by lot_id")
    parser.add_argument(
        "--date", type=str, default=None, help="Filter by target_time date (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--version", type=str, default=None, help="Filter by model_version"
    )
    args = parser.parse_args()

    if args.limit < 1 or args.limit > 1000:
        parser.error("--limit must be between 1 and 1000")

    with closing(get_connection()) as conn:
        with conn.cursor() as cur:
            lot_id_map = get_lot_id_map(conn)

            conditions = []
            params = []

            if args.lot:
                cuid = lot_id_map.get(args.lot)
                if cuid is None:
                    known = ", ".join(sorted(lot_id_map))
                    parser.error(f"Unknown lot '{args.lot}'. \nKnown lots: {known}")
                conditions.append("lot_id = %s")
                params.append(cuid)
            if args.date:
                conditions.append("target_time::date = %s")
                params.append(args.date)
            if args.version:
                conditions.append("model_version = %s")
                params.append(args.version)

            where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            cur.execute(
                f"""
                SELECT lot_id, predicted_at, target_time,
                       predicted_occupancy, confidence_lower, confidence_upper,
                       model_version
                FROM predictions_short_term
                {where}
                ORDER BY lot_id, target_time
                LIMIT %s
            """,
                params + [args.limit],
            )

            rows = cur.fetchall()
            if not rows:
                print("(no predictions found)")
                return

            print(f"Showing {len(rows)} prediction(s)\n")
            reverse_map = {v: k for k, v in lot_id_map.items()}

            print(
                f"{'lot_id':<10} {'predicted_at':<22} {'target_time':<22} "
                f"{'occ':>5} {'low':>5} {'high':>5} {'version':>7}"
            )
            print("-" * 80)
            for row in rows:
                lot_cuid, predicted_at, target_time, occ, low, high, version = row
                lot_label = reverse_map.get(lot_cuid, lot_cuid)
                print(
                    f"{lot_label:<10} {str(predicted_at):<22} {str(target_time):<22} "
                    f"{occ:>5} {low:>5} {high:>5} {version:>7}"
                )

            if len(rows) == args.limit:
                print(f"\n(showing {args.limit} rows — use --limit to see more)")


if __name__ == "__main__":
    main()
