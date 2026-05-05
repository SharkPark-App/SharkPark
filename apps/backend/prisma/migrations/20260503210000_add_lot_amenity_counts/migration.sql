-- Add lot amenity count fields (Phase G follow-up).
-- These are informational counts that do not affect capacity or occupancy
-- predictions; they're surfaced in the LotAmenities UI to help drivers
-- pick the right lot for their needs.

ALTER TABLE "lots"
  ADD COLUMN "short_term_parking_spaces" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "low_emission_spaces"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pay_stations"              INTEGER NOT NULL DEFAULT 0;
