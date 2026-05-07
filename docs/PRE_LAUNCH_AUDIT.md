# SharkPark — Pre-Launch Audit

**Audit date:** 2026-05 (resumed work session)
**Scope:** Backend (NestJS / Prisma / Postgres), ML pipeline (Python / XGBoost / MLflow / Cloudflare R2), scrapers (CampusLabs, Sidearm, NWS), cron jobs and retention, deployment configuration (Fly.io).
**Out of scope:** Mobile UI/UX, marketing site.

> **Read this first.** This document is the canonical pre-launch readiness assessment. Pair it with [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) (architecture for new developers) and the deployment checklist in §10 below.

---

## 1. Executive summary

| Subsystem | Verdict | Blocking issues |
|---|---|---|
| Penetration rate / reliability | ✅ Production-ready | None blocking. EWMA lag at semester transitions noted. |
| Backend API + scheduler | ✅ Production-ready | None blocking. |
| ML training & inference | ⚠️ Ship with caveats | Currently synthetic-dominant; real-data hybrid gates already wired. No automated drift detection. |
| Scrapers (events, weather) | ⚠️ Ship with caveats | No `User-Agent`, no fetch timeout, no retry/backoff. Silent failure modes around CampusLabs/Sidearm schema drift. |
| Cron jobs + retention | ✅ Production-ready | All 29 jobs registered, locked, monitored. README counts updated to match. |
| Deployment / secrets | 🔴 Blocking issues exist | `restore-test.yml` has graceful-skip gates (violates project mandate). `.env.example` placeholders must be replaced with real secrets. |

**Net recommendation:** Ship after addressing §3 (HIGH-priority fixes). MEDIUM/LOW items can be tracked post-launch.

---

## 2. The 13 questions, answered

### Q1. How is penetration rate calculated per lot?

Three layers, blended:

1. **Rule-based campus rate.** `campusDevices / adjustedCommuters`, where `campusDevices` is the count of distinct `device_hash` in `occupancy_events` over the last 2 hours, and `adjustedCommuters = COMMUTER_MAP[semester] × timeMultiplier`. `COMMUTER_MAP`: `fall=35k, spring=34k, summer=8k, session=3k, break=1.5k`. `timeMultiplier`: 1.0 (weekday peak 7am–6pm) down to 0.05 (overnight / Sunday).
2. **Hard floor:** `MIN_PENETRATION_RATE = 0.01`.
3. **Learned EWMA blend (per-lot, per-(dow_bucket, hour)).** Recomputed nightly at 02:30 PT from yesterday's ground-truth consensus windows. Blended in at 70% weight only when ≥30 samples and ≤14 days old. Disabled by default; toggled via `PENETRATION_RATE_LEARNING_ENABLED`.

The result feeds occupancy scaling: `estimatedOccupancy = round(rawOccupancy / effectiveRate)`, capped by `SCALING_CAPS` based on campus-wide activity (max 20× when ≥500 devices, max 2× when very few), and clamped between `rawOccupancy` and `lot.capacity`.

Source: [apps/backend/src/lots/penetration-estimation.service.ts](../apps/backend/src/lots/penetration-estimation.service.ts), [apps/backend/src/lots/academic-calendar.ts](../apps/backend/src/lots/academic-calendar.ts).

### Q2. Are day-of-week and time-of-day adjustments applied?

Yes.

- Day-of-week buckets: Mon–Fri / Saturday / Sunday.
- Hour-of-day buckets: weekday peak (7–18), evening (18–22), night (22–7); Saturday day (8–18) vs other; Sunday flat.
- Closure days (federal holidays + campus calendar) collapse the multiplier to `CLOSURE_MULTIPLIER = 0.02`.

The EWMA itself is also bucketed per (lot, dow_bucket, hour), so learned rates inherit day-of-week and time-of-day structure.

### Q3. Does each lot have its own reliability score? What are the components?

Yes. Each `OccupancySnapshot` (written every 15 minutes) carries a `reliability_score` 0–100 and an `is_cold_start` flag.

Six weighted factors (defaults in [reliability.service.ts](../apps/backend/src/reliability/reliability.service.ts)):

| Factor | Weight | Signal |
|---|---|---|
| Penetration rate | 30% | Higher learned rate → higher score |
| Data freshness | 21% | Time since last event |
| Event frequency | 17% | Events per hour |
| Sample size | 13% | Unique devices per hour |
| Historical accuracy | 4% | Past prediction track record |
| User reports | 15% | Negative-only (presence = disagreement) |

A `sourceType` weight further dampens the score for FLAGGED contributors. Cold-start triggered when `penetrationRate < 0.05` OR `eventsInLastHour < 2` OR `uniqueDevicesInLastHour < 3` OR `minutesSinceLastEvent > 120`.

### Q4. Does the system improve as more data is collected?

Yes — both directly and indirectly.

- **Reliability factors** all monotonically improve with more recent / more numerous events.
- **Per-lot EWMA penetration rate** converges to true rate over ~10-day half-life (`α=0.1`), and shrinks synthetic ML weight per lot via `1 / (1 + n_real_for_lot / 100)` (D5 spec). Lots with abundant real data effectively train themselves out of synthetic dependence.
- **Cold-start handling** widens prediction CIs by 1.5× and applies more conservative scaling caps until thresholds are met.

What is **not yet implemented:** automated drift detection or live prediction-vs-actual error tracking (admin UI shows training-time MAE only). See §4 ML risks.

### Q5. Is there building proximity / campus demand modeling?

Yes — fully implemented.

- Buildings (`Building`) and lot-to-building joins (`LotBuilding`) populated in [derive-lot-buildings.ts](../apps/backend/src/lots/derive-lot-buildings.ts) at 250m radius using haversine + polygon-edge geometry.
- Weekly job `build-proximity-matrix.job.ts` computes `weight = exp(-distance_m / 250)` per (lot, building) into `lot_building_proximity`. Used by the synthetic-v2 generator's softmax allocation.
- `GET /lots/:id/nearby-events` joins through `lot_buildings` to surface CampusEvents.
- Room-capacity scrape (`ingest-room-capacities.job.ts`) populates `room_capacities` for class-driven demand modeling.

### Q6. How are semester transitions handled?

- **Calendar** is rule-based (4th Mon of August for fall, MLK rules for spring, etc.) and computed at runtime in both [academic-calendar.ts](../apps/backend/src/lots/academic-calendar.ts) and the Python mirror [services/ml/src/academic_calendar.py](../services/ml/src/academic_calendar.py). No DB table.
- `getWeekOfSemester(now)` returns one of: `early | regular | midterms | late | dead_week | finals | winter_session | summer_session | break`.
- Demand scaling: `COMMUTER_MAP` per category; floor rate drops from 15% to 5% during low-activity periods; 2% closure multiplier on holidays.
- ML features include `week_of_semester`, `semester`, `academic_period`, `is_campus_open`. Long-term baseline is **filtered by `academic_period`**, so summer data does not contaminate fall baselines.

**Known gap:** EWMA is one continuous series per (lot, dow_bucket, hour) — no semester-aware reset. At fall start, the EWMA reflects summer (~8k commuters). It will lag for 10+ days until 30 fresh fall samples accumulate. No pre-warming job exists. **Mitigation:** rule-based fallback kicks in when learned rate is stale (>14 days) or undersampled (<30), so the system degrades gracefully — not catastrophically. Tracked as a post-launch improvement.

### Q7. Synthetic vs real data — what is the model trained on right now?

**Synthetic-dominant, with hybrid gates ready.**

- **Synthetic v1** (`src/data/synthetic.py`) — heuristic occupancy curves; tagged `_source: "synthetic"`; weight 0.1.
- **Synthetic v2** (`src/data/synthetic_v2.py`) — built from CSULB **public** Schedule of Classes + Lecture Room Allocation only (no PeopleSoft, Ad Astra, CS-Link, no PII); weight 1.0.
- **Real data** from `occupancy_snapshots`. Two tiers: `real_clean` (default weight 10.0) and `real_cold` (weight 1.0). Per-lot decay `1 / (1 + n_real_for_lot / 100)` shrinks synthetic share automatically as real data grows.
- Training default windows: short-term last 90 days, long-term last 180 days. If no real rows exist, training degrades to synthetic-only (no error).

**Phase plan:** synthetic-only at launch → hybrid weeks 1–8 → real-dominant week 8+. Promotion gates measure baseline coverage (% of (lot, dow, hour) combos with ≥N obs) before allowing relative-improvement comparisons.

### Q8. How are predictions served at request time?

- **Short-term** (next ~14 hours, hourly buckets): cron `predict-short-term.job.ts` runs every 15 min at `:05/:20/:35/:50` PT, spawns `services/ml/scripts/predict_short_term.py`, upserts `prediction_short_term`. Backend reads on demand; falls back to a heuristic generator if no ML rows exist.
- **Long-term** (next 7 days): cron `predict-long-term.job.ts` runs daily 01:05 PT, spawns `predict_long_term.py`, upserts `prediction_long_term`. Backend bundles `WeatherForecast` rows alongside in `GET /lots/:id/predictions/long-term` (added this session).
- Postprocessing order: model.predict_quantiles → `apply_weather_adjustment*` (rule-based severity classes) → `apply_low_activity_scaling` (per-row period ceilings: 5% break, 10% winter session, 30% summer).

### Q9. Are there scheduled retraining jobs?

**Yes, in GitHub Actions (`.github/workflows/ml-retrain.yml`)** — not in the backend cron:

- Short-term: daily `0 10 * * *` UTC (≈02:00 PT).
- Long-term: weekly `0 11 * * 0` UTC (≈03:00 PT Sunday).

Both run training, evaluation, and conditional auto-promotion via `promotion_guard.py` (4 rules: metric present, absolute MAE floor, ≥1% relative improvement, quantile coverage in [0.7, 0.9]). Manual `workflow_dispatch` allows ad-hoc training and `auto_promote=false` for human review.

There is **no in-backend `retrain-models.ts` cron** (item shows up in the legacy backlog but was superseded by the GitHub Actions workflow — that is the production retraining path).

### Q10. Is there drift detection / prediction-vs-actual feedback?

**Not automated.** Infrastructure exists (`compute_data_coverage` in `src/evaluation/compare.py`, MLflow MAE history per run) but no live drift alarm, no scheduled prediction-vs-actual error log, no auto-retrain on accuracy degradation. Admin endpoints (`GET /admin/ml-status`, `GET /admin/penetration-rate/:lotId`, `GET /admin/consensus/:lotId`) allow manual inspection.

**Recommended post-launch:** add a daily job that compares yesterday's predictions to actual snapshots and emits MAE/coverage to Sentry as a custom metric.

### Q11. How does the backend discover the current production ML model?

`MLflow` model registry alias: each model is registered as `short-term-production` or `long-term-production`, and the alias `@production` is moved on each successful promotion. At inference time, `predict_*.py` calls `client.get_model_version_by_alias(name, "production")` and downloads artifacts from R2 (S3-compatible endpoint via boto3). No version pinning yet — backend always uses `@production`.

Rollback: `python -m scripts.promote_short_term --run-id <previous>` re-points the alias.

### Q12. What about the scrapers — are they robust?

**Functionally complete, operationally fragile.** Both scrapers use real JSON APIs (CampusLabs, Sidearm), so they avoid HTML breakage. But:

- ❌ No `User-Agent` header — both APIs see Node default; risk of being throttled or blocked.
- ❌ No fetch timeout — Node `fetch()` hangs indefinitely on slow endpoints; only the 15-minute Sentry deadline aborts the cron.
- ❌ No retry/backoff on transient HTTP errors.
- ❌ JSON `SyntaxError` (e.g., 429 returns HTML) propagates uncaught to the cron error handler.
- ⚠️ Sports scraper has hard sport→building mapping; building rename = silent skip.
- ⚠️ CampusLabs uses fuzzy text match on `location` against `Building.name + alternate_names`; CampusLabs renaming a building = silent unmatched warning.

These are not blocking but should be tracked. See §3 fixes.

### Q13. Are retention windows correct? The 30/90 day question.

**No mismatch in the code.** Verified:

| Table | Retention | Source |
|---|---|---|
| `occupancy_events` | **30 days** (default, `RETENTION_DAYS` env override) | [prune-old-data.job.ts](../apps/backend/src/scheduler/jobs/prune-old-data.job.ts) |
| `occupancy_snapshots` | Permanent (ML training source) | No prune cron |
| `consensus_observations` | Permanent (no prune cron) | ⚠️ Inconsistent with infra README claim of 90d |
| `weather` (observations) | Permanent | No prune cron (PR #173) |
| `weather_forecast` | Self-pruned to active window | Cron deletes past `target_time` rows on each upsert |
| `campus_events` | **90 days** (`EVENT_RETENTION_DAYS`) | [prune-old-events.job.ts](../apps/backend/src/scheduler/jobs/prune-old-events.job.ts) |
| `notification_logs` | **90 days** (`NOTIFICATION_LOG_RETENTION_DAYS`) | [prune-notification-logs.job.ts](../apps/backend/src/scheduler/jobs/prune-notification-logs.job.ts) |
| `contributor_pings` | **180 days idle** (`CONTRIBUTOR_PING_RETENTION_DAYS`) | [prune-contributor-pings.job.ts](../apps/backend/src/scheduler/jobs/prune-contributor-pings.job.ts) |
| `reports.message` | **90 days, redacted only** (`REPORT_MESSAGE_RETENTION_DAYS`) | [prune-old-report-messages.job.ts](../apps/backend/src/scheduler/jobs/prune-old-report-messages.job.ts) |
| `prediction_short_term` / `prediction_long_term` | Self-overwriting via upsert | Last write wins |

The "30 vs 90" suspicion likely reflected confusion between **30d events** (raw user activity, privacy promise) and **90d snapshot retention claim** in older docs. Snapshots are actually permanent. **Update README** to match.

---

## 3. Bugs, risks, and recommended fixes (priority-ordered)

### 🔴 HIGH — must fix before deployment

1. **`restore-test.yml` graceful-skip gates** ([.github/workflows/restore-test.yml](../.github/workflows/restore-test.yml)). ✅ **Fixed.**
   - Removed `if: ${{ vars.NEON_PROJECT_ID != '' }}` and the R2 env-check exit-0 path. The workflow now requires `NEON_PROJECT_ID`, `R2_ACCOUNT_ID`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `R2_BACKUPS_BUCKET` and fails loudly when any are missing.

2. **`.env.example` placeholder secrets.** ✅ **Fixed.**
   - Removed all placeholder values (`replace-me-with-openssl-rand-hex-32`, blanks) for `DEVICE_HASH_SALT`, `DEVICE_EVENT_SECRET`, `WS_CONNECT_SECRET`, `ADMIN_API_KEY`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `DATABASE_URL`, `DIRECT_URL`. Added `ADMIN_API_KEY` placeholder slot. Production must set via `flyctl secrets set ...` (see §10 checklist) — there is no fallback.

3. **Mobile build secrets must match backend.** Operational requirement, not a code change. `DEVICE_EVENT_SECRET` and `WS_CONNECT_SECRET` are HMAC keys signed by mobile, verified by backend. Mismatched keys → all events 401. Confirm both apps are built from the same secret values before flipping the launch switch.

4. **`predict-all-lots` and `retrain-models` legacy backlog items.** ✅ **Fixed.** Verified: there is no in-backend `predict-all-lots` cron; instead, two separate jobs ([predict-short-term.job.ts](../apps/backend/src/scheduler/jobs/predict-short-term.job.ts) and [predict-long-term.job.ts](../apps/backend/src/scheduler/jobs/predict-long-term.job.ts)) handle each horizon. The retrain side lives in GitHub Actions [.github/workflows/ml-retrain.yml](../.github/workflows/ml-retrain.yml). Both items are marked done/superseded in `TODO.md`.

### 🟡 MEDIUM — should fix before launch or shortly after

5. **Scrapers lack `User-Agent`, fetch timeout, retry/backoff.** ~~Add `User-Agent`...~~ **Fixed:** new shared helper [`apps/backend/src/common/http/fetch-json.ts`](../apps/backend/src/common/http/fetch-json.ts) wraps every outbound scraper request with a descriptive `User-Agent` (env-overridable via `WEATHER_USER_AGENT`), a per-attempt `AbortSignal.timeout(20s)`, and exponential-backoff retry (3 attempts; 500ms→1s→2s) on 408/425/429/5xx and network/timeout errors. Wired into both [events-scraper.service.ts](../apps/backend/src/events/events-scraper.service.ts) and [sports-events-scraper.service.ts](../apps/backend/src/events/sports-events-scraper.service.ts).

6. **No drift detection / prediction-vs-actual job.** ~~Add a daily job...~~ **Fixed:** new [`prediction-accuracy.job.ts`](../apps/backend/src/scheduler/jobs/prediction-accuracy.job.ts) runs at 05:15 PT daily. Joins yesterday's `prediction_short_term` against the matching `occupancy_snapshots` (within ±8 min of `target_time`), computes per-lot MAE / RMSE / coverage / 80%-interval-hit-rate, and emits a structured `Sentry.captureMessage` (level=info, tag=`cron:prediction-accuracy`, extra=`per_lot[...]`) so ops can alert when MAE crosses a threshold.

7. **EWMA semester transition lag.** Optional improvement: store EWMA state per (lot, dow_bucket, hour, semester_category) so that fall data does not blend with summer history. Requires migration + recompute script change. Acceptable to defer until v2.

8. **`ConsensusObservation` retention.** ~~Either add a prune cron at 180 days...~~ **Fixed:** new [`prune-consensus-observations.job.ts`](../apps/backend/src/scheduler/jobs/prune-consensus-observations.job.ts) runs Mondays at 06:00 PT, deletes rows older than `CONSENSUS_OBSERVATION_RETENTION_DAYS` (default 180d — matches contributor-pings). EWMA recompute only consumes the trailing ≈14 days, so this does not affect downstream consumers.

9. **README "18 jobs" claim is stale.** ~~Repo has 27 registered crons~~ **Fixed:** all README / runbook counts updated to 29 (2 new jobs added below).

### 🟢 LOW — track post-launch

10. ML hyperparameters hardcoded (n_estimators=200, max_depth=6, lr=0.1). Optuna sweep deferred until ≥6 months of real data.
11. Weather "commute hour" windows (7–9, 16–18) are hand-picked. Calibrate against arrival/departure logs once available.
12. `predict_short_term.py` baseline boto3 test failures (6 reported pre-existing). Confirm root cause: missing ML R2 credentials in the test environment. Add `pytest -m "not r2"` to CI default and a separate gated job that runs R2 tests only when `ML_R2_ACCESS_KEY_ID` is present (not as a graceful skip — as a separate matrix entry).
13. No automated rollback for ML model promotion. Manual via `--run-id`.
14. Cross-semester baseline lookup for long-term model (planned in `Model_Design.md`).

---

## 4. Production-readiness scorecard

| Dimension | Score | Notes |
|---|---|---|
| **Correctness** | 9/10 | Penetration math sound, retention matches docs, ML pipeline logically consistent. Minor: ConsensusObservation retention undocumented. |
| **Security** | 7/10 | HMAC events, salted device hashes, Azure SSO, advisory locks. ⚠️ Placeholder secrets in `.env.example` must be replaced. ⚠️ ADMIN_API_KEY must be ≥32 chars. ⚠️ No `helmet` middleware audit performed in this pass. |
| **Reliability** | 8/10 | Health checks, advisory locks, restart policies, daily backups + weekly verify, Sentry crons. ⚠️ Scrapers lack timeouts/retries. ⚠️ Restore test currently gated. |
| **Efficiency** | 8/10 | Rolling 15-min batch ML, prediction upserts, R2 zero-egress, Neon pooled+direct split. Cron VM at 1GB to absorb Python spikes. |
| **Observability** | 8/10 | Sentry traces (10% prod), Sentry crons for all 29 jobs, MLflow registry, admin status endpoints, daily prediction-vs-actual drift cron emitting per-lot MAE / coverage / interval-hit-rate to Sentry. |
| **Documentation** | 6/10 | Detailed `Model_Design.md`, runbooks present. ⚠️ README cron count stale. ⚠️ Retention table needs central source-of-truth doc (this audit becomes that). |

---

## 5. Backend file-by-file (reference)

See [SYSTEM_OVERVIEW.md §3](SYSTEM_OVERVIEW.md#3-backend-apps-backend) for the per-file walkthrough. Highlights:

- `src/lots/penetration-estimation.service.ts` — three-layer penetration estimator + scaling caps.
- `src/lots/academic-calendar.ts` — rule-based CSULB calendar (paired with `services/ml/src/academic_calendar.py`).
- `src/reliability/reliability.service.ts` — six-factor weighted reliability score.
- `src/occupancy-events/occupancy-events.service.ts` — atomic enter/exit, snapshot generation, consensus windows.
- `src/scheduler/jobs/*.ts` — 29 cron jobs (table in §6).
- `src/scheduler/cron-runner.service.ts` + `advisory-lock.ts` — multi-instance-safe job runner.
- `src/events/*.ts` — CampusLabs + Sidearm scrapers + `getEventsForLot`.
- `src/health/health.controller.ts` — `/health/live`, `/health/ready`.
- `src/auth/*.ts` — Azure JWT validation, contributor service.

---

## 6. Cron job inventory (29 jobs)

| Schedule (PT) | Job | Purpose | Retention impact |
|---|---|---|---|
| `*/15 * * * *` | snapshot | OccupancySnapshot + ConsensusObservation | None (writes permanent rows) |
| `*/15 * * * *` | notify-favorites-filling/clearing, notify-surge, notify-events | FCM pushes | Writes NotificationLog (90d) |
| `*/30 * * * *` | fetch-weather | NWS current obs → Weather (permanent) | None |
| `*/30 * * * *` | refresh-sports-finals | Update SCHEDULED→FINAL | None |
| `5,20,35,50 * * * *` | predict-short-term | Spawns ML; upserts PredictionShortTerm | Self-overwriting |
| `0 */6 * * *` | fetch-weather-forecast | NWS 7d hourly → WeatherForecast (self-pruned) | Self-pruning |
| `0 0 * * *` | fetch-transit | Shuttle data | None |
| `5 1 * * *` | predict-long-term | Spawns ML; upserts PredictionLongTerm | Self-overwriting |
| `0 2 * * *` | backup-db | pg_dump → R2 (35d via R2 lifecycle) | External |
| `30 2 * * *` | recompute-penetration-rates | EWMA update (idempotent only across days) | Updates PenetrationRateEstimate |
| `0 3 * * *` | cleanup-device-states | Stale ENTER >18h | Deletes from DeviceState |
| `0 4 * * 0,2-6` | prune-old-data | Daily except Sunday | Deletes occupancy_events (30d) |
| `15 4 * * *` | prune-notification-logs | Daily | Deletes NotificationLog (90d) |
| `0 4 * * 1` | verify-latest-backup | Mondays | None |
| `30 4 * * 1` | prune-old-events | Mondays | Deletes CampusEvent (90d) |
| `45 4 * * 0` | prune-old-report-messages | Sundays | Redacts reports.message (90d) |
| `0 5 * * *` | fetch-events | CampusLabs scrape | Writes CampusEvent |
| `30 5 * * *` | fetch-sports-events | Sidearm scrape | Writes CampusEvent |
| `30 5 * * 1` | prune-contributor-pings | Mondays | Deletes ContributorPing (180d idle) |
| `0 2 * * 6` | ingest-room-capacities | Saturdays | Upserts RoomCapacity |
| `30 2 * * 6` | build-proximity-matrix | Saturdays | Upserts LotBuildingProximity |
| `0 3 * * 0` | ingest-csulb-catalog | Sundays | Upserts CourseMeeting |
| `0 6 * * 0` | refresh-lot-advisories | Sundays | Upserts LotAdvisory |
| `0 7 1 * *` | refresh-lot-metadata | Monthly | Audit-only |
| `0 6 * * 1` | prune-consensus-observations | Mondays | Deletes ConsensusObservation (180d) |
| `15 5 * * *` | prediction-accuracy | Daily | Emits per-lot MAE/RMSE/coverage/interval-hit to Sentry |

All 29 jobs:
- registered in `cron-monitors.ts` (Sentry check-in heartbeats),
- guarded by Postgres advisory locks (multi-Machine safe on Fly rolling deploy),
- run in `America/Los_Angeles` timezone via `node dist/scheduler-main.js` (`cron` Fly process group, 1GB VM).

---

## 7. Required API keys, secrets, environment variables

See [SYSTEM_OVERVIEW.md §6](SYSTEM_OVERVIEW.md#6-environment-variables-and-secrets) for the full table. Quick map:

**Backend (Fly secrets):** `DATABASE_URL`, `DIRECT_URL`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `DEVICE_HASH_SALT`, `DEVICE_EVENT_SECRET`, `WS_CONNECT_SECRET`, `ADMIN_API_KEY`, `SENTRY_DSN`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `R2_ACCOUNT_ID`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `R2_BACKUPS_BUCKET`, `ML_R2_ACCESS_KEY_ID`, `ML_R2_SECRET_ACCESS_KEY`, `MLFLOW_TRACKING_URI`, `MLFLOW_ARTIFACT_LOCATION`, `R2_ENDPOINT_URL`.

**ML pipeline (GitHub Actions secrets):** `NEON_DATABASE_URL`, `ML_DATABASE_URL` (optional read replica), `MLFLOW_TRACKING_URI`, `MLFLOW_ARTIFACT_LOCATION`, `R2_ENDPOINT_URL`, `ML_R2_ACCESS_KEY_ID`, `ML_R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

**Deploy + CI (GitHub Actions secrets):** `FLY_API_TOKEN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `NEON_API_KEY`, `NEON_PROJECT_ID` (var), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CODECOV_TOKEN` (optional).

**Mobile (build-time `.env`):** `SHARKPARK_API_URL`, `DEVICE_EVENT_SECRET` (must match backend), `WS_CONNECT_SECRET` (must match backend), `SENTRY_DSN_MOBILE`.

---

## 8. Confirmation: tested / reviewed status

| Component | Tested? | Source of evidence |
|---|---|---|
| Penetration estimator | ✅ Unit-tested (53 tests in `penetration-estimation.service.spec.ts`) | Backend Jest |
| Reliability scoring | ✅ Unit-tested (`reliability.service.spec.ts`) | Backend Jest |
| Cron jobs | ✅ Each has integration-style spec | Backend Jest |
| Sports scraper | ✅ Heavily tested with real JSON fixtures | `sports-events-scraper.service.spec.ts` |
| CampusLabs scraper | ⚠️ Service-level only; no unit tests for parser | Gap |
| ML training | ✅ 75–80 pytest in `services/ml/tests/` | pytest |
| Weather adjustment / postprocess | ✅ 25+ pytest covering severity, ordering, invariants | pytest |
| Mobile long-term forecast | ✅ 26 jest tests pass (4 added this session) | mobile jest |
| Backend long-term predictions parity | ✅ 287 backend src/lots tests pass (1 added this session) | Backend Jest |
| Restore drill | ❌ Currently gated by `if: vars.NEON_PROJECT_ID != ''` | **Must un-gate before launch.** |
| Deploy pipeline | ✅ `deploy.yml` Sentry release + sourcemap upload required (no graceful skip) | `.github/workflows/deploy.yml` |
| Backup / verify | ✅ Daily backup + weekly verify, both monitored | scheduler |

---

## 9. Pasted user-supplied TODO — verification

The user's previous TODO list contained these items relevant to this audit. Verified against current repo state:

| Item | Status |
|---|---|
| Long-term weather forecast pipeline (NWS → ML adjustment → backend bundle → mobile UI) | ✅ Done (this session) |
| `predict-short-term` cron | ✅ Shipped (`predict-short-term.job.ts`) |
| `predict-long-term` cron | ✅ Shipped (`predict-long-term.job.ts`) |
| `predict-all-lots` combined cron | ❌ **Not shipped — superseded** by the two-job split. Mark TODO done. |
| `retrain-models.ts` weekly cron | ❌ **Not shipped — superseded** by GitHub Actions `ml-retrain.yml`. Mark TODO done. |
| MLflow → R2 export (PR #151 lineage) | ✅ Implemented in `services/ml/src/utils/mlflow_utils.py` |
| Cloudflare R2 boto3 client | ✅ Implemented |
| `prune-old-data` 30d retention | ✅ Live |
| `recompute-penetration-rates` daily | ✅ Live (02:30 PT) |
| `build-proximity-matrix` weekly | ✅ Live (Sat 02:30 PT) |
| `ingest-csulb-catalog` weekly | ✅ Live (Sun 03:00 PT) |
| `ingest-room-capacities` weekly | ✅ Live (Sat 02:00 PT) |
| `refresh-lot-advisories` weekly | ✅ Live (Sun 06:00 PT) |
| `nearby-events` endpoint | ✅ Live in lots controller |
| Sports finals refresh every 30 min | ✅ Live |
| Drift monitoring | ✅ Live (`prediction-accuracy.job.ts`, daily 05:15 PT) |
| Live prediction-vs-actual feedback loop | ✅ Live (`prediction-accuracy.job.ts`, per-lot MAE/RMSE/coverage to Sentry) |

---

## 10. Deployment checklist

Run through this in order before flipping the launch switch.

### 10.1 Repository hygiene

- [x] Update `README.md` — README, infrastructure/README.md, apps/backend/README.md, docs/SYSTEM_OVERVIEW.md, docs/runbooks/runbook.md all updated to "29 jobs". Cross-references this audit doc.
- [x] Update `TODO.md` — `predict-all-lots` and `retrain-models` items marked done/superseded with links to `predict-short-term.job.ts`, `predict-long-term.job.ts`, and `.github/workflows/ml-retrain.yml`. Drift-monitoring item marked done with link to `prediction-accuracy.job.ts`.
- [x] Remove graceful-skip gates from `.github/workflows/restore-test.yml` (see §3 HIGH-1).

### 10.2 Secrets generation

```bash
# Generate the four 32-byte hex secrets.
DEVICE_HASH_SALT=$(openssl rand -hex 32)
DEVICE_EVENT_SECRET=$(openssl rand -hex 32)
WS_CONNECT_SECRET=$(openssl rand -hex 32)
ADMIN_API_KEY=$(openssl rand -hex 32)

# Save these somewhere safe (1Password / Bitwarden / Vault).
echo "DEVICE_HASH_SALT=$DEVICE_HASH_SALT"
echo "DEVICE_EVENT_SECRET=$DEVICE_EVENT_SECRET"
echo "WS_CONNECT_SECRET=$WS_CONNECT_SECRET"
echo "ADMIN_API_KEY=$ADMIN_API_KEY"
```

The mobile build (`apps/mobile/.env`) must use the **same** `DEVICE_EVENT_SECRET` and `WS_CONNECT_SECRET` values.

### 10.3 Fly.io secrets

```bash
cd apps/backend
flyctl secrets set \
  DATABASE_URL="postgresql://...neon-pooler.us-west-2.neon.tech/sharkpark?pgbouncer=true&connection_limit=1" \
  DIRECT_URL="postgresql://...neon.us-west-2.neon.tech/sharkpark" \
  AZURE_CLIENT_ID="..." \
  AZURE_TENANT_ID="..." \
  DEVICE_HASH_SALT="$DEVICE_HASH_SALT" \
  DEVICE_EVENT_SECRET="$DEVICE_EVENT_SECRET" \
  WS_CONNECT_SECRET="$WS_CONNECT_SECRET" \
  ADMIN_API_KEY="$ADMIN_API_KEY" \
  SENTRY_DSN="https://...@sentry.io/..." \
  SENTRY_ENVIRONMENT="production" \
  FIREBASE_PROJECT_ID="..." \
  FIREBASE_CLIENT_EMAIL="..." \
  FIREBASE_PRIVATE_KEY="..." \
  R2_ACCOUNT_ID="..." \
  BACKUP_R2_ACCESS_KEY_ID="..." \
  BACKUP_R2_SECRET_ACCESS_KEY="..." \
  R2_BACKUPS_BUCKET="sharkpark-backups" \
  R2_ENDPOINT_URL="https://<account-id>.r2.cloudflarestorage.com" \
  ML_R2_ACCESS_KEY_ID="..." \
  ML_R2_SECRET_ACCESS_KEY="..." \
  MLFLOW_TRACKING_URI="postgresql+psycopg2://..." \
  MLFLOW_ARTIFACT_LOCATION="s3://sharkpark-ml-exports/mlflow-artifacts" \
  WEATHER_USER_AGENT="SharkPark/1.0 (ops@sharkpark.app)" \
  CORS_ORIGINS="https://sharkpark.app,https://www.sharkpark.app"
```

Verify: `flyctl secrets list`. There should be no `replace-me-*` placeholders.

### 10.4 GitHub Actions secrets

Required (deploy will fail without these — that is intentional):

`FLY_API_TOKEN`, `NEON_DATABASE_URL`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `NEON_API_KEY` + `NEON_PROJECT_ID` (var), `R2_ACCOUNT_ID`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `R2_BACKUPS_BUCKET`, `R2_ENDPOINT_URL`, `R2_BUCKET`, `ML_R2_ACCESS_KEY_ID`, `ML_R2_SECRET_ACCESS_KEY`, `MLFLOW_TRACKING_URI`, `MLFLOW_ARTIFACT_LOCATION`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

Optional: `CODECOV_TOKEN`, `ML_DATABASE_URL`.

### 10.5 Database

- [ ] Confirm Neon project provisioned in `us-west-2` (matches Fly `lax` region).
- [ ] Run `pnpm --filter @sharkpark/backend db:deploy` against production.
- [ ] Run `pnpm --filter @sharkpark/backend db:seed:prod` (idempotent — safe to re-run).
- [ ] Confirm PG version 17 on both Neon and the Fly image's `postgresql-client-17` (required for `pg_dump` compatibility).

### 10.6 Object storage

- [ ] Create R2 buckets: `sharkpark-backups` (35-day lifecycle policy), `sharkpark-ml-exports` (no lifecycle).
- [ ] Create R2 API token scoped to both buckets, rotate access keys.

### 10.7 Smoke tests

```bash
# Backend health.
curl -fsSL https://api.sharkpark.app/api/v1/health/live
curl -fsSL https://api.sharkpark.app/api/v1/health/ready

# Verify both Fly process groups are running.
flyctl machine list -j --config apps/backend/fly.toml \
  | jq '.[] | {id, state, group: .config.metadata.fly_process_group}'

# Tail logs for cron startup.
flyctl logs --config apps/backend/fly.toml --process-group cron | head -100

# Confirm Sentry release was created.
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/organizations/$SENTRY_ORG/releases/sharkpark-backend@$(git rev-parse --short HEAD)/"
```

### 10.8 Run the test gate

```bash
pnpm typecheck         # 5/5 packages
pnpm lint              # workspace
pnpm test              # backend + mobile
( cd services/ml && uv run pytest -q )  # ML tests
```

### 10.9 First-day monitoring

- [ ] Watch Sentry for the first 4 hours after launch (errors, crashes, cron failures).
- [ ] Inspect first 4 cron runs of each high-frequency job (`snapshot`, `predict-short-term`, `notify-*`, `fetch-weather`).
- [ ] Confirm a backup completes and `verify-latest-backup` (next Monday) passes.
- [ ] Confirm at least one `recompute-penetration-rates` run logs the expected `penetration_rate_estimates` upserts.
- [ ] Confirm `predict-short-term` job's `model_version` field in `ml_cron_runs` matches the current `@production` MLflow alias.

### 10.10 Rollback plan

- Frontend (mobile): rely on App Store / Play Store rollback; the backend's `MIN_SUPPORTED_APP_VERSION` env can force a forced upgrade if a critical mobile bug ships.
- Backend: `flyctl releases list --config apps/backend/fly.toml` then `flyctl releases rollback <version>`.
- ML model: `cd services/ml && uv run python -m scripts.promote_short_term --run-id <previous-run-id>` to re-point `@production` alias.
- Database: Neon point-in-time-recovery up to 7 days; restore via `restore-test.yml` workflow (after un-gating) or manual `pg_restore` from R2 backup.

---

## 11. Open questions for the owner

1. Is `REDIS_URL` planned for v1, or is single-Machine session affinity (sticky cookies) acceptable until v2?
2. Should `ConsensusObservation` be pruned at 180 days, or is unbounded growth acceptable for now? (Volume estimate: ~5-min buckets × 28 lots × 365 days ≈ 2.9M rows/year — acceptable for Neon at current scale.)
3. Is the `WEATHER_USER_AGENT` contact email (`ops@sharkpark.app`) deliverable? NWS may reach out about misuse.
4. Confirm Firebase service-account JSON has been generated and the three `FIREBASE_*` env vars match. Push notifications are a soft-fail today.

---

*End of audit. See [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) for the architectural walkthrough.*
