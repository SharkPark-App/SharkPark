-- D4: Course-catalog driven synthetic occupancy training set.
-- See the `SyntheticObservation` model docstring in schema.prisma for
-- the full rationale (separate from `occupancy_snapshots` to keep real
-- / synthetic / multi-version cleanly partitioned).

CREATE TABLE "synthetic_observations" (
    "id"                TEXT NOT NULL,
    "school_id"         TEXT NOT NULL,
    "lot_id"            TEXT NOT NULL,
    "timestamp"         TIMESTAMP(3) NOT NULL,
    "occupancy"         INTEGER NOT NULL,
    "occupancy_rate"    DOUBLE PRECISION NOT NULL,
    "generator_version" TEXT NOT NULL,
    "term"              TEXT NOT NULL,
    "sample_weight"     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "generated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "synthetic_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "synthetic_observations_lot_id_timestamp_generator_version_key"
    ON "synthetic_observations"("lot_id", "timestamp", "generator_version");

CREATE INDEX "synthetic_observations_school_id_term_generator_version_idx"
    ON "synthetic_observations"("school_id", "term", "generator_version");

CREATE INDEX "synthetic_observations_lot_id_timestamp_idx"
    ON "synthetic_observations"("lot_id", "timestamp");

ALTER TABLE "synthetic_observations" ADD CONSTRAINT "synthetic_observations_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "synthetic_observations" ADD CONSTRAINT "synthetic_observations_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
