-- AlterTable
ALTER TABLE "academic_calendar" ADD COLUMN     "expected_commuters" INTEGER NOT NULL DEFAULT 35000;

-- AlterTable
ALTER TABLE "occupancy_snapshots" ADD COLUMN     "estimated_occupancy" INTEGER,
ADD COLUMN     "penetration_rate_used" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "campus_activity_baselines" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "period_type" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "hour_of_day" INTEGER NOT NULL,
    "avg_devices" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "peak_devices" INTEGER NOT NULL DEFAULT 0,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campus_activity_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campus_activity_baselines_school_id_period_type_day_of_week_key" ON "campus_activity_baselines"("school_id", "period_type", "day_of_week", "hour_of_day");

-- AddForeignKey
ALTER TABLE "campus_activity_baselines" ADD CONSTRAINT "campus_activity_baselines_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
