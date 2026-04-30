/*
  Warnings:

  - You are about to drop the `event_impacts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "event_impacts" DROP CONSTRAINT "event_impacts_event_id_fkey";

-- DropForeignKey
ALTER TABLE "event_impacts" DROP CONSTRAINT "event_impacts_lot_id_fkey";

-- DropTable
DROP TABLE "event_impacts";

-- DropEnum
DROP TYPE "ImpactLevel";
