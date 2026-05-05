-- Phase D: lot advisories (construction / closures sourced from concept3d).

CREATE TYPE "AdvisorySeverity" AS ENUM ('INFO', 'ADVISORY', 'CLOSURE');
CREATE TYPE "AdvisorySource" AS ENUM ('CONCEPT3D');

CREATE TABLE "lot_advisories" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "AdvisorySeverity" NOT NULL,
    "source" "AdvisorySource" NOT NULL,
    "source_cat_id" INTEGER NOT NULL,
    "source_marker_id" INTEGER NOT NULL,
    "match_reason" TEXT NOT NULL,
    "polygon" JSONB NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lot_advisories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_lot_advisory_source_lot"
  ON "lot_advisories"("school_id", "source", "source_marker_id", "lot_id");

CREATE INDEX "idx_lot_advisory_lot_active"
  ON "lot_advisories"("lot_id", "is_active");

ALTER TABLE "lot_advisories"
  ADD CONSTRAINT "lot_advisories_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lot_advisories"
  ADD CONSTRAINT "lot_advisories_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
