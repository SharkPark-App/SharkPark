# SharkPark Infrastructure

Production architecture: **Fly.io** (compute) + **Neon** (Postgres) + **Cloudflare R2**
(object storage) + **Cloudflare Workers Static Assets** (marketing site) +
**Sentry** (errors + cron monitoring) + **Better Stack** (uptime + status page) +
**Azure AD** (SSO).

> **Historical note.** An earlier plan (Feb 2026) targeted AWS Aurora Serverless v2
> + Lambda + API Gateway with a tiered cost model. We never deployed that stack.
> The full ADR explaining why we picked PostgreSQL over DynamoDB is preserved at
> [`archive/2026-02-aurora-tiered-plan.md`](archive/2026-02-aurora-tiered-plan.md);
> everything in that file from "Deployment Tiers" onward describes infrastructure
> we **do not run**.

---

## Architecture

```
                           ┌──────────────────────────────────┐
                           │   Cloudflare (proxy + DNS)       │
                           │  - sharkpark.app  → Workers      │
                           │  - api.sharkpark.app → Fly app   │
                           │  - status.sharkpark.app → BS     │
                           └──────┬───────────────┬───────────┘
                                  │               │
                                  ▼               ▼
                ┌────────────────────────┐   ┌──────────────────────────┐
                │  Cloudflare Workers    │   │  Fly.io (sharkpark-api)  │
                │   Static Assets        │   │  primary_region = lax    │
                │  apps/marketing/       │   │                          │
                │  (Astro 5)             │   │  ┌──────────────────────┐│
                └────────────────────────┘   │  │ process: app         ││
                                             │  │ src/main.ts          ││
        ┌────────────────────┐               │  │ shared-cpu-1x 512MB  ││
        │  Mobile App        │ ────HTTPS───► │  │ min_machines = 1     ││
        │  (iOS / Android)   │               │  │ socket.io /shuttles  ││
        └─────────┬──────────┘               │  └──────────────────────┘│
                  │                          │  ┌──────────────────────┐│
                  │  Azure AD JWT            │  │ process: cron        ││
                  │  (CSULB SSO)             │  │ src/scheduler-main.ts││
                  ▼                          │  │ shared-cpu-1x 512MB  ││
        ┌────────────────────┐               │  │ 29 @nestjs/schedule  ││
        │  Microsoft Entra   │               │  │ jobs (always-on)     ││
        │  (free, CSULB)     │               │  └──────────────────────┘│
        └────────────────────┘               └──────┬───────────────────┘
                                                    │
                          ┌─────────────────────────┼─────────────────────────┐
                          │                         │                         │
                          ▼                         ▼                         ▼
                ┌──────────────────┐     ┌────────────────────┐    ┌─────────────────┐
                │  Neon Postgres   │     │  Cloudflare R2     │    │  Sentry         │
                │  (us-west-2)     │     │  (S3-compatible)   │    │  - errors       │
                │  - pooled        │     │  - DB backups      │    │  - performance  │
                │    (-pooler.)    │     │  - ML model        │    │  - Cron monitors│
                │  - Postgres 17   │     │    artifacts       │    │  - release health│
                │  - branching for │     │  - ML data exports │    └─────────────────┘
                │    PR previews   │     └────────────────────┘
                │  - PITR (7d)     │
                └──────────────────┘     ┌────────────────────┐    ┌─────────────────┐
                                         │  Better Stack      │    │  Firebase Cloud │
                                         │  - /health/ready   │    │  Messaging      │
                                         │    uptime probe    │    │  (push to APNs  │
                                         │  - status page     │    │   + FCM)        │
                                         └────────────────────┘    └─────────────────┘
```

---

## Compute — Fly.io

One Docker image, two process groups, both pinned to `lax` (Los Angeles, ~co-located
with our CSULB userbase and within a few ms of Neon's `us-west-2`):

| Process | Entry | VM | Scaling | Purpose |
|---------|-------|----|---------|---------|
| `app` | [`src/main.ts`](../apps/backend/src/main.ts) | `shared-cpu-1x` 512 MB | `min_machines_running = 1`, autostop on the second machine | NestJS HTTP API at `/api/v1/*`, socket.io at `/shuttles`. |
| `cron` | [`src/scheduler-main.ts`](../apps/backend/src/scheduler-main.ts) | `shared-cpu-1x` 512 MB | always-on (1 machine) | Single Nest standalone application context whose `ScheduleModule` registers all 29 `@Cron(...)` job classes as in-process timers. |

Why one always-warm app machine: cold starts measured at ~10s TTFB (Fly boot +
Node + Nest module graph + Prisma → Neon cold connect); a 10s loading state is
unacceptable for the mobile UX and was generating false-positive 502 alerts when
the Better Stack uptime probe was the request that happened to wake the machine.
With `min_machines_running = 1`, the second machine still autostops, so we don't
pay double during off-peak hours.

Why the cron process is a single long-running Nest context (not supercronic +
per-script bootstrap): the previous pattern launched 5 short-lived Node children
at the top of every 15-minute slot, each booting a fresh `~180 MB` Nest application
graph. On a 1 GB cron VM that OOM-cascaded (`exit 137`) any time more than a few
ticks overlapped. The current scheduler holds **one** application context
(~250 MB RSS) and reuses it for every tick, so concurrent jobs cost effectively
nothing and the VM fits in 512 MB. See
[`docs/runbooks/runbook.md`](../docs/runbooks/runbook.md) for the OOM playbook
and [`apps/backend/fly.toml`](../apps/backend/fly.toml) for the full machine
spec.

The runtime image also bundles **Python 3.11** + a `uv`-managed venv at
`/opt/venv` so the ML jobs (`predict-short-term`, `predict-long-term`,
`recompute-penetration-rates`, `ingest-csulb-catalog`,
`ingest-room-capacities`, `build-proximity-matrix`) can shell out to
`services/ml/` scripts directly from the cron process — no separate ML
runtime to operate. Retraining itself runs in GitHub Actions
(`.github/workflows/ml-retrain.yml`), not in the backend cron.

---

## Database — Neon Postgres

- **Engine:** Postgres 17.
- **Region:** `aws-us-west-2`, same coast as the Fly `lax` region.
- **Connection:** the application uses Neon's **pooled** endpoint
  (`-pooler.` host) with `pgbouncer=true&connection_limit=1`. PgBouncer fronts
  the compute so we don't exhaust direct connections during deploys or burst
  traffic. Prisma is wired through `@prisma/adapter-pg` so the `pg` pool
  parameters apply.
- **Migrations:** run from CI via `pnpm db:deploy` against `NEON_DATABASE_URL`
  (the unpooled endpoint), gated by the deploy workflow's concurrency group.
  Fly's `release_command` is **not** used for migrations because the Fly
  release machine intermittently fails to reach Neon's direct endpoint when the
  compute is suspended. See
  [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).
- **Seeding:** the same workflow runs `pnpm db:seed:prod` after migrations.
  The script is upsert-only and never deletes user data — safe to run every
  deploy.
- **Branching:** [`.github/workflows/neon_workflow.yml`](../.github/workflows/neon_workflow.yml)
  creates an ephemeral Neon branch per pull request and runs the E2E suite
  against it; the branch is deleted when the PR closes.
- **Backups:** Neon's built-in PITR covers the last 7 days. The
  `apps/backend/src/scheduler/jobs/backup-db.job.ts` cron also takes a
  full `pg_dump` nightly and uploads it to R2 (see below) for cross-vendor
  durability and to allow restore drills against historical snapshots beyond
  the PITR window.

---

## Object storage — Cloudflare R2

R2 is S3-compatible (we use the AWS SDK + a custom `S3_ENDPOINT`), egress is
free, and one R2 bucket replaces what would have been an S3 + Glacier setup on
AWS. Two top-level prefixes:

| Prefix | Producer | Consumer |
|--------|----------|----------|
| `backups/postgres/YYYY-MM-DD/` | `backup-db.job.ts` (nightly) | `verify-latest-backup.job.ts` (nightly checksum), [`docs/runbooks/restore.md`](../docs/runbooks/restore.md), [`.github/workflows/restore-test.yml`](../.github/workflows/restore-test.yml) (nightly) |
| `ml/models/{short,long}/<model_version>/` | `services/ml/scripts/promote_*.py` | `predict-all-lots.job.ts` (cached locally on first read) |

Credentials live in two places (must stay in sync):
- Fly secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`,
  `S3_BUCKET` for the running backend.
- GitHub Actions secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` for the
  nightly restore-test workflow.

---

## Marketing site — Cloudflare Workers Static Assets

`apps/marketing/` is an Astro 5 + Tailwind v4 site (`/`, `/privacy`, `/terms`,
`/support`, `/delete-account`, `/404`) deployed via
[`.github/workflows/deploy-marketing.yml`](../.github/workflows/deploy-marketing.yml)
to a Cloudflare Worker named `sharkpark-marketing`. The Worker is intentionally
**not** connected to the GitHub repo through Cloudflare's dashboard Git
integration — all deploys go through GitHub Actions to avoid double-deploys.

The site also hosts the deep-link manifests at the apex:
- `https://sharkpark.app/.well-known/apple-app-site-association`
- `https://sharkpark.app/.well-known/assetlinks.json`

---

## Authentication — Azure AD (Microsoft Entra)

- Tenant: CSULB's Microsoft 365 tenant (free, already in place for SSO).
- App registration issues access tokens to the mobile app; backend validates
  them with `passport-jwt` against Microsoft's JWKS (`jwks-rsa`).
- Configuration: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` on both backend and
  mobile builds. Token expiry 1h, refresh-token rotation enabled, secure
  storage on iOS Keychain / Android Keystore.

Tier model (Public / Contributor / Authenticated) is documented separately in
[`docs/api-access-tiers.md`](../docs/api-access-tiers.md).

---

## Push notifications — Firebase Cloud Messaging

Single FCM project routes both Android (FCM) and iOS (APNs via Firebase). Backend
uses `firebase-admin` keyed by `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY` Fly secrets. Four scheduler jobs fan out user-preference
notifications (`notify-favorites-filling`, `notify-favorites-clearing`,
`notify-surge`, `notify-events`) at 15-minute cadence, each idempotent and
per-user-rate-limited.

---

## Observability

| Concern | Tool | Notes |
|---------|------|-------|
| Backend errors + perf | Sentry (`@sentry/nestjs`) | Releases tagged from CI; sourcemaps uploaded by the deploy workflow (fails loud if `SENTRY_AUTH_TOKEN` unset). |
| Mobile errors + perf | Sentry (`@sentry/react-native`) | JS-side init via `react-native-dotenv`. Native sourcemap upload is a known gap. |
| Cron job liveness | Sentry Crons | All 29 jobs check in via the registry in [`apps/backend/src/scheduler/cron-monitors.ts`](../apps/backend/src/scheduler/cron-monitors.ts); a unit test asserts the registry stays in lockstep with the actual `@Cron(...)` decorators. |
| External uptime | Better Stack | External blackbox probe on `/api/v1/health/ready`; powers `status.sharkpark.app`. |
| Logs | pino → Fly log shipper → console | No log aggregator — `flyctl logs` and Sentry breadcrumbs cover the on-call surface today. |

---

## CI/CD

Six GitHub Actions workflows under [`.github/workflows/`](../.github/workflows/):

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | every PR + push to `main` | Backend + mobile lint, typecheck, unit tests, build. |
| `deploy.yml` | push to `main` | Backend deploy: `pnpm db:deploy` → `pnpm db:seed:prod` → Sentry release + sourcemaps → `flyctl deploy --config apps/backend/fly.toml`. |
| `deploy-marketing.yml` | push to `main` touching `apps/marketing/**` | Astro build → `wrangler deploy` to the `sharkpark-marketing` Worker. |
| `neon_workflow.yml` | PR open / sync / close | Creates/destroys an ephemeral Neon branch per PR; runs E2E suite against it. |
| `restore-test.yml` | nightly cron | Pulls the latest R2 `pg_dump`, restores into a fresh Neon branch, runs read-only smoke queries, deletes the branch. |
| `seed-prod-lots.yml` | manual `workflow_dispatch` | One-shot manual reseed of CSULB lot reference data into prod. |

The deploy workflow's `concurrency: group: deploy-prod` serializes deploys so we
don't need Prisma's advisory-lock dance for migrations.

---

## Local development

The local stack mirrors the production topology — Postgres 17 instead of Neon,
MinIO instead of R2, but using the same Prisma client, the same SDK calls, and
the same `S3_ENDPOINT` pattern.

```bash
docker compose -f docker/docker-compose.yml up -d   # PG17 on :5433, MinIO on :9000

pnpm install                                         # workspace install
pnpm --filter @sharkpark/backend db:migrate          # apply migrations
pnpm --filter @sharkpark/backend db:seed             # full demo seed (lots, users, snapshots, weather)

pnpm --filter @sharkpark/backend dev                 # HTTP API on :3000
pnpm --filter @sharkpark/backend dev:scheduler       # standalone scheduler
pnpm --filter @sharkpark/mobile start                # Metro bundler on :8081
```

---

## Database schema (overview)

The current Prisma schema is the single source of truth at
[`apps/backend/prisma/schema.prisma`](../apps/backend/prisma/schema.prisma).
Run `pnpm --filter @sharkpark/backend db:studio` for a browseable view.

Conceptually the data model splits into four clusters:

- **Core / multi-tenant:** `schools`, `lots` (with `school_id` FK), `users`,
  `user_favorites`, `notification_preferences`, `lot_advisories` (concept3d
  construction notices).
- **Geofence pipeline:** `occupancy_events` (raw ENTER/EXIT, 30-day retention),
  `occupancy_snapshots` (15-minute aggregates, **permanent** — primary ML
  training source), `contributor_pings` (rolling TTL for the Contributor
  access tier), `device_states`.
- **ML predictions:** `predictions_short_term` (overwritten every 15 min by
  the cron, hours 7–21 local), `predictions_long_term` (overwritten daily,
  7-day horizon).
- **Context + product:** `weather` + `weather_forecasts` (NWS), `campus_events`
  (Sidearm + concept3d scrapers), `reports` (user-submitted), `push_tokens`,
  `notification_logs`.

Data retention is described in detail in the
[archived plan](archive/2026-02-aurora-tiered-plan.md#data-retention) — the
retention policy itself is unchanged from that document; only the hosting moved.

---

## Operations

- **Runbook:** [`docs/runbooks/runbook.md`](../docs/runbooks/runbook.md) —
  alerting playbook, common incidents, cron OOM recovery, secret rotation.
- **Restore drill:** [`docs/runbooks/restore.md`](../docs/runbooks/restore.md) —
  pulling the latest R2 backup and restoring to a Neon branch end-to-end.
- **API access tiers:** [`docs/api-access-tiers.md`](../docs/api-access-tiers.md) —
  Public / Contributor / Authenticated tier definitions and headers.
