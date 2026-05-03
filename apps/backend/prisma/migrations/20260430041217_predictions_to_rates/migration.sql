-- Switch prediction columns from absolute occupancy counts to rates [0, 1].
-- TRUNCATE first: legacy rows are counts, not rates. Cycle will repopulate.
--
-- DEPLOY ORDERING: this migration MUST ship together with (or after) the ML
-- image that writes rates via .astype(float). The previous ML writer used
-- .astype(int) and produced count-magnitudes (e.g. 90), which the new
-- CHECK (... BETWEEN 0 AND 1) constraint will reject. Backend release
-- pipeline applies migrations on boot, and the cron container runs the same
-- image, so a single coordinated deploy of this branch satisfies the
-- ordering requirement.

TRUNCATE TABLE "predictions_short_term";
TRUNCATE TABLE "predictions_long_term";

ALTER TABLE "predictions_short_term"
    ALTER COLUMN "predicted_occupancy" SET DATA TYPE DOUBLE PRECISION,
    ALTER COLUMN "confidence_lower"    SET DATA TYPE DOUBLE PRECISION,
    ALTER COLUMN "confidence_upper"    SET DATA TYPE DOUBLE PRECISION,
    ADD CONSTRAINT "predicted_occupancy_rate_range" CHECK ("predicted_occupancy" BETWEEN 0 AND 1),
    ADD CONSTRAINT "confidence_lower_rate_range"    CHECK ("confidence_lower"    BETWEEN 0 AND 1),
    ADD CONSTRAINT "confidence_upper_rate_range"    CHECK ("confidence_upper"    BETWEEN 0 AND 1);

ALTER TABLE "predictions_long_term"
    ALTER COLUMN "predicted_occupancy" SET DATA TYPE DOUBLE PRECISION,
    ALTER COLUMN "confidence_lower"    SET DATA TYPE DOUBLE PRECISION,
    ALTER COLUMN "confidence_upper"    SET DATA TYPE DOUBLE PRECISION,
    ADD CONSTRAINT "predicted_occupancy_rate_range" CHECK ("predicted_occupancy" BETWEEN 0 AND 1),
    ADD CONSTRAINT "confidence_lower_rate_range"    CHECK ("confidence_lower"    BETWEEN 0 AND 1),
    ADD CONSTRAINT "confidence_upper_rate_range"    CHECK ("confidence_upper"    BETWEEN 0 AND 1);
