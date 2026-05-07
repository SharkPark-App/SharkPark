-- CreateEnum
CREATE TYPE "MlCronRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ml_cron_runs" (
    "id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" "MlCronRunStatus" NOT NULL DEFAULT 'RUNNING',
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ml_cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ml_cron_runs_job_started" ON "ml_cron_runs"("job_name", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_ml_cron_runs_status_started" ON "ml_cron_runs"("status", "started_at" DESC);
