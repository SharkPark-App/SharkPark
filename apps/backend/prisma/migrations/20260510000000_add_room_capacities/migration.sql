-- D2-redesign: replace CSV-based reference data with proper DB tables.
--
--   * `room_capacities` — per-(building_code, room) seat counts, refreshed
--     weekly Sat 02:00 PT by services/ml/scripts/ingest_room_capacities.py
--     from the public CSULB Faculty/Staff Resources pages (lecture
--     allocations, auditoriums, active-learning rooms, conflict-off rooms).
--     Source-of-truth for tier-2 of the catalog ingest enrollment fallback.
--
--   * `section_enrollment_overrides` — operator-curated per-section
--     enrollment numbers (e.g. from a SSO PeopleSoft export). Highest-
--     priority tier of the catalog ingest fallback. Replaces the previous
--     gitignored CSV; storing in DB lets operators edit via SQL/admin.
--
--   * `Building.classroom_profile` — building-level fallback bucket used
--     when no specific room capacity is known. Independent of `category`
--     (which drives UI grouping). Auto-derived from `room_capacities`
--     median in the ingest job; nullable until we have ≥3 known rooms.

CREATE TABLE "room_capacities" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "building_code" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_capacities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "room_capacities_school_id_building_code_room_key"
    ON "room_capacities" ("school_id", "building_code", "room");

CREATE INDEX "room_capacities_school_id_building_code_idx"
    ON "room_capacities" ("school_id", "building_code");

ALTER TABLE "room_capacities"
    ADD CONSTRAINT "room_capacities_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "section_enrollment_overrides" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "class_number" TEXT NOT NULL,
    "enrollment" INTEGER NOT NULL,
    "note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_enrollment_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "section_enrollment_overrides_school_id_class_number_key"
    ON "section_enrollment_overrides" ("school_id", "class_number");

ALTER TABLE "section_enrollment_overrides"
    ADD CONSTRAINT "section_enrollment_overrides_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ClassroomProfile values:
--   STANDARD     — 15-79 seat general-ed classrooms (most academic bldgs)
--   LECTURE_HALL — 80-322 seat lecture halls (PH1, MIC, LH-1, ...)
--   ACTIVE       — 24/38/55 seat collaborative rooms
--   SEMINAR      — ~15-25 seat upper-division
--   LAB          — 20-30 seat lab benches
--   MIXED        — multiple profiles in same building
CREATE TYPE "ClassroomProfile" AS ENUM (
    'STANDARD',
    'LECTURE_HALL',
    'ACTIVE',
    'SEMINAR',
    'LAB',
    'MIXED'
);

ALTER TABLE "buildings"
    ADD COLUMN "classroom_profile" "ClassroomProfile";
