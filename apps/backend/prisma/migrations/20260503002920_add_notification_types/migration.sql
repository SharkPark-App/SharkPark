-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('favorites_filling', 'favorites_clearing', 'surge', 'events');

-- AlterTable
ALTER TABLE "notification_logs"
  ADD COLUMN "event_id" TEXT,
  ALTER COLUMN "type" TYPE "NotificationType" USING type::"NotificationType";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_notification_log_dedup" ON "notification_logs"("user_id", "type", "sent_at");

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "campus_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
