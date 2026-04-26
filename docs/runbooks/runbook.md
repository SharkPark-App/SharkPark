# SharkPark Operations Runbook

Primary on-call reference. Covers the operations you reach for when something
breaks at 2 AM, plus the routine maintenance that keeps it from breaking in
the first place.

**Audience:** anyone with prod access (currently a team of one — but written so
a future engineer can pick this up cold).

## Table of Contents

- [Quick Reference](#quick-reference)
- [Service Topology](#service-topology)
- [RTO / RPO Targets](#rto--rpo-targets)
- [Routine Operations](#routine-operations)
  - [Deploy](#deploy)
  - [Rollback](#rollback)
  - [Scale up / down](#scale-up--down)
  - [View logs](#view-logs)
  - [Run a one-off command in prod](#run-a-one-off-command-in-prod)
- [Credential Rotation](#credential-rotation)
- [Incident Playbooks](#incident-playbooks)
  - [Backend down (5xx storm)](#backend-down-5xx-storm)
  - [Database unreachable](#database-unreachable)
  - [Disk fills / cron OOM](#disk-fills--cron-oom)
  - [Backup pipeline broken](#backup-pipeline-broken)
- [Restore from Backup](#restore-from-backup)
- [Monthly Drills](#monthly-drills)

---

## Quick Reference

| Resource | URL / Command |
|---|---|
| Backend prod | https://api.sharkpark.app |
| Backend health | https://api.sharkpark.app/api/v1/health/ready |
| Fly app | https://fly.io/apps/sharkpark-api |
| Fly metrics | https://fly.io/apps/sharkpark-api/metrics |
| Sentry | https://sharkpark.sentry.io |
| Neon project | https://console.neon.tech (project: `sharkpark`) |
| R2 backups bucket | `sharkpark-backups` (via Cloudflare dashboard) |
| GitHub Actions | https://github.com/SharkPark-App/SharkPark/actions |

```bash
# Most common commands
flyctl status -a sharkpark-api
flyctl logs -a sharkpark-api
flyctl ssh console -a sharkpark-api -C "node -e 'console.log(process.env.SENTRY_RELEASE)'"
```

---

## Service Topology

```
              Cloudflare (proxy + cache, TLS 1.3, HSTS)
                            │
                            ▼
              Fly.io  (sharkpark-api, region=lax)
              ├─ app process     (HTTP, autostop min=0)
              └─ cron process    (supercronic, always-on 1x@512MB)
                            │
                            ▼
              Neon Postgres (us-west-2)
              ├─ pooled endpoint  (ep-...-pooler...)  ← prod runtime
              └─ direct endpoint  (ep-...)             ← migrations only
                            │
                            ▼
              Cloudflare R2
              ├─ sharkpark-backups       (35-day lifecycle, daily dumps)
              └─ sharkpark-ml-exports    (parquet snapshots, future)
```

Process group memory: app=512MB, cron=512MB. The cron group needs 512 because
`snapshot.js` and `fetch-weather.js` bootstrap the full Nest context (Prisma +
all modules ≈ 150–200 MB heap + headroom).

---

## RTO / RPO Targets

These are **commitments** — drills below validate them quarterly.

| Scenario | RTO (recovery time) | RPO (data loss) | Mechanism |
|---|---|---|---|
| Fly app crash / single VM failure | < 1 min | 0 | Fly health checks restart automatically |
| Bad deploy (code regression) | < 5 min | 0 | `flyctl releases` rollback (see below) |
| Bad migration | < 15 min | 0 | Restore Neon to point-in-time before migration ran |
| Region failure (Fly LAX down) | < 60 min | 0 | Manual: `fly regions add` + redeploy |
| DB corruption / accidental drop | < 60 min | ≤ 24 h | Restore from R2 nightly dump → Neon branch |
| R2 backup loss | N/A (defense in depth) | ≤ 24 h | Neon retains 7-day point-in-time history independently |

**RPO=24h** for full restore is acceptable for a parking app: lots and users
are slow-changing; occupancy events are valuable for ML training but not
business-critical. We accept the trade for $0/mo backup cost.

**Free-tier caveats:**
- Cold-start adds ~3s to the first request after `app` autostops (configured
  trade for ~$5/mo savings). Bump `min_machines_running = 1` in
  [fly.toml](../../apps/backend/fly.toml) if users complain.
- Neon free tier suspends the compute after ~5 min idle. The pooled endpoint
  is always reachable; the direct endpoint can return `compute is starting`.
  Migrations always go through the pooled endpoint (see deploy.yml).

---

## Routine Operations

### Deploy

Push to `main` → GitHub Actions runs `.github/workflows/deploy.yml`:

1. Install backend deps + generate Prisma client
2. Run `prisma migrate deploy` against pooled endpoint
3. Tag Sentry release + upload sourcemaps (skipped if `SENTRY_AUTH_TOKEN`
   secret missing)
4. `flyctl deploy --remote-only` (rolling)

Manual trigger: GitHub → Actions → "Deploy to Fly" → Run workflow.

**Watch:** logs in the Actions run. The deploy is gated by Fly health checks
(`/api/v1/health/ready`); a failing release auto-aborts.

### Rollback

```bash
# 1. List recent releases
flyctl releases -a sharkpark-api | head -10

# 2. Find the version you want (column "VERSION", e.g. v42)
# 3. Roll back
flyctl deploy --image registry.fly.io/sharkpark-api:deployment-<id> \
              -a sharkpark-api \
              --config apps/backend/fly.toml
# or, simpler if the previous release is recent:
flyctl machine update <id> --image <previous-image> -a sharkpark-api
```

**If the bad release also ran a bad migration:** the rollback alone is
insufficient — the schema is already changed. Restore the DB to a Neon branch
created from the moment before the migration ran (Neon dashboard → Branches →
Create branch → "From timestamp"), then promote that branch.

### Scale up / down

```bash
# Vertical (memory)
flyctl scale memory 1024 --process app -a sharkpark-api

# Horizontal (machine count) — only relevant if min_machines_running > 0
flyctl scale count 2 --process app -a sharkpark-api

# Region add (multi-region)
flyctl regions add iad -a sharkpark-api
```

Cost guard: every step here moves us off the ~$5/mo line. Don't scale up
permanently without a reason in writing.

### View logs

```bash
flyctl logs -a sharkpark-api                 # tail live
flyctl logs -a sharkpark-api -i <machine-id> # one machine
```

For historical logs (>30 min old), check Sentry (errors only) or set up a
log drain (P14, not yet configured).

### Run a one-off command in prod

```bash
flyctl ssh console -a sharkpark-api
# Inside the container:
cd /app/apps/backend
node dist/scripts/<your-script>.js
```

For Prisma queries:

```bash
flyctl ssh console -a sharkpark-api -C \
  "cd /app/apps/backend && node -e \"
    const {PrismaClient} = require('@prisma/client');
    const p = new PrismaClient();
    p.lot.count().then(c => { console.log(c); return p.\$disconnect(); });
  \""
```

---

## Credential Rotation

All rotation work is logged here so the next person knows when each secret
last moved. **Update the table after every rotation.**

| Secret | Cadence | Last rotated | Next due | How |
|---|---|---|---|---|
| `FLY_API_TOKEN` (GitHub) | Every 90 days, or on team member offboarding | _never since signup_ | TBD | `fly tokens create deploy -x 8760h -a sharkpark-api` → update GitHub repo secret |
| `NEON_DATABASE_URL` (Fly + GitHub) | Every 180 days | _never since signup_ | TBD | Neon dashboard → Roles → reset password → update Fly secret + GitHub secret |
| `R2 backup token` | Every 180 days, or on suspected leak | _never since signup_ | TBD | Cloudflare → R2 → Manage tokens → rotate `fly-backups` |
| `SENTRY_AUTH_TOKEN` (GitHub) | Every 365 days | _not yet configured_ | TBD | https://sentry.io/settings/account/api/auth-tokens/ |
| `OPENWEATHER_API_KEY` | On suspected leak only (free tier, low blast radius) | _never_ | N/A | OpenWeather dashboard |

**Rotation procedure (generic):**

1. Generate the new credential at the source (Fly / Neon / R2 / Sentry)
2. Update the consuming side:
   - Fly secrets: `flyctl secrets set KEY=value -a sharkpark-api` (causes
     rolling restart; safe — health checks gate it)
   - GitHub secrets: repo → Settings → Secrets and variables → Actions
   - For paired secrets (e.g. `NEON_DATABASE_URL` is in both Fly and GitHub),
     update **both** in the same maintenance window
3. Verify: trigger a deploy or hit a health endpoint
4. Revoke the old credential at the source
5. Update this table

**Why rotate at all on a one-person project:** because the bus factor is 1
and the team will eventually grow. Rotate now → people leave later → no
panic.

---

## Incident Playbooks

### Backend down (5xx storm)

**Symptoms:** `https://api.sharkpark.app/api/v1/health/ready` returns 5xx;
Sentry error volume spikes; mobile users see "couldn't reach server".

```bash
# 1. Triage
flyctl status -a sharkpark-api               # are machines running?
flyctl logs -a sharkpark-api | tail -100     # last 100 log lines

# 2. Common causes & fixes:
#    - All machines OOM'd:    flyctl scale memory 1024 -p app -a sharkpark-api
#    - Bad release:           rollback (see above)
#    - DB unreachable:        see "Database unreachable" below
#    - Cloudflare WAF blocking: check CF dashboard → Security Events
```

If you can't immediately diagnose: **roll back first, debug second.** A 5-min
rollback is always cheaper than a 30-min debug while users are seeing errors.

### Database unreachable

**Symptoms:** `/health/ready` returns 503 with body mentioning Prisma /
Postgres timeout.

```bash
# 1. Is Neon up?
curl -sS https://console.neon.tech/api/v2/projects/<project-id>/operations \
     -H "Authorization: Bearer $NEON_API_KEY" | jq '.operations[0]'

# 2. Is the pooler endpoint reachable from your machine?
psql "$NEON_DATABASE_URL" -c 'SELECT 1'

# 3. Most common: free-tier compute suspended + cold starting
#    → wait 30s and retry. /health/ready will recover automatically once
#      the next request wakes it.
```

If Neon is genuinely down (rare), there's nothing to do except wait or
restore to a fresh project. RPO ≤ 24h applies.

### Disk fills / cron OOM

**Symptoms:** cron process keeps restarting; `snapshot.js` or
`fetch-weather.js` exits 137 (SIGKILL).

```bash
flyctl status -a sharkpark-api | grep cron
flyctl logs -a sharkpark-api -i <cron-machine-id>
```

Each script bootstraps the full Nest context (~150–200 MB). If memory is
already 512 MB, check whether a new module pulled into bootstrap is the
culprit (Sentry breadcrumbs / heap snapshot via `flyctl ssh console`).

Bandaid: bump cron memory to 1024 MB. Real fix: lazy-load modules so
scripts only instantiate what they need.

### Backup pipeline broken

**Symptoms:** weekly `verify-latest-backup.js` cron throws → Sentry alert;
backup count in R2 stops growing.

```bash
# 1. Check the latest backup exists and parses
aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    s3 ls s3://sharkpark-backups/daily/ | tail -3

# 2. Check the cron actually ran
flyctl logs -a sharkpark-api -i <cron-machine-id> | grep backup-db

# 3. If pg_dump itself is failing, run manually:
flyctl ssh console -a sharkpark-api -C \
  "cd /app/apps/backend && node dist/scripts/backup-db.js"
```

Do **not** wait until you need a restore to discover the backup pipeline
broke last week. The verify cron exists for a reason — investigate the
first failure, every time.

---

## Restore from Backup

See [restore.md](./restore.md) for the full step-by-step.

**TL;DR:** download the dump from R2, create a fresh Neon branch, restore
into it with `pg_restore --no-owner --no-privileges --clean --if-exists`,
verify row counts, then promote the branch.

**Never restore directly over production.** Always use a Neon branch first.

---

## Monthly Drills

The first Monday of each month (calendar reminder), the on-call engineer:

1. **Restore drill** (5 min): the
   [restore-test workflow](../../.github/workflows/restore-test.yml) runs
   automatically every Sunday and proves the backup → restore loop works
   end-to-end. **Check that the latest run succeeded.** If it didn't,
   investigate before doing anything else — a broken backup pipeline that
   no one notices is the worst possible failure mode.

   Once a quarter, also do a **manual** restore following
   [restore.md](./restore.md) end-to-end. This keeps procedural muscle
   memory fresh — when you actually need to restore at 2 AM, you don't
   want it to be the first time you've typed `pg_restore`.

2. **Rollback drill** (5 min): trigger a no-op redeploy of the
   second-to-last release via `flyctl deploy --image <previous-image>`,
   confirm health checks pass, redeploy current. **Validates RTO** for
   the "bad deploy" scenario.

3. **Sentry release sanity** (2 min): open Sentry → Releases → confirm the
   latest release ID matches the latest deployed git SHA on Fly. If not,
   `SENTRY_AUTH_TOKEN` may have expired or the upload step is failing.

4. **Rotation review** (5 min): scan the rotation table above. Anything
   "Next due" within the next 30 days → schedule it.

Log the drill outcome in this file (PR with a one-line update under each
section) so we have a paper trail.
