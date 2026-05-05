-- CreateTable: buildings
CREATE TABLE "buildings" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alternate_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- UniqueIndex: school_id + name
CREATE UNIQUE INDEX "buildings_school_id_name_key" ON "buildings"("school_id", "name");

-- AddForeignKey: buildings.school_id → schools.id
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: lot_buildings (join table)
CREATE TABLE "lot_buildings" (
    "lot_id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    CONSTRAINT "lot_buildings_pkey" PRIMARY KEY ("lot_id", "building_id")
);

-- AddForeignKey: lot_buildings.lot_id → lots.id
ALTER TABLE "lot_buildings" ADD CONSTRAINT "lot_buildings_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: lot_buildings.building_id → buildings.id
ALTER TABLE "lot_buildings" ADD CONSTRAINT "lot_buildings_building_id_fkey"
    FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: campus_events — add building_id (nullable)
ALTER TABLE "campus_events" ADD COLUMN "building_id" TEXT;

-- AddForeignKey: campus_events.building_id → buildings.id
ALTER TABLE "campus_events" ADD CONSTRAINT "campus_events_building_id_fkey"
    FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Replace old school_id+start_time index with building_id+start_time
DROP INDEX IF EXISTS "campus_events_school_id_start_time_idx";
CREATE INDEX "campus_events_building_id_start_time_idx" ON "campus_events"("building_id", "start_time");

-- Drop building_proximity from lots
ALTER TABLE "lots" DROP COLUMN "building_proximity";