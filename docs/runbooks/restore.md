# Postgres Restore Runbook

Restore a SharkPark Postgres backup from Cloudflare R2 to a fresh Neon branch.

**Audience:** on-call engineer responding to data loss / corruption.
**Prereqs:** local `psql` ≥ 17, `pg_restore` ≥ 17, `aws` CLI, `flyctl`, Neon
account access.

## TL;DR

```bash
# 1. Pick a backup
aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    s3 ls s3://sharkpark-backups/daily/ | tail -10

# 2. Download
aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    s3 cp s3://sharkpark-backups/daily/YYYY-MM-DD.dump.gz ./restore.dump.gz
gunzip restore.dump.gz   # → restore.dump

# 3. Create a Neon branch from current prod, then point a target URL at it.
#    (Neon dashboard → Branches → Create branch → name: `restore-YYYY-MM-DD`)
TARGET_URL='postgres://...neon...restore-2026-04-25...?sslmode=verify-full'

# 4. Wipe target schema & restore (no-owner because the dump was taken with --no-owner)
psql "$TARGET_URL" -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
pg_restore --no-owner --no-privileges --clean --if-exists \
           --dbname "$TARGET_URL" --jobs 4 ./restore.dump

# 5. Sanity check
psql "$TARGET_URL" -c "SELECT count(*) FROM \"Lot\";"
psql "$TARGET_URL" -c "SELECT count(*) FROM \"OccupancySnapshot\";"
psql "$TARGET_URL" -c "SELECT max(\"createdAt\") FROM \"OccupancyEvent\";"
```

## Detailed steps

### 1. Get R2 credentials

The backup token is named **`fly-backups`** in Cloudflare → R2 → API Tokens.
Either look up its values from your password manager, or — for one-shot
restores — generate a fresh **Read-only** token scoped to `sharkpark-backups`
and revoke it after.

Export for the AWS CLI session:

```bash
export R2_ACCOUNT_ID=...                # 32-char hex
export AWS_ACCESS_KEY_ID=...            # BACKUP_R2_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=...        # BACKUP_R2_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=auto
```

### 2. Choose a backup

```bash
aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    s3 ls s3://sharkpark-backups/daily/
```

Backups are named `daily/YYYY-MM-DD.dump.gz` (UTC date the cron ran). Pick the
newest *known good* one — for corruption incidents that's typically the last
backup taken before the bad write.

### 3. Download and decompress

```bash
aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    s3 cp s3://sharkpark-backups/daily/YYYY-MM-DD.dump.gz ./restore.dump.gz
gunzip restore.dump.gz   # produces restore.dump
```

Quick header check before you commit to a restore:

```bash
pg_restore --list ./restore.dump | head -40
```

Should show a `pg_dump` header line and a list of TOC entries (CREATE TABLE,
COPY, etc). Garbled output → file is corrupt; pick another date.

### 4. Provision a target Neon branch

**Never restore directly over production.** Always restore to a branch first,
verify, then promote.

1. Neon dashboard → **Branches** → **Create branch**
   - Source: `main` (or whatever the current prod branch is)
   - Name: `restore-YYYY-MM-DD`
2. Click the new branch → **Connection details** → copy the **direct** (not
   pooled) connection string. Append `?sslmode=verify-full` if absent.
3. Export it:
   ```bash
   export TARGET_URL='postgres://user:pw@ep-...neon.tech/sharkpark?sslmode=verify-full'
   ```

### 5. Restore

The dump was taken with `--no-owner --no-privileges`, so we restore the same
way (no role conflicts on Neon).

```bash
# Drop + recreate the public schema so --clean has nothing leftover.
psql "$TARGET_URL" -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

pg_restore \
  --no-owner --no-privileges \
  --clean --if-exists \
  --jobs 4 \
  --dbname "$TARGET_URL" \
  ./restore.dump
```

`--jobs 4` parallelizes table loads; safe on Neon's serverless compute
(autoscales). For a tiny DB you can drop it and use `-1` (single transaction)
for atomicity.

Expected duration: < 5 min for current data volume (Apr 2026). If it's taking
significantly longer, check Neon compute size and bump it temporarily.

### 6. Verify

```bash
psql "$TARGET_URL" <<'SQL'
SELECT 'Lot' AS t, count(*) FROM "Lot"
UNION ALL SELECT 'User', count(*) FROM "User"
UNION ALL SELECT 'OccupancyEvent', count(*) FROM "OccupancyEvent"
UNION ALL SELECT 'OccupancySnapshot', count(*) FROM "OccupancySnapshot"
UNION ALL SELECT 'CampusEvent', count(*) FROM "CampusEvent";

SELECT 'newest_event' AS k, max("createdAt") FROM "OccupancyEvent"
UNION ALL SELECT 'newest_snapshot', max("timestamp") FROM "OccupancySnapshot";
SQL
```

Compare row counts and "newest" timestamps to what you expect for that date.

### 7. Cut over (only if you're sure)

Two paths, depending on the incident:

**Path A — point the app at the restored branch** (fastest; preserves history)

1. In Neon dashboard, **promote** `restore-YYYY-MM-DD` to be the primary
   branch (Branches → ⋯ → Set as default).
2. Update Fly secrets to the new branch's connection strings:
   ```bash
   fly secrets set \
     DATABASE_URL='...pooler...new-branch...' \
     DATABASE_URL_RO='...replica...' \
     DIRECT_URL='...direct...' \
     -a sharkpark-api
   ```
3. `fly apps restart sharkpark-api`
4. Smoke test: `curl https://api.sharkpark.app/api/v1/health/ready`

**Path B — copy data back into the original branch** (preserves branch id)

Only do this if external systems (BI, Sentry queries, dashboards) hardcode the
original branch id. Run `pg_dump` on the restored branch, then restore into
the original branch's database with the same `--clean --if-exists` flow.

### 8. Cleanup

```bash
# Local files
rm restore.dump restore.dump.gz

# Neon branch (after a few days of confidence)
# Dashboard → Branches → restore-YYYY-MM-DD → ⋯ → Delete

# Revoke the one-shot R2 read token if you created one for this restore.
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `pg_restore: error: did not find magic string in file header` | File truncated / not a custom-format dump | Re-download; check R2 object size matches `aws s3 ls` |
| `permission denied for schema public` | Neon role mismatch | Confirm `--no-owner --no-privileges` flags present |
| `relation "_prisma_migrations" already exists` | Forgot the DROP SCHEMA step | Re-run step 5 from the top |
| Restore stalls | Neon compute too small | Bump compute size in Neon dashboard, retry |
| `connection reset by peer` mid-restore | Neon idle disconnect | Use `--jobs 1` for long restores; or use the pooled URL with `pgbouncer=true&connection_limit=1` |

## Related

- Backup cron: [apps/backend/src/scheduler/jobs/backup-db.job.ts](../../apps/backend/src/scheduler/jobs/backup-db.job.ts)
- Verification cron: [apps/backend/src/scheduler/jobs/verify-latest-backup.job.ts](../../apps/backend/src/scheduler/jobs/verify-latest-backup.job.ts)
- Schedule registry: [apps/backend/src/scheduler/cron-monitors.ts](../../apps/backend/src/scheduler/cron-monitors.ts)
- Lifecycle policy: 35-day delete on `daily/` prefix (configured in Cloudflare R2 dashboard)
