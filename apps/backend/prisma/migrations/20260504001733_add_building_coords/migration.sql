-- AddColumns: buildings.center_lat, buildings.center_lng
-- Sourced from CSULB's concept3d campus map for on-campus buildings + hardcoded coords for
-- off-campus athletic venues (Bohl Diamond at Blair Field, Barnes Tennis Center).
--
-- Existing rows are temporarily defaulted to 0/0; seed-prod immediately overwrites every row
-- with real coordinates on the next deploy. The default is dropped after the column is added
-- so future inserts must supply real coordinates.
ALTER TABLE "buildings" ADD COLUMN "center_lat" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "buildings" ADD COLUMN "center_lng" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "buildings" ALTER COLUMN "center_lat" DROP DEFAULT;
ALTER TABLE "buildings" ALTER COLUMN "center_lng" DROP DEFAULT;
