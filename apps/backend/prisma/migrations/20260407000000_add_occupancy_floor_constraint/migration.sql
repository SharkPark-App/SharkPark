-- Ensure current_occupancy can never go below 0.
-- The application already guards against this, but the DB constraint
-- provides a safety net for any code path that bypasses the check.

ALTER TABLE "lots"
  ADD CONSTRAINT "chk_occupancy_non_negative"
  CHECK ("current_occupancy" >= 0);
