-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('BLOCKAGE', 'CRASH', 'OTHER');

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_reports_lot_time" ON "reports"("lot_id", "created_at");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
