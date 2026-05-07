# SharkPark — System Overview (for new developers)

A guided tour of the codebase. Read this in order. Pair it with [PRE_LAUNCH_AUDIT.md](PRE_LAUNCH_AUDIT.md) for production-readiness context.

---

## 1. The 30-second pitch

SharkPark estimates how full each parking lot at CSULB is, in real time and forecast forward 7 days. Mobile users contribute anonymous "I parked / I left" events; the backend converts those events into per-lot occupancy snapshots, scales them up by an estimated app-penetration rate, and feeds the time series into XGBoost models that predict short-term (next ~14h) and long-term (next 7d) occupancy. The mobile app reads predictions and displays a "filling / nearly full / full" decision for each lot.

Three correctness ideas are non-obvious and worth internalizing:

1. **Penetration rate** is the multiplier from "devices we observed" to "people actually parking". It is per-lot, per-(day-of-week-bucket, hour), and learned from ground truth via EWMA. It blends with a rule-based estimate when learned data is sparse or stale.
2. **Reliability score** is a 0–100 confidence number on every snapshot. Predictions with low reliability are rendered with widened confidence intervals on mobile.
3. **Cold-start handling.** Lots with little real data fall back to synthetic-data-trained models and rule-based penetration estimates. The hybrid weight automatically shrinks synthetic share as real data accumulates.

---

## 2. End-to-end data flow

```
Mobile background-location detector
    │  (HMAC-signed event)
    ▼
POST /api/v1/occupancy-events  ──────────────────────────────────►  occupancy_events row
                                                                          │
                                  every 15 min (snapshot.job.ts)          │
                                                                          ▼
                               group → unique device_hash count → occupancy_snapshots
                                                                          │
                       penetration-estimation.service ─── COMMUTER_MAP ◄──┤
                       (rule × time × campus devices,        TIME_MULT    │
                        blended with EWMA from ground-truth)              │
                                                                          ▼
                       reliability.service (6 factors) ─────► snapshot.reliability_score
                                                                          │
                            ML cron (predict-short-term / -long-term)     │
                                                                          ▼
                       services/ml/scripts/predict_*.py
                       └─ load model @production from MLflow registry (R2-backed)
                       └─ fetch features (snapshot lags, calendar, weather)
                       └─ predict 3 quantiles (0.1 / 0.5 / 0.9)
                       └─ apply weather adjustment (rule-based)
                       └─ apply low-activity scaling
                                                                          │
                                                                          ▼
                                                    prediction_short_term / _long_term
                                                                          │
                                  GET /lots/:id/predictions/{short,long}-term
                                                                          ▼
                                                              Mobile lots service
                                                                          ▼
                                                Mobile renders decision + CI band
```

Side flows:
- **NWS weather** every 30 min → `Weather`; every 6h → `WeatherForecast` (next 7d hourly).
- **CampusLabs events** daily → `CampusEvent`. **Sidearm sports** daily + finals refresh every 30 min.
- **Backups** daily 02:00 PT → `pg_dump` → R2; weekly Monday verify.
- **EWMA recompute** daily 02:30 PT reads yesterday's ground-truth consensus into `PenetrationRateEstimate`.
- **ML retraining** is a GitHub Actions workflow (not in-backend cron): daily short-term, weekly Sunday long-term.

---

## 3. Backend (`apps/backend`)

NestJS 11 + Prisma 7 + Postgres (Neon, PG17, pooled `pgbouncer=true&connection_limit=1`).

### 3.1 Entry points

- [src/main.ts](../apps/backend/src/main.ts) — HTTP entrypoint. Boots Nest, applies global pipes, listens on `PORT`.
- [src/scheduler-main.ts](../apps/backend/src/scheduler-main.ts) — Cron entrypoint. Same code, but `cron` Fly process group runs this instead of `main.ts`. Allows separate VM sizing (1GB to absorb Python ML spikes).
- [src/instrument.ts](../apps/backend/src/instrument.ts) — Sentry init (must `import './instrument';` first).
- [src/app.module.ts](../apps/backend/src/app.module.ts) — Root module composition.

### 3.2 Domain modules

- **`auth/`** — Azure AD JWT validation (Passport strategy), contributor service (rolling 30-min "is this device actively contributing" pings).
- **`occupancy-events/`** — Receives `enter`/`exit` events. `privacy.util.ts` SHA-256s `device_id` with `DEVICE_HASH_SALT`. HMAC-SHA256 verification with `DEVICE_EVENT_SECRET` (must match mobile build).
- **`lots/`** — Lot listing, snapshot computation, the **two most important services in the codebase**:
  - [penetration-estimation.service.ts](../apps/backend/src/lots/penetration-estimation.service.ts) — three-layer estimator. Rule (`commuters × timeMultiplier`), bounded by `SCALING_CAPS` (max 2× / 5× / 10× / 20× by `campusDevices` thresholds 0/50/200/500), blended with learned EWMA at 70% weight when ≥30 samples and ≤14d old.
  - [academic-calendar.ts](../apps/backend/src/lots/academic-calendar.ts) — rule-based CSULB calendar (4th Mon Aug, MLK rules, etc.). Mirror in Python: `services/ml/src/academic_calendar.py`. **Both must stay in sync.**
  - [derive-lot-buildings.ts](../apps/backend/src/lots/derive-lot-buildings.ts) — populates `LotBuilding` join table at 250m radius.
- **`reliability/reliability.service.ts`** — six-factor weighted score (penetration 30%, freshness 21%, frequency 17%, samples 13%, history 4%, reports 15%). Cold-start triggers documented in [PRE_LAUNCH_AUDIT.md §2 Q3](PRE_LAUNCH_AUDIT.md#q3-does-each-lot-have-its-own-reliability-score-what-are-the-components).
- **`events/`** — CampusLabs JSON scraper, Sidearm sports scraper, `getEventsForLot` (joins via `lot_buildings`).
- **`weather/`** — NWS `api.weather.gov` client (no auth; rate limit honoured via `User-Agent`). Fetches both current obs and 7-day hourly forecast.
- **`reports/`** — User-submitted lot reports (closure, full, etc.), used as a reliability negative signal.
- **`scheduler/`** — see §3.3.
- **`admin/`** — admin endpoints behind `ADMIN_API_KEY`. `GET /admin/ml-status`, `GET /admin/penetration-rate/:lotId`, `GET /admin/consensus/:lotId?date=...`.
- **`health/`** — `/health/live` (liveness, no DB), `/health/ready` (readiness, DB ping).
- **`shuttle-tracker/`** — WebSocket gateway gated by `WS_CONNECT_SECRET`.
- **`min-version/`** — version floor enforcement for mobile clients.
- **`config/`** — single source of truth for env-derived configuration. **Always read env vars through here.**

### 3.3 Scheduler (cron)

- [scheduler/cron-runner.service.ts](../apps/backend/src/scheduler/cron-runner.service.ts) — every job calls `cronRunner.run('job-name', () => ...)`. Wraps the body in a Sentry check-in heartbeat + Postgres advisory lock.
- [scheduler/advisory-lock.ts](../apps/backend/src/scheduler/advisory-lock.ts) — `pg_try_advisory_lock(hash64(jobName))`. Returns immediately if another instance holds the lock — safe under Fly rolling deploys (briefly two cron Machines exist).
- [scheduler/cron-monitors.ts](../apps/backend/src/scheduler/cron-monitors.ts) — registers all 29 jobs with Sentry Crons (heartbeats + missed-run alerts).
- [scheduler/jobs/](../apps/backend/src/scheduler/jobs/) — one file per job. See [PRE_LAUNCH_AUDIT.md §6](PRE_LAUNCH_AUDIT.md#6-cron-job-inventory-27-jobs) for the full schedule.
- [scheduler/jobs/_ml-runner.ts](../apps/backend/src/scheduler/jobs/_ml-runner.ts) — spawns Python (`/opt/venv/bin/python`) with `services/ml` on `PYTHONPATH`. Used by `predict-short-term` and `predict-long-term`.

### 3.4 Database (`prisma/schema.prisma`)

Key models:
- **`Lot`** — static lot metadata (capacity, geometry, school).
- **`OccupancyEvent`** — raw enter/exit, retention 30d (`RETENTION_DAYS`).
- **`OccupancySnapshot`** — every 15 min per lot. Carries `reliability_score`, `is_cold_start`, `penetration_rate_used`, `estimated_occupancy`. Permanent.
- **`ConsensusObservation`** — 5-min buckets used as ground truth for EWMA. Marked `is_ground_truth=true` when quorum reached. (See open question in audit re: retention.)
- **`PenetrationRateEstimate`** — per-(lot, dow_bucket, hour) EWMA + variance + sample count + last-updated.
- **`PredictionShortTerm`**, **`PredictionLongTerm`** — model output (median + lower/upper quantiles); upsert primary keys handle re-prediction.
- **`Building`**, **`LotBuilding`**, **`LotBuildingProximity`** — building footprints + lot↔building joins for nearby-events and softmax demand allocation.
- **`CampusEvent`** — scraped events; indexed `[building_id, start_time]` and `[status, start_time]`.
- **`Weather`**, **`WeatherForecast`** — NWS observations and 7-day hourly forecast.
- **`DeviceState`** — current ENTER/EXIT state per `device_hash`; cleaned up at 18h stale.

---

## 4. ML pipeline (`services/ml`)

Python 3.11 + XGBoost + MLflow. Managed with `uv`. R2 (S3-compatible) for model artifact storage.

### 4.1 Data layer (`src/data/`)

- [db.py](../services/ml/src/data/db.py) — Postgres reads via `psycopg2`. Two key fetchers: `fetch_short_term_data`, `fetch_long_term_data`, plus `fetch_long_term_weather_forecast` (added this session).
- [synthetic.py](../services/ml/src/data/synthetic.py) — v1 heuristic occupancy curves. Tagged `_source="synthetic"`, weight 0.1.
- [synthetic_v2.py](../services/ml/src/data/synthetic_v2.py) — v2 catalog-driven generator from CSULB **public** Schedule of Classes + Lecture Room Allocation. **No PII, no auth-required sources.** Tagged `_source="synthetic_v2"`, weight 1.0.
- [hybrid_loader.py](../services/ml/src/data/hybrid_loader.py) — combines real + synthetic with 4-tier sample weighting (`real_clean=10.0, real_cold=1.0, synthetic_v2=1.0, synthetic_v1=0.1`) and per-lot synthetic decay `1 / (1 + n_real_for_lot / 100)`.

### 4.2 Feature engineering (`src/features/`)

- [short_term.py](../services/ml/src/features/short_term.py) — lag features (1–4 hours), momentum, hour, dow, week_of_semester, weather. Numeric vs categorical split.
- [long_term.py](../services/ml/src/features/long_term.py) — Stage 1: 4-week rolling baseline filtered by `(lot_id, academic_period, dow, hour)`. Stage 2: XGBoost on the deviation. Categorical features include `semester` and `academic_period` so summer doesn't contaminate fall baselines.

### 4.3 Models (`src/models/`)

- [base.py](../services/ml/src/models/base.py) — quantile XGBoost wrapper (3 models per horizon: 0.1, 0.5, 0.9). Volume-normalized sample weighting.
- [short_term.py](../services/ml/src/models/short_term.py), [long_term.py](../services/ml/src/models/long_term.py) — feature lists, training entry points.
- Hyperparameters hardcoded today (`n_estimators=200, max_depth=6, lr=0.1`); Optuna sweep deferred until ≥6 months of real data.

### 4.4 Postprocessing (`src/postprocess/`)

- [weather_adjustment.py](../services/ml/src/postprocess/weather_adjustment.py) — `apply_weather_adjustment` (current obs) and `apply_weather_adjustment_long_term` (uses `WeatherForecast` per-target-hour). Rule-based severity classes.
- [low_activity_scaling.py](../services/ml/src/postprocess/low_activity_scaling.py) — caps predictions during `winter_session` (10%), `summer_session` (30%), and `break` (5%).

### 4.5 Promotion guard (`src/utils/`)

- [promotion_guard.py](../services/ml/src/utils/promotion_guard.py) — 4 rules to auto-promote a candidate over `@production`:
  1. Required metric (`mae_holdout`) present.
  2. `mae_holdout ≤ ML_PROMOTE_MAX_MAE_*` floor (0.20 short / 0.25 long).
  3. ≥1% relative MAE improvement (`ML_PROMOTE_MIN_IMPROVEMENT_PCT`).
  4. Quantile coverage in [0.7, 0.9] (calibration sanity).

- [mlflow_setup.py](../services/ml/src/utils/mlflow_setup.py) + [mlflow_utils.py](../services/ml/src/utils/mlflow_utils.py) — MLflow registry + R2 artifact export. Mirrors `R2_*` env vars to AWS-style names for boto3.

### 4.6 Entry-point scripts (`scripts/`)

- [train_short_term.py](../services/ml/scripts/train_short_term.py), [train_long_term.py](../services/ml/scripts/train_long_term.py) — train + log to MLflow + optionally auto-promote.
- [predict_short_term.py](../services/ml/scripts/predict_short_term.py), [predict_long_term.py](../services/ml/scripts/predict_long_term.py) — load `@production` model, fetch features, predict, postprocess, write to Postgres.
- [recompute_penetration_rates.py](../services/ml/scripts/recompute_penetration_rates.py) — daily EWMA update.
- [build_proximity_matrix.py](../services/ml/src/scripts/build_proximity_matrix.py) — weekly lot↔building proximity weights.

### 4.7 Tests (`tests/`)

~75–80 pytest cases. Run: `cd services/ml && uv run pytest -q`. Tests cover hybrid loader weighting, weather adjustment ordering, promotion guard rules, calendar transitions.

---

## 5. Mobile (`apps/mobile`)

React Native, jest, `react-native-dotenv` for env injection. Most UI screens read from `lotsApi`:

- [src/services/api/lots.ts](../apps/mobile/src/services/api/lots.ts) — `getLongTermForecast(lot, {days, forceRefresh})`, cache TTL 30 min, days clamped to [1, 14], cache key `lots:longTermForecast:${lot_id}:${days}`. Falls back to per-day `generateForecast` when background location revoked.
- [src/screens/LongTermForecastScreen.tsx](../apps/mobile/src/screens/LongTermForecastScreen.tsx) — calls `lotsApi.getLongTermForecast()` with BG-location fallback.
- HMAC-signing of occupancy events uses `DEVICE_EVENT_SECRET` from the build-time `.env`.

---

## 6. Environment variables and secrets

See [PRE_LAUNCH_AUDIT.md §10](PRE_LAUNCH_AUDIT.md#10-deployment-checklist) for the canonical deployment list. Quick categories:

- **Backend secrets (Fly):** auth (Azure), security (HMAC + hash salt), Sentry, Firebase, R2, MLflow, weather UA. ~20 entries.
- **ML secrets (GitHub Actions):** Postgres URL, MLflow URI + artifact location, R2 access. ~8 entries.
- **Deploy secrets (GitHub Actions):** Fly token, Sentry CLI, Neon API, Cloudflare. ~7 entries.
- **Mobile build (`.env`):** API URL, HMAC secrets, Sentry DSN. 4 entries.

`config/configuration.ts` is the single source of truth for the backend reading env vars. New env vars **must** be added there with a typed default.

---

## 7. Deployment topology

- **Fly.io app `sharkpark-api`**, primary region `lax`. Two process groups: `app` (HTTP, 512MB, `min_machines_running=1`) and `cron` (1GB, always-on).
- **Health gating:** `/health/live` + `/health/ready` (30s grace) gate rolling deploys.
- **Rollback:** `flyctl releases rollback <version>`.
- **Database:** Neon Postgres in `us-west-2`, PG17. Pooled URL for app reads, direct URL for migrations + `pg_dump`.
- **ML training:** GitHub Actions workflow `ml-retrain.yml` runs daily/Sunday on hosted runners; pushes models to MLflow + R2; backend's cron jobs pull `@production` at inference time.
- **Mobile:** built locally or via EAS; app store distribution.
- **Marketing:** Cloudflare Pages, separate workflow.

---

## 8. Onboarding checklist for a new developer

1. Clone the repo. Run `pnpm install && pnpm typecheck` from the root. Should pass 5/5 packages.
2. Start local infra: `pnpm --filter @sharkpark/backend infra:up` (Docker postgres + LocalStack S3).
3. Run migrations + seed: `pnpm --filter @sharkpark/backend db:deploy && pnpm --filter @sharkpark/backend db:seed`.
4. Generate dev secrets in `apps/backend/.env`: `openssl rand -hex 32` four times for `DEVICE_HASH_SALT`, `DEVICE_EVENT_SECRET`, `WS_CONNECT_SECRET`, `ADMIN_API_KEY`.
5. Run the backend: `pnpm --filter @sharkpark/backend dev`.
6. Read in this order to learn the system:
   1. [PRE_LAUNCH_AUDIT.md §2 Q1–Q3](PRE_LAUNCH_AUDIT.md#2-the-13-questions-answered) — penetration rate + reliability concepts.
   2. [src/lots/penetration-estimation.service.ts](../apps/backend/src/lots/penetration-estimation.service.ts) — see the math in code.
   3. [src/lots/academic-calendar.ts](../apps/backend/src/lots/academic-calendar.ts) — calendar rules.
   4. [src/scheduler/cron-runner.service.ts](../apps/backend/src/scheduler/cron-runner.service.ts) and one job (e.g. [snapshot.job.ts](../apps/backend/src/scheduler/jobs/snapshot.job.ts)).
   5. [services/ml/src/models/short_term.py](../services/ml/src/models/short_term.py) + the matching `predict_short_term.py` script.
7. Run all tests: `pnpm test && cd services/ml && uv run pytest -q`.

---

## 9. Where to find more

- **Production-readiness, fixes, deployment checklist:** [PRE_LAUNCH_AUDIT.md](PRE_LAUNCH_AUDIT.md).
- **Operational runbooks:** [docs/runbooks/runbook.md](runbooks/runbook.md), [docs/runbooks/restore.md](runbooks/restore.md).
- **Mobile network setup:** [mobile-network-setup.md](mobile-network-setup.md).
- **API access tiers:** [api-access-tiers.md](api-access-tiers.md).
- **Privacy data inventory:** [privacy-data-inventory.md](privacy-data-inventory.md).
- **ML design rationale:** [services/ml/Model_Design.md](../services/ml/Model_Design.md).

*End of overview.*
