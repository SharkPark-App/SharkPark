"""
Quick helper to inspect predictions_short_term rows in the database.

Usage (from services/ml/):
    python -m scripts.check_predictions
"""

from src.data.db import get_connection


def main():
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM predictions_short_term")
        total = cur.fetchone()[0]
        print(f"Total rows: {total}\n")

        if total == 0:
            print("(no predictions in database)")
            conn.close()
            return

        cur.execute("""
            SELECT lot_id, predicted_at, target_time,
                   predicted_occupancy, confidence_lower, confidence_upper,
                   model_version
            FROM predictions_short_term
            ORDER BY lot_id, target_time            
        """)
        rows = cur.fetchall()

        # Header
        print(
            f"{'lot_id':<29} {'predicted_at':<22} {'target_time':<22} "
            f"{'occ':>5} {'low':>5} {'high':>5} {'version':>7}"
        )
        print("-" * 100)

        for row in rows:
            lot_id, predicted_at, target_time, occ, low, high, version = row
            print(
                f"{lot_id:<29} {str(predicted_at):<22} {str(target_time):<22} "
                f"{occ:>5} {low:>5} {high:>5} {version:>7}"
            )

    conn.close()


if __name__ == "__main__":
    main()
