-- Add composite index to speed up the campus-wide distinct device count query
-- used by PenetrationEstimationService.countCampusDevices().
-- The query filters by timestamp range and counts DISTINCT device_hash.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_events_time_device"
  ON "occupancy_events" ("timestamp", "device_hash");
