-- Drop orphan tables `notification_logs` and `push_tokens`.
--
-- Background: production has a `_prisma_migrations` row for `20260501010714_add_push_notifications`
-- that was applied directly against the prod database but whose migration folder was never committed
-- to git. The two tables it created (`notification_logs`, `push_tokens`) are empty in prod and have no
-- references anywhere in the codebase. Zach's incoming notifications PR will recreate them through the
-- normal Prisma flow with a properly-modeled schema, so we drop them here and remove the orphan
-- `_prisma_migrations` row to bring prod back in sync with `main`.
--
-- All statements are idempotent (`IF EXISTS`) so this migration is safe to apply against any database
-- (prod, branch dbs, fresh local installs created from `schema.prisma` without the orphan migration).

-- DropForeignKey
ALTER TABLE IF EXISTS "notification_logs" DROP CONSTRAINT IF EXISTS "notification_logs_user_id_fkey";
ALTER TABLE IF EXISTS "push_tokens" DROP CONSTRAINT IF EXISTS "push_tokens_user_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "notification_logs";
DROP TABLE IF EXISTS "push_tokens";

-- Remove the orphan migration record so `prisma migrate status` reports a clean state.
-- Guarded against shadow DB / fresh installs where `_prisma_migrations` may not yet exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations') THEN
    DELETE FROM "_prisma_migrations" WHERE migration_name = '20260501010714_add_push_notifications';
  END IF;
END
$$;
