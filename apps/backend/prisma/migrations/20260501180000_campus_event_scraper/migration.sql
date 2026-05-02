-- campus_event_scraper migration
--
-- Simplifies `campus_events` for the CampusLabs scraper:
--   • Adds `external_id` (CampusLabs event GUID) with a unique constraint for idempotent upserts
--   • Drops `event_type` (classification no longer needed; events are display-only)
--   • Drops `expected_attendance` (not returned by the CampusLabs API)
--   • Replaces the school-only index with a compound [school_id, start_time] index to match
--     the `getEventsForLot` query pattern (filters by school + date range)
--   • Drops the now-unused `CampusEventType` enum

-- Add external_id
ALTER TABLE "campus_events" ADD COLUMN "external_id" TEXT NOT NULL DEFAULT '';
-- Backfill existing rows with a placeholder (table is empty in all real environments after reset)
UPDATE "campus_events" SET "external_id" = id WHERE "external_id" = '';
-- Remove the temporary default so new rows must supply a real external_id
ALTER TABLE "campus_events" ALTER COLUMN "external_id" DROP DEFAULT;

-- Unique constraint on external_id
CREATE UNIQUE INDEX "campus_events_external_id_key" ON "campus_events"("external_id");

-- Remove obsolete columns
ALTER TABLE "campus_events" DROP COLUMN IF EXISTS "event_type";
ALTER TABLE "campus_events" DROP COLUMN IF EXISTS "expected_attendance";

-- Replace index
DROP INDEX IF EXISTS "campus_events_school_id_idx";
CREATE INDEX "campus_events_school_id_start_time_idx" ON "campus_events"("school_id", "start_time");

-- Drop obsolete enum
DROP TYPE IF EXISTS "CampusEventType";
