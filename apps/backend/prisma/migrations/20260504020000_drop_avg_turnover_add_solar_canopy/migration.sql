-- Drop unused metric: avg_turnover_minutes was never read at runtime; static seed value only.
ALTER TABLE "lots" DROP COLUMN "avg_turnover_minutes";

-- Add new amenity flag for solar-panel canopies (CSULB: G6/G7/G8/E8).
-- This is distinct from is_covered (full structures only).
ALTER TABLE "lots" ADD COLUMN "has_solar_canopy" BOOLEAN NOT NULL DEFAULT false;
