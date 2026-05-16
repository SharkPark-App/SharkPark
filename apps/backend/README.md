# SharkPark Backend (`@sharkpark/backend`)

NestJS 11 API + standalone scheduler that powers the SharkPark monorepo. The
public-facing project overview, architecture diagram, end-to-end environment
reference, and consolidated API table live in the [root README](../../README.md).
This file is the **engineering deep-dive** for backend contributors.

## Table of contents

- [Process model](#process-model)
- [Module map](#module-map)
- [Cron jobs](#cron-jobs)
- [Key cross-cutting concerns](#key-cross-cutting-concerns)
- [Local development](#local-development)
- [Database & Prisma](#database--prisma)
- [Testing](#testing)
- [Environment variables](#environment-variables)
- [Operations](#operations)

## Process model

The backend ships as **two processes** from a single Docker image, switched at
container start by the entry-point file:

| Process | Entry | Fly process group | Purpose |
|---------|-------|-------------------|---------|
| HTTP API | [`src/main.ts`](src/main.ts) | `app` | Serves `/api/v1/*` REST + the `/shuttles` socket.io namespace. Autostop min=0; readiness gate at `/api/v1/health/ready`. |
| Cron / scheduler | [`src/scheduler-main.ts`](src/scheduler-main.ts) | `cron` | Boots a Nest standalone application context (no HTTP listener) that owns all 35 `@nestjs/schedule` jobs. Sentry Cron check-ins + Postgres advisory locks per job. |

Both processes share the same module graph, Prisma client, Redis client, and
Sentry SDK — only what's mounted at boot differs. The split lets us scale and
deploy them independently while keeping a single source of truth for code.

## Module map

```
src/
├── admin/            # Operator endpoints: ML pipeline status, consensus, penetration-rate diagnostics
├── auth/             # Azure AD JWT (Passport) + contributor grant/revoke
├── common/           # Global exception filters, interceptors, shared DTOs
├── config/           # Typed config namespaces (app, auth, db, weather, notifications, privacy) with boot-time validation
├── database/         # Global Prisma module (env-aware pool, @prisma/adapter-pg)
├── events/           # Campus events + scrapers (LBSU sports, general campus calendar)
├── health/           # /health, /health/live, /health/ready (Fly probes)
├── lots/             # Lots CRUD, history, recommendations, short/long-term predictions, trends, utilization
├── min-version/      # /min-version endpoint for the mobile force-update gate
├── notifications/    # FCM push + four user-preference fan-out jobs
├── occupancy-events/ # Geofence event pipeline (HMAC verification, dedup, atomic occupancy update)
├── redis/            # Global ioredis cache module (shared shuttle state across instances)
├── reliability/      # 5-factor weighted reliability scoring (penetration, freshness, frequency, sample size, history)
├── reports/          # User-submitted lot status reports
├── scheduler/        # Standalone cron app + 35 @nestjs/schedule jobs
├── shuttle-tracker/  # PassioGO WS client + /shuttles socket.io gateway
├── users/            # Profiles, favorites, notification prefs, account deletion, /me/data export
├── weather/          # NWS api.weather.gov client + /weather/impact
├── main.ts           # HTTP entry (Fly `app` process)
├── scheduler-main.ts # Cron entry (Fly `cron` process)
├── instrument.ts     # Sentry init (loaded before Nest bootstrap)
└── constants.ts      # App-wide constants (e.g. MIN_FLOOR_RATE, LOW_ACTIVITY_FLOOR_RATE)
```

Each feature module contains its own controller, service, DTOs, and `*.spec.ts`
files. Domain types shared with the mobile app live in
[`packages/types`](../../packages/types).

## Cron jobs

All 35 jobs are defined under [`src/scheduler/jobs/`](src/scheduler/jobs/) and
registered through [`cron-runner.service.ts`](src/scheduler/cron-runner.service.ts),
which provides:

- **Sentry Cron check-ins** for every job (success, failure, missed).
- **Postgres advisory locks** so a job never overlaps itself across instances.
- **Tracked-run persistence** via the `cron_runs` / `ml_cron_runs` tables.
- **Error-message truncation** at 16,000 chars before persisting.
- **Model-version drift detection** on every successful ML cron run — emits a
  Sentry warning when a new model version differs from the previous successful
  run for the same job.

Job categories:

| Category | Examples |
|----------|----------|
| Snapshots & data quality | `snapshot.job`, `recompute-penetration-rates.job`, `cleanup-device-states.job`, `prune-consensus-observations.job` |
| Weather & transit | `fetch-weather.job`, `fetch-weather-forecast.job`, `fetch-transit.job` |
| Events ingestion | `fetch-events.job`, `fetch-sports-events.job`, `refresh-sports-finals.job`, `ingest-csulb-catalog.job`, `ingest-room-capacities.job` |
| ML inference & accuracy | `predict-short-term.job`, `predict-long-term.job`, `prediction-accuracy.job`, `build-proximity-matrix.job` |
| Lot metadata | `refresh-lot-metadata.job`, `refresh-lot-advisories.job` |
| Notifications fan-out | `notify-events.job`, `notify-favorites-clearing.job`, `notify-favorites-filling.job`, `notify-surge.job` |
| Backups & retention | `backup-db.job`, `verify-latest-backup.job`, `prune-old-data.job`, `prune-old-events.job`, `prune-notification-logs.job`, `prune-old-report-messages.job`, `prune-contributor-pings.job` |

## Key cross-cutting concerns

### Request lifecycle

A typical authenticated REST request traverses the same stack on every route:

```
HTTP request
  │
  ▼
Helmet                       ← security headers
  │
  ▼
Throttler                    ← 20 req / 10 s per IP (configurable)
  │
  ▼
CORS                         ← prod uses CORS_ORIGINS allow-list
  │
  ▼
Global ValidationPipe        ← class-validator on DTOs (whitelist + transform)
  │
  ▼
JwtAuthGuard (Passport)      ← validates Azure AD JWT against JWKS
  │                             ↳ on success: req.user = { sub, email, … }
  ▼
@Roles(...) guard (optional) ← contributor / admin checks for elevated routes
  │
  ▼
Controller method            ← thin: parses params, delegates to service
  │
  ▼
Service                      ← business logic; calls Prisma / Redis / scrapers
  │
  ▼
Prisma ($transaction where needed)
  │
  ▼
Response DTO + global ResponseInterceptor (envelope/timing)
  │
  ▼
GlobalExceptionFilter        ← maps thrown errors → typed HTTP responses
                                + Sentry capture for 5xx
```

Public endpoints (`/health/*`, `/min-version`, `/lots/*` reads, `/transit/*`
reads) skip `JwtAuthGuard` via `@Public()`. The occupancy-event POST swaps
JWT for an HMAC-SHA256 signature check using `DEVICE_EVENT_SECRET`.

### How modules talk to each other

The module graph is intentionally shallow — controllers stay thin, services
own the cross-module composition, and Prisma is the only shared write path:

- **`OccupancyEventsService`** is the *write side* of presence data. It's
  invoked by the controller (mobile POSTs) and consumed indirectly by
  `LotsService` (via `Lot.currentOccupancy`) and the `snapshot.job`.
- **`snapshot.job`** (cron) reads live counters + calls `ReliabilityService`
  + `WeatherService` + the academic-calendar helper, then writes a
  `LotSnapshot` row. Snapshots are the **only input** the ML scripts read.
- **`LotsService`** is the *read side*. For predictions it queries the
  `predictions_short_term` / `predictions_long_term` tables (written by the
  ML cron jobs, not by Nest), and falls back to its in-process heuristic
  when no fresh row exists — tagging the response with `source`.
- **`ShuttleTrackerService`** holds a long-lived PassioGO WebSocket and
  fan-outs to subscribed mobile clients via the `/shuttles` socket.io
  namespace. Redis is used so multiple `app` instances see the same shuttle
  snapshot.
- **`NotificationsService`** is invoked by four cron jobs and by the
  `/users/me/push-test` endpoint; it never calls other domain services
  directly — it only reads Prisma and pushes to FCM.
- **`AdminController`** is read-only and queries `cron_runs` / `ml_cron_runs`
  + Prisma directly to render the ML-status dashboard.

The cron and HTTP processes share the same `AppModule` graph; only the
bootstrap entry differs (`main.ts` mounts the HTTP listener,
`scheduler-main.ts` does not). That's why a service like `LotsService` is
freely callable from both an HTTP controller and a cron job without
duplication.

### Privacy

- Raw device IDs are hashed with SHA-256 + `DEVICE_HASH_SALT` **before** any DB write.
- Occupancy-event endpoints enforce HMAC-SHA256 signatures with `DEVICE_EVENT_SECRET`.
- `users/me/data` provides a self-service data export; account deletion cascades
  through favorites, push tokens, and notification preferences.

### Atomic occupancy updates

Each ENTER/EXIT event runs inside a Prisma `$transaction` that:
1. Creates the event record.
2. Increments or decrements the lot's `currentOccupancy`.
3. Upserts the device's state (for dedup).

A floor guard prevents `currentOccupancy` from dropping below zero. The
deduplication layer silently ignores duplicate ENTER-ENTER / EXIT-EXIT events
per (device, lot).

### Forecast `source` field

`GET /lots/:id/predictions/short-term` and `/predictions/long-term` both return
`source: 'ml' | 'heuristic'`:

- `'ml'` — fresh ML rows are present (within the freshness window).
- `'heuristic'` — backend falls back to its server-side time-of-day heuristic
  (`generateHeuristicShortTermPredictions` / long-term equivalent), so the
  endpoint always returns a forecast even if the ML cron is degraded.

The mobile app surfaces this as a badge on the forecast screens so users know
whether they're looking at a model prediction or a fallback.

### Cold-start floor

The constants `MIN_FLOOR_RATE` (0.15) and `LOW_ACTIVITY_FLOOR_RATE` (0.05) live
in [`src/constants.ts`](src/constants.ts) and are mirrored exactly in the ML
service's [`cold_start_floor.py`](../../services/ml/src/postprocess/cold_start_floor.py).
That keeps the live tile and the ML forecast visually consistent during the
pre-launch period when penetration is too low to trust raw counts.

### Observability

- **Sentry** for errors, performance, and Cron monitor check-ins.
- **nestjs-pino** structured JSON logs tagged with the originating process
  (`app` vs `scheduler`) for log-drain filtering.
- The snapshot job's best-effort consensus path captures any failures to Sentry
  without failing the parent run, so degraded consensus surfaces in alerts but
  doesn't block snapshotting.

## Local development

```bash
# From repo root (sets up Docker + env + DB):
pnpm install

# Then, in this directory:
pnpm dev              # Watch-mode HTTP API (port 3000)
pnpm dev:scheduler    # Watch-mode standalone scheduler process (jobs only)
```

Useful one-shots:

```bash
pnpm test                 # Jest unit suite (929 tests / 81 suites)
pnpm test:e2e             # Jest E2E suite (requires running DB)
pnpm lint
pnpm typecheck
pnpm build                # Compiles to dist/
```

## Database & Prisma

```bash
pnpm db:generate          # Regenerate Prisma client after schema edits
pnpm db:migrate           # Create + apply a new migration locally
pnpm db:deploy            # Apply pending migrations (used in CI/prod)
pnpm db:seed              # Full local demo seed
pnpm db:seed:prod         # Idempotent prod reference-data seed (auto-runs in deploy.yml)
pnpm db:studio            # Open Prisma Studio
```

- Schema lives in [`prisma/schema.prisma`](prisma/schema.prisma).
- Local: PostgreSQL 17 via Docker (`docker/docker-compose.yml`).
- Production: Neon Postgres 17, always connected through the **pooled**
  endpoint (`-pooler.`) with `pgbouncer=true&connection_limit=1`.
- The runtime uses `@prisma/adapter-pg` so connection-pool sizing follows
  `dbConfig` (5 local, 20 prod) rather than Prisma's defaults.

## Testing

- Unit suite: `pnpm test` — **929 tests across 81 suites**.
- E2E suite: `pnpm test:e2e` — runs against a live DB via `jest-e2e.js`.
- E2E specs live in [`test/`](test/).
- All cron jobs have a `*.spec.ts` companion that exercises the `_ml-runner` /
  `_ml-result` helpers end to end, including the SUCCESS / SKIPPED / FAILURE
  payload contract.

## Environment variables

The canonical, fully-commented reference is [`.env.example`](.env.example).

**Required for production:** `DATABASE_URL`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`DEVICE_HASH_SALT`, `DEVICE_EVENT_SECRET`, `WS_CONNECT_SECRET`, `REDIS_URL`,
`CORS_ORIGINS`, plus the backup R2 credentials (`R2_ACCOUNT_ID`,
`BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `R2_BACKUPS_BUCKET`)
and ML R2 credentials (`R2_ENDPOINT_URL`, `ML_R2_ACCESS_KEY_ID`,
`ML_R2_SECRET_ACCESS_KEY`).

**Optional (degrade gracefully when unset, logged as warnings):** `SENTRY_DSN`,
`SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, Firebase service-account credentials,
weather overrides (`WEATHER_USER_AGENT`, `WEATHER_LAT`, `WEATHER_LON`),
`LOG_LEVEL`.

## Operations

- **Runbook:** [`docs/runbooks/runbook.md`](../../docs/runbooks/runbook.md) — alerting playbook, secret rotation, common incidents.
- **Restore drill:** [`docs/runbooks/restore.md`](../../docs/runbooks/restore.md) — pulling the latest R2 backup and restoring to a Neon branch.
- **Deploy pipeline:** [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) — push to `main` triggers migrations → `db:seed:prod` → Sentry release + sourcemap upload → `flyctl deploy` (rolling, gated by `/health/ready`).
- **API access tiers:** [`docs/api-access-tiers.md`](../../docs/api-access-tiers.md) — public vs authenticated vs contributor vs admin scopes.
