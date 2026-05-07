-- B1: ConsensusObservation — per-lot 5-minute consensus windows built from
-- contributor pings. Computed live by snapshot.job and densely backfilled
-- for the last 90 days by scripts/backfill-consensus.ts. See the
-- ConsensusObservation model docstring in schema.prisma for the math.

CREATE TABLE "consensus_observations" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "contributor_count" INTEGER NOT NULL,
    "agreement_score" DOUBLE PRECISION NOT NULL,
    "observed_occupancy" INTEGER NOT NULL,
    "observed_rate" DOUBLE PRECISION NOT NULL,
    "is_ground_truth" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consensus_observations_pkey" PRIMARY KEY ("id")
);

-- Idempotency for live writes + backfill: one row per (lot, 5-min bucket).
CREATE UNIQUE INDEX "consensus_observations_lot_id_window_start_key"
    ON "consensus_observations"("lot_id", "window_start");

-- Ground-truth filter index used by training-data exporters.
CREATE INDEX "idx_consensus_lot_window_truth"
    ON "consensus_observations"("lot_id", "window_start", "is_ground_truth");

ALTER TABLE "consensus_observations"
    ADD CONSTRAINT "consensus_observations_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "lots"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
