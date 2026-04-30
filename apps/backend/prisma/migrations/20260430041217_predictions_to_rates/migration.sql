-- Switch prediction columns from absolute occupancy counts to rates [0, 1].
-- TRUNCATE first: legacy rows are counts, not rates. Cycle will repopulate.

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
