-- D3: Computed (lot × building) proximity matrix used by the D4 synthetic
-- generator. See `LotBuildingProximity` model in schema.prisma for the
-- semantics. Refreshed weekly by services/ml/scripts/build_proximity_matrix.py
-- (Sat 02:30 PT, after the room-capacities scrape at 02:00).

CREATE TABLE "lot_building_proximity" (
    "lot_id"      TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "school_id"   TEXT NOT NULL,
    "distance_m"  DOUBLE PRECISION NOT NULL,
    "weight"      DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_building_proximity_pkey" PRIMARY KEY ("lot_id", "building_id")
);

CREATE INDEX "lot_building_proximity_school_id_idx"
    ON "lot_building_proximity"("school_id");

CREATE INDEX "lot_building_proximity_building_id_idx"
    ON "lot_building_proximity"("building_id");

ALTER TABLE "lot_building_proximity" ADD CONSTRAINT "lot_building_proximity_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lot_building_proximity" ADD CONSTRAINT "lot_building_proximity_building_id_fkey"
    FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lot_building_proximity" ADD CONSTRAINT "lot_building_proximity_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
