-- C1: per-lot/dow_bucket/hour EWMA penetration-rate estimates.
-- Recomputed daily by services/ml/scripts/recompute_penetration_rates.py.
CREATE TABLE "penetration_rate_estimates" (
    "lot_id" TEXT NOT NULL,
    "dow_bucket" INTEGER NOT NULL,
    "hour_bucket" INTEGER NOT NULL,
    "ewma_value" DOUBLE PRECISION NOT NULL,
    "ewma_variance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penetration_rate_estimates_pkey" PRIMARY KEY ("lot_id", "dow_bucket", "hour_bucket")
);

ALTER TABLE "penetration_rate_estimates"
    ADD CONSTRAINT "penetration_rate_estimates_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
