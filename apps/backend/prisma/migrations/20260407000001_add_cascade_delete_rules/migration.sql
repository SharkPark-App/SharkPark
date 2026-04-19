-- Add ON DELETE CASCADE to all parent-child foreign keys that were missing it.
-- This ensures deleting a School or Lot automatically removes dependent rows.

-- Lot → School
ALTER TABLE "lots" DROP CONSTRAINT "lots_school_id_fkey";
ALTER TABLE "lots" ADD CONSTRAINT "lots_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- User → School
ALTER TABLE "users" DROP CONSTRAINT "users_school_id_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OccupancyEvent → Lot
ALTER TABLE "occupancy_events" DROP CONSTRAINT "occupancy_events_lot_id_fkey";
ALTER TABLE "occupancy_events" ADD CONSTRAINT "occupancy_events_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OccupancySnapshot → Lot
ALTER TABLE "occupancy_snapshots" DROP CONSTRAINT "occupancy_snapshots_lot_id_fkey";
ALTER TABLE "occupancy_snapshots" ADD CONSTRAINT "occupancy_snapshots_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeviceState → Lot
ALTER TABLE "device_states" DROP CONSTRAINT "device_states_lot_id_fkey";
ALTER TABLE "device_states" ADD CONSTRAINT "device_states_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CampusEvent → School
ALTER TABLE "campus_events" DROP CONSTRAINT "campus_events_school_id_fkey";
ALTER TABLE "campus_events" ADD CONSTRAINT "campus_events_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EventImpact → Lot
ALTER TABLE "event_impacts" DROP CONSTRAINT "event_impacts_lot_id_fkey";
ALTER TABLE "event_impacts" ADD CONSTRAINT "event_impacts_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Weather → School
ALTER TABLE "weather" DROP CONSTRAINT "weather_school_id_fkey";
ALTER TABLE "weather" ADD CONSTRAINT "weather_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PredictionShortTerm → Lot
ALTER TABLE "predictions_short_term" DROP CONSTRAINT "predictions_short_term_lot_id_fkey";
ALTER TABLE "predictions_short_term" ADD CONSTRAINT "predictions_short_term_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PredictionLongTerm → Lot
ALTER TABLE "predictions_long_term" DROP CONSTRAINT "predictions_long_term_lot_id_fkey";
ALTER TABLE "predictions_long_term" ADD CONSTRAINT "predictions_long_term_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
