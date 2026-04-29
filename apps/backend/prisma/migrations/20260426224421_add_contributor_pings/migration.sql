-- CreateTable
CREATE TABLE "contributor_pings" (
    "device_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributor_pings_pkey" PRIMARY KEY ("device_hash")
);

-- CreateIndex
CREATE INDEX "idx_contributor_last_seen" ON "contributor_pings"("last_seen_at");
