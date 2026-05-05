-- CreateEnum
CREATE TYPE "SportsEventStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINAL', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SportsResultStatus" AS ENUM ('W', 'L', 'T');

-- AlterTable
ALTER TABLE "campus_events" ADD COLUMN     "away_score" INTEGER,
ADD COLUMN     "home_score" INTEGER,
ADD COLUMN     "result_status" "SportsResultStatus",
ADD COLUMN     "status" "SportsEventStatus",
ADD COLUMN     "status_updated_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "campus_events_status_start_time_idx" ON "campus_events"("status", "start_time");
