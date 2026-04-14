-- Phase 1: Data Integrity & Schema Improvements

-- 1. Connect weather context to occupancy snapshots
ALTER TABLE "occupancy_snapshots" ADD COLUMN "weather_id" TEXT;
ALTER TABLE "occupancy_snapshots"
  ADD CONSTRAINT "occupancy_snapshots_weather_id_fkey"
  FOREIGN KEY ("weather_id") REFERENCES "weather"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Change daily_rate from DOUBLE PRECISION to DECIMAL(10,2) for monetary precision
ALTER TABLE "lots" ALTER COLUMN "daily_rate" SET DATA TYPE DECIMAL(10,2);

-- 3. Add missing school_id indexes for efficient school-scoped queries
CREATE INDEX "users_school_id_idx" ON "users"("school_id");
CREATE INDEX "campus_events_school_id_idx" ON "campus_events"("school_id");
