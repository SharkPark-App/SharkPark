/*
  Warnings:

  - You are about to drop the `parking_sessions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `validation_events` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "parking_sessions" DROP CONSTRAINT "parking_sessions_lot_id_fkey";

-- DropForeignKey
ALTER TABLE "validation_events" DROP CONSTRAINT "validation_events_lot_id_fkey";

-- AlterTable
ALTER TABLE "occupancy_events" ADD COLUMN     "analysis_metadata" JSONB,
ADD COLUMN     "confidence_score" DOUBLE PRECISION,
ADD COLUMN     "validation_status" "ValidationStatus";

-- DropTable
DROP TABLE "parking_sessions";

-- DropTable
DROP TABLE "validation_events";

-- DropEnum
DROP TYPE "BluetoothState";

-- DropEnum
DROP TYPE "ValidationEventType";

-- CreateIndex
CREATE INDEX "idx_events_validation" ON "occupancy_events"("validation_status");
