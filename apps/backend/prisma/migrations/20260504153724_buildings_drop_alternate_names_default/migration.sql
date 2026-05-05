-- AlterTable
ALTER TABLE "buildings" ALTER COLUMN "alternate_names" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "uq_lot_advisory_source_lot" RENAME TO "lot_advisories_school_id_source_source_marker_id_lot_id_key";
