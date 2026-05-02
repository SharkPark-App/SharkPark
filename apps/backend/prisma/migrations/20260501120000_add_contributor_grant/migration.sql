-- Permission-grant grace pass for ContributorGuard.
-- Allows a device that has granted location permissions but not yet produced
-- a real occupancy event to read live-occupancy / forecast endpoints for a
-- bounded grace window (default 24h, tuned via CONTRIBUTOR_GRANT_TTL_MS).
ALTER TABLE "contributor_pings" ADD COLUMN "granted_at" TIMESTAMP(3);

CREATE INDEX "idx_contributor_granted_at" ON "contributor_pings"("granted_at");
