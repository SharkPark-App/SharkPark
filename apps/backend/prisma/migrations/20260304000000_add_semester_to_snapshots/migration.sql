-- AlterTable
ALTER TABLE "occupancy_snapshots" ADD COLUMN "semester" TEXT;

-- DropIndex
DROP INDEX "idx_snapshots_training";

-- CreateIndex
CREATE INDEX "idx_snapshots_training" ON "occupancy_snapshots"("lot_id", "timestamp", "semester", "academic_period");
