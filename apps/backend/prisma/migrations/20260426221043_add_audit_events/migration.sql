-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('USER_DELETED', 'USER_DATA_EXPORTED');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "event_type" "AuditEventType" NOT NULL,
    "actor_hash" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_type_time" ON "audit_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "idx_audit_actor_time" ON "audit_events"("actor_hash", "created_at");
