# SharkPark Backend (`@sharkpark/backend`)

NestJS 11 API + standalone scheduler for the SharkPark monorepo. The full
project overview, architecture diagram, environment variables, and API
reference live in the [root README](../../README.md). This file is the
backend-specific entry-point cheat sheet.

## Process model

The backend ships as **two processes** from a single Docker image, switched at
container start by the entry-point file:

| Process | Entry | Fly process group | Purpose |
|---------|-------|-------------------|---------|
| HTTP API | [`src/main.ts`](src/main.ts) | `app` | Serves `/api/v1/*` REST + the `/shuttles` socket.io namespace. |
| Cron / scheduler | [`src/scheduler-main.ts`](src/scheduler-main.ts) | `cron` | Boots a Nest standalone application context (no HTTP listener) that owns all 29 `@nestjs/schedule` jobs. Sentry Cron check-ins + Postgres advisory locks per job. |

Both processes share the same module graph, Prisma client, Redis client, and
Sentry SDK — the difference is only what's mounted at boot.

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
pnpm test                 # Jest unit suite (664 tests / 49 suites)
pnpm test:e2e             # Jest E2E suite (requires running DB)
pnpm lint
pnpm typecheck
pnpm build                # Compiles to dist/

# Prisma
pnpm db:generate          # Regenerate Prisma client after schema edits
pnpm db:migrate           # Create + apply a new migration locally
pnpm db:deploy            # Apply pending migrations (used in CI/prod)
pnpm db:seed              # Full local demo seed
pnpm db:seed:prod         # Idempotent prod reference-data seed (auto-runs in deploy.yml)
pnpm db:studio            # Open Prisma Studio
```

## Layout

```
src/
├── auth/             # Azure AD JWT (Passport) + contributor grant/revoke
├── common/           # Global exception filters, interceptors
├── config/           # Typed config namespaces + boot-time validation
├── database/         # Global Prisma module (env-aware pool, @prisma/adapter-pg)
├── events/           # Campus events + scrapers
├── health/           # /health, /health/live, /health/ready
├── lots/             # Lots CRUD, history, predictions, recommendations
├── notifications/    # FCM push + 4 user-preference fan-out jobs
├── occupancy-events/ # Geofence event pipeline + atomic occupancy updates
├── redis/            # Global ioredis cache module
├── reliability/      # 5-factor weighted reliability scoring
├── reports/          # User-submitted lot status reports
├── scheduler/        # Standalone cron app + 29 @nestjs/schedule jobs
├── shuttle-tracker/  # PassioGO WS client + /shuttles socket.io gateway
├── users/            # Profiles, favorites, notification prefs, account deletion
├── weather/          # NWS api.weather.gov client + /weather/impact
├── main.ts           # HTTP entry (Fly app process)
└── scheduler-main.ts # Cron entry (Fly cron process)
```

## Environment variables

The canonical, fully-commented reference is [`.env.example`](.env.example).
Required for production: `DATABASE_URL`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`DEVICE_HASH_SALT`, `DEVICE_EVENT_SECRET`, `WS_CONNECT_SECRET`, `REDIS_URL`,
`CORS_ORIGINS`, plus the R2 credentials (`AWS_*` + `S3_ENDPOINT`) used by the
backup and ML-export jobs. Sentry, Firebase, and weather overrides are
optional and degrade gracefully when unset (logged as warnings).

## Operations

- **Runbook:** [`docs/runbooks/runbook.md`](../../docs/runbooks/runbook.md) — alerting playbook, secret rotation, common incidents.
- **Restore drill:** [`docs/runbooks/restore.md`](../../docs/runbooks/restore.md) — pulling the latest R2 backup and restoring to a Neon branch.
- **Deploy pipeline:** `.github/workflows/deploy.yml` — push to `main` triggers migrations → seed-prod → Sentry release → `flyctl deploy`.
