-- Drop the static per-lot penetration_rate floor.
-- The runtime penetration estimator (penetration-estimation.service.ts) now
-- relies solely on the live campus-wide rate + MIN_PENETRATION_RATE constant.
-- Per-lot floors were a fossil from before the campus-wide computation existed.
ALTER TABLE "lots" DROP COLUMN "penetration_rate";

-- Rename "confidence" -> "metadata_confidence" to disambiguate from the
-- ML-derived snapshot-level confidence (OccupancySnapshot.confidence).
-- Lot-level confidence has always been a static metadata-quality grade
-- (how confident we are in the seeded capacity / geofence / amenity counts),
-- not a runtime signal.
ALTER TABLE "lots" RENAME COLUMN "confidence" TO "metadata_confidence";
