# SharkPark — Active TODOs

Living checklist of work remaining to App Store / Play Store submission and the
first few weeks post-launch. Sectioned by owner.

> Historical PR ledger (PRs #82–#180+) was removed 2026-05-15 during a doc
> cleanup pass; consult `git log` or GitHub for shipped-PR provenance.

---

## App Store submission sequence

1. **Step 6 — Build upload.** Xcode → Archive → Distribute → App Store Connect.
   Blocked on Lawrence's QA pass.
2. **Step 7 — Submit for review.**

Steps 0–5 (email migration, marketing scaffold, Cloudflare Workers Static
Assets project, DNS, App Store Connect listing) are complete.

---

## Pre-launch credentials & signing

- **Charles — `BG_GEOLOCATION_LICENSE` in CI/CD** — Transistor Software's
  `react-native-background-geolocation` license key. Without it the SDK runs in
  trial mode and stops working after a few hours in production builds. Set as a
  GitHub Actions secret and inject into `Info.plist` /
  `AndroidManifest.xml` at build time. Key lives in 1Password.
- **Charles — Swap Play Console deployment-key SHA-256 into in-repo
  assetlinks template** — `apps/mobile/docs/assetlinks.json` still carries
  `REPLACE_WITH_PLAY_CONSOLE_SIGNING_KEY_SHA256`. After Play App Signing is
  enrolled, pull Google's deployment-key fingerprint from Play Console and
  swap it in here too. (The live `apps/marketing/public/.well-known/assetlinks.json`
  already uses the upload-key fingerprint as a stopgap.) See
  `apps/mobile/docs/android-app-links.md` §3.

---

## Lawrence — Mobile

**Pre-launch**
- **Push notification handling — mobile side.** Install
  `@react-native-firebase/app` + `@react-native-firebase/messaging`, request
  permission, fetch FCM token, `POST /users/me/push-token` with
  `{ token, platform: 'ios' | 'android' }`, re-register on `onTokenRefresh`.
  Foreground + background handlers; deep-link taps into the right screen
  (favorites notification → map centered on lot; event notification →
  forecast for affected lot). Backend already deployed.
- **Force-update screen review/merge.**
- **Resolve TODO in `apps/mobile/src/screens/LongTermForecastScreen.tsx#L84`** —
  `selectedDayIndex` is in the `useMemo` deps but never passed to
  `generateForecast`, so every day shows the same generic curve.
- **Gate stray `console.log` calls behind `__DEV__`** — remaining offenders
  (audit 2026-05-04):
  - `apps/mobile/src/services/locationService.ts` lines 83, 103, 116, 131,
    146, 165, 531, 593, 609, 612 — SDK init / geofence / mode-switch /
    provider-change diagnostics.
  - `apps/mobile/src/hooks/useTransitData.ts` lines 53, 57 — socket
    connect/disconnect logs.
  - `apps/mobile/src/auth/AzureAuth.tsx#L31` — internal `log()` helper that
    always fires.
- **Add `NSPhotoLibraryUsageDescription` to `Info.plist`** *only if* any
  feature actually touches photos. Apple rejects unused permission strings.
- **Pick + integrate analytics SDK** — Amplitude / Mixpanel / PostHog. Track:
  `app_open`, `lot_view`, `favorite_added`, `report_submitted`,
  `forecast_view`. Do not track location or device-identifying data.
- **Service test coverage** — remaining untested mobile services:
  `locationService`, `leaveDetectionService`, `parkingValidationService`,
  `sdkConfig`, `headlessTask`, `modeSwitch`, `activityRecognition`, plus API
  clients (`lots`, `reliability`, `favorites`, `deviceCredentials`). Aim for
  60% coverage floor on `services/`; prioritize `deviceCredentials` (HMAC
  signing has a pinned test vector but no integration test against the real
  `apiService`).
- **App Store submission.** Screenshots (6.7" + 6.5"), privacy nutrition
  labels (see `docs/privacy-data-inventory.md`), TestFlight build for review,
  reviewer follow-ups. Allow 1–2 weeks per review cycle.
- **Google Play submission.** Play Console listing, screenshots
  (phone + 7"/10" tablet), data safety form (mirror App Store labels),
  internal testing track → closed → open beta → production.
- **Final QA pass** — real iOS + Android devices in the week before submit.

**Post-launch / non-blocking**
- **Nearby-events badge.** Wire `GET /api/v1/lots/:id/nearby-events?within_hours=2`
  into lot detail ("3 events nearby — occupancy may be affected"); tap-through
  reveals event names + start times. No prediction-pipeline coupling.
- **Nearby-events local notification (~1 hr).** When a favorited lot has ≥2
  events starting within the next 2 hours, fire a local notification.
  Throttle to once per lot per day.

---

## Zach — Backend

**Pre-launch (review queue)**
- `GET /api/v1/min-version` — unblocks Lawrence's force-update screen.
- Analytics endpoints — `GET /api/v1/lots/:id/trends`,
  `GET /api/v1/lots/utilization`.
- GDPR/CCPA data export — `GET /api/v1/users/me/data`.
- Tier throttling + `/me/forecast` + reliability scoring.

**Polish**
- **Scrub stale doc-comment in
  `apps/mobile/src/services/parkingValidationService.ts` line 7** — references a
  `@sharkpark/parking-validation` package that no longer exists.

**Post-launch**
- **Admin dashboard.** Either a separate Next.js app under `apps/admin/` or
  admin-scoped routes mounted at `/admin/*` with a JWT role check. Pages:
  lot CRUD, report review queue (acknowledge/dismiss), reliability score
  overrides. ~1 week of work.

---

## Ly — ML

**Pre-launch (review queue)**
- MLflow → R2 export. Real upload via `boto3` against R2's S3-compatible
  endpoint; `promote_short_term.py` + `promote_long_term.py` wired in.
  Unblocks the predict crons (so R2 has artifacts on first run).

**Long-term weather features (follow-ups to the NWS migration)**
- Extend `services/ml/src/postprocess/weather_adjustment.py` to accept a
  `WeatherForecast` row keyed by `target_time`. Wire into `predict_long_term.py`.
- `_SEVERE_KEYWORDS` in `weather_adjustment.py` matches bare `"thunderstorm"`,
  which over-corrects on NWS low-probability strings like
  *"Slight Chance Showers And Thunderstorms"* (50% median reduction triggered on
  a 20% forecast). Gate severity on `precipitation_probability` or scope the
  keyword to phrases like `"thunderstorms likely"` / `"severe thunderstorm"`.
- The `weather` table is retained permanently for future ML features. Schema
  currently stores `temperature_f`, `condition`, `precipitation_probability`,
  `feels_like_f`, `is_raining`, `timestamp`, `school_id`. Revisit column width
  (wind, humidity, pressure, cloud cover) when wiring weather into training.

**Post-launch**
- Track long-term live MAE so we can tell whether the forecast feature
  actually helps or just stacks two error bands. Folds into the existing
  model-drift monitoring.
- Revisit the rule-based weather adjustment layer with real data — either
  replace with learned features in `train.py`, or calibrate magnitudes/signs
  from live MAE feedback.

---

## Charles — Platform / Infra

**Pre-launch**
- **R2 access-key rotation hygiene sweep.** Not known to be leaked, but
  rotate to give every prod credential a known post-launch birthdate. Mint
  new R2 keys in Cloudflare → update GH Actions
  (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) + Fly
  (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
- **Sentry per-transaction p95 alerts on `/lots` and `/users/me/forecast`** —
  the project-wide `p95 > 800ms` rule is dominated by high-traffic `/lots`,
  so a regression on the lower-traffic `/users/me/forecast` can double in
  latency without tripping. Add two transaction-scoped Performance alerts
  (suggest 600ms for `/lots`, 1200ms for `/users/me/forecast` since it does
  an XGBoost inference round-trip). UI-only.
- **Native sourcemap upload step in mobile build workflow** — needed before
  production stack traces are readable. ~30 min once we have an
  EAS/Fastlane build pipeline.

**Post-launch**
- **Document `FLY_API_TOKEN` rotation cadence in runbook.** Long-lived
  deploy token instead of Fly OIDC (still in beta). Add quarterly rotation
  reminder + `flyctl tokens create deploy --expiry 720h` to
  `docs/runbooks/runbook.md`.
- **Evaluate consolidating uptime onto Sentry Uptime Monitoring.** Not worth
  the migration cost while Better Stack hosts the public status page.
  Revisit if Better Stack starts charging or status page is killed.
- **k6 load tests.** Sustained 600 req/min on `/lots` (matches Cloudflare
  rate-limit cap) + 5-min spike to 2000 req/min. Verifies single Fly
  instance survives, validates throttler buckets, surfaces Neon
  connection-pool ceilings.

---

## Access-tier follow-ups

**Backend**
- Confirm `/weather/current` and `/events/*` are actually `@Public` in code
  (not accidentally guarded).
- Add 8 missing endpoints to the `docs/api-access-tiers.md` spec table (all
  currently `@Public`): `/events/upcoming`, `/weather/impact`,
  `/reliability/lots/:lotId`, `/reliability/lots`, `/reliability/config`,
  `/occupancy-events/lots/:lotId/stats`, `/occupancy-events/snapshots/:lotId`,
  `/health/live`, `/health/ready`.
- **`UserType` column fate** — delete (preferred — less PII, fewer App Store
  privacy questions, ~1 hr migration) or document as metadata-only with no
  enforcement. Currently populated, returned in API responses, read for zero
  decisions.

**Mobile guest-mode hardening**
- API interceptor should distinguish `401` vs `403 BG_LOCATION_REQUIRED`
  (different UX: sign-in vs background-location soft-ask).
- Favorites / Profile / Settings: show "Sign in to use" CTA for guests
  instead of 401 toast spam.
- ReportModal in guest mode: hide submit or route guests to sign-in.
- FilterModal employee-lot section: neutral labeling for guests/students.

**Backend test coverage**
- `ACCESS-3` e2e — full guest happy path: Public works with no headers,
  Contributor returns 403 `BG_LOCATION_REQUIRED`, Authenticated returns 401.
- `ACCESS-4` e2e — guest enrolls via `POST /occupancy-events`, then
  Contributor endpoints succeed within `CONTRIBUTOR_PING_TTL_MS`.

**Post-launch rename**
- Rename `LotType` `STUDENT`/`EMPLOYEE` → `LotCategory` to remove the naming
  collision with `UserType`. Pure rename + migration.
