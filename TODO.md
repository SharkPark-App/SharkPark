# SharkPark — Pre-Launch TODO

*Last updated 2026-05-04 (post-merge through #177 + direct-to-branch work on `refactor/nest-scheduler`: supercronic → NestJS scheduler refactor `c8e1fca`, sports-scraper polish + bulk events-summary endpoint cluster, mobile lot-detail/map/forecast polish, reliability-score absent-reports fix `83cff61`. PR #180 packages most of the events cluster for review.). This document tracks remaining work to App Store / Play Store submission. For day-to-day status, sections are organized per-owner with priority tiers.*

---

# ✅ Recently shipped (since 2026-04-28)

**Backend / infra (Charles):**
- Direct commit `c8e1fca` (2026-05-04, branch `refactor/nest-scheduler`) — **Supercronic → single NestJS scheduler process.** Replaces the per-script `node dist/scripts/*.js` supercronic pattern with one long-running `scheduler-main.ts` that registers every `@Cron(...)` job in-process via `ScheduleModule`. Eliminates the per-tick Nest bootstrap that was OOM-cascading the cron VM, so `apps/backend/fly.toml` cron VM is sized **back down to 512 MB** (NOT 2 GB as PR #176 had set it — that bump is now obsolete). Python ML scripts still spawn as child processes, so xgboost/pandas memory lives outside the VM.
- Direct commits on `refactor/nest-scheduler` (2026-05-04, packaged as **PR #180** for review) — **Events/sports cluster.** Bulk `GET /events/summary` endpoint with in-flight coalescer + split poll cadences, map event badges, sports-scraper anchored to school timezone, doubleheader dedupe, real Sidearm fields with 30-min FINAL refresh + 2-min live cron, EventBanner time-range formatting, mobile lot-detail/map/FAB polish, smooth occupancy gradient + trend-aware forecast label, covered/open-air amenity chip always shown.
- Direct commit `83cff61` (2026-05-04) — **Reliability fix:** treat absent user reports as neutral (not perfect). Follow-up to PR #146 — was inflating scores for lots no one had reported on.
- PR #176 — **Stability cluster.** Originally bumped cron VM 1 GB → 2 GB (was OOM-killing the predict + retrain crons) — **superseded by `c8e1fca` scheduler refactor**, cron VM is now 512 MB. The other fixes still stand: raised health-check `grace_period` to cover cold-start XGBoost model load, dropped pg connect timeout from 30s → 10s so health checks fail fast on a wedged pool, made pool teardown idempotent (was double-closing on SIGTERM during deploys), and silenced 4xx scanner noise in Sentry (`/wp-login.php`, `/.env`, etc. were drowning real errors).
- PR #177 — **`min_machines_running = 1` for the app process group.** Was scaling to zero between requests; first request after idle was eating a 6-8s cold start. Keeps one warm machine 24/7 (~$2/mo extra). The cron Machine was already always-on; this only affects the public-facing app process.
- PR #173 — **Weather: NWS migration + long-term forecast cron + retention.** Replaced OWM with keyless `api.weather.gov`; new `WeatherForecast` model + `0 */6 * * *` long-term cron; weather rows kept permanently for future ML features (PR #173 dropped them from `prune-old-data`). Fixes the silently-zero `precipitation_probability` bug from OWM.
- PR #118 — Mobile Sentry init (JS-side) wired through `react-native-dotenv`
- PR #122 — Better Stack heartbeat pings on cron success across all 6 cron jobs *(superseded by #144 — see below)*
- PR #123 — Mobile/backend access-tier alignment (`x-device-id`, HMAC-signed `POST /occupancy-events`, hardened `@student.csulb.edu` check, dropped legacy `UNKNOWN` user-type throw)
- PR #137 — Removed `EventImpact` forecasting layer entirely (dead code path, never wired into predict pipeline)
- PR #138 — Repo bootstrap script (`scripts/bootstrap.sh`) + fix `daily_rate` Decimal → number serialization in `/lots` payload
- PR #142 — CI: drop `restore-keys` prefix on Pods cache (was pulling stale Podfile.lock and breaking iOS builds)
- PR #144 — **Migrate cron monitoring from Better Stack heartbeats to Sentry Crons.** All 7 backend crons (snapshot, fetch-weather, fetch-transit, cleanup-device-states, backup-db, verify-latest-backup, prune-old-data) now check in to Sentry. `_heartbeat.ts` deleted, `_cron-monitors.ts` registry added with crontab-drift unit test. `BETTERSTACK_HEARTBEAT_*` Fly secrets unset, Better Stack heartbeat monitors deleted. Better Stack still owns `/health/ready` uptime probe + (future) status page.
- Access-tier audit closeout (rode in with PR #84 squash) — `ContributorGuard` on `GET /occupancy-events/lots/:lotId`, `/health` deduplicated, anonymous-`POST /reports` → 401 e2e assertion, mobile `BackgroundLocationRequiredError` class + interceptor

**ML (Ly):**
- PR #119 — Weather-aware short-term predictions (rule-based postprocess layer at `services/ml/src/postprocess/weather_adjustment.py`, with staleness gate)
- PR #146 — **Reports → reliability score loop.** Wires `Report` rows into the weighted reliability formula in `apps/backend/src/reliability/reliability.service.ts`. Anonymous device 0.3-0.6, authed user 1.0, repeat-flagged user 0. (All current reports are authed via NOT-NULL `user_id` — anonymous tier is for future expansion.)

**Backend (Zach):**
- PR #121 — `POST /api/v1/reports` endpoint (DTO `{ lotId, type, message? }`, throttled 5/min/user, 401 for guests)
- PR #152 — **Campus event scraper + lot metadata enrichment (concept3d).** `EventsScraperService` (179 lines) + Sidearm calendar LBSU sports scraper, weekly cron to prune past events. Replaces hand-traced geofences with concept3d polygons (Phase B), derives lot↔building proximity geometrically (Phase A), adds `is_structure` + EV reconciliation (Phase C), `LotAdvisory` model + concept3d construction extractor (Phase D), weekly cron to refresh advisories (Phase F). Adds short-term/low-emission/pay-station/motorcycle counts, building footprints + categories, lat/lng on all CSULB campus + athletic venues. **Unblocks Ly's nearby-events badge** (table is now populated).

**Mobile (Lawrence):**
- PR #82 — Env-based API URL (production points at `https://api.sharkpark.app/api/v1`)
- PR #83 — Permission downgrade alert + version bump to 1.0.0
- PR #84 — First-launch onboarding flow (4 slides), deep-linking client config (custom scheme + universal links), App Store readiness fixes (Info.plist purpose strings, AASA stub, Android App Links intent filter, `POST_NOTIFICATIONS` permission, release signing scaffold)
- PR #126 — Delete Account UI in ProfileScreen (App Store guideline 5.1.1(v))
- PR #127 — Guest Mode — "Continue without account" affordance (App Store guideline 2.1), with cancel-restores-guest follow-up
- PR #143 — Re-bump `react-native` to 0.85.2 + migrate to `@react-native/jest-preset` (re-application of #135 after rebase noise)
- Direct commit `c071caa` (2026-05-02) — **Android assetlinks hardening per PR feedback.** Drop debug-keystore SHA-256 from the in-repo template (anyone with the public debug.keystore could otherwise intercept deep-link taps), rename the placeholder to a deliberately-non-hex string so a CI regex check (`^[0-9A-F]{2}(:[0-9A-F]{2}){31}$`) fails loud instead of Android silently treating malformed entries as parse failures, document Play App Signing enrollment + which fingerprint actually matters (Google's deployment key, not the upload key), add the same regex check for the AASA TEAMID placeholder.

**Marketing (Charles):**
- Direct commit `7d1d358` (2026-05-03) — **Marketing copy/legal/a11y polish pass.** Hero h1 “Find a spot before you leave” cascades to title/og/twitter; rewrite features (Recommended lots / Events near campus / Live shuttle feed); CTA “No account needed”; Privacy §11 explicit no-cookies/no-trackers; **Terms §14 Apple App Store + Google Play EULA passthrough (App Store approval requirement)**; placeholder `appStoreUrl`/`playStoreUrl` (`#`) renders grayscale + “Coming soon” label instead of dead links; brand-500 → brand-700 on step pills + 404 to clear AA contrast — Lighthouse a11y 100/100 across all 6 pages.

**Apple / Play store blockers cleared by these merges:**
- 5.1.1(v) in-app account deletion (UI now wired to backend `DELETE /users/me`)
- 2.1 browse-without-account
- Onboarding + permission priming (no more iOS location sheet during slide 1)

---

# 🚀 App Store submission sequence (added 2026-05-02, updated 2026-05-03)

Ordered list of what's actively in flight to get SharkPark submitted. Don't reorder — each step unblocks the next.

**Step 0 — ✅ Email migrations done.** All 9 mailboxes migrated; Cloudflare Email Routing forwards to personal inbox.
- `ops@sharkpark.app` — Fly, Neon, Sentry, Better Stack, Prisma
- `security@sharkpark.app` — GitHub security advisories
- `billing@sharkpark.app` — Apple Developer + Google Play billing
- `support@sharkpark.app` — user-facing (App Store support URL, in-app email)
- `hello@sharkpark.app` — press / general inbound (used on marketing site)

**Step 1 — ✅ Marketing scaffold landed** (#161). Includes [`apps/marketing/`](apps/marketing/) + [`.github/workflows/deploy-marketing.yml`](.github/workflows/deploy-marketing.yml) + AASA/assetlinks with real Team ID `4K793ZW77F` and `app.sharkpark.mobile` bundle ID.

**Step 2 — ✅ Cloudflare Workers Static Assets project** (`sharkpark-marketing`) created, repo not connected (we deploy via GH Actions only — Cloudflare dashboard Git integration intentionally OFF to avoid double-deploys). `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set as GH secrets. *(Originally scoped as Cloudflare Pages; migrated to Workers Static Assets during the #166–#170 deploy cascade.)*

**Step 3 — ✅ DNS attached.** Apex `sharkpark.app` proxied to the Worker; `www` → apex 301 redirect rule. Verified `https://sharkpark.app/.well-known/apple-app-site-association` returns the AASA JSON.

**Step 4 — ✅ Marketing PR merged** (#161 + the #166–#172 follow-up cluster).

**Step 4b — Marketing site polish (post-launch, non-blocking)** — add hero phone-mockup video (`/hero-preview.{mp4,webm}` autoplay path is already wired in `BaseLayout.astro`), real app screenshots, and refresh `og-image.png` once the App Store screenshots are finalized. User flagged 2026-05-03: *"all we need to add is videos and images."* Discord embed cache (~30 days, per-URL) — share with `?v=1` if validating fresh OG previews before then.

**Step 5 — ✅ App Store Connect listing configured.** Privacy URL `https://sharkpark.app/privacy` pasted, App Privacy questionnaire completed (Email/Name/UserID/Location/DeviceID/CrashData/PerformanceData/ProductInteraction declared; Tracking = NO across the board), App Information set (Navigation primary / Utilities secondary, support URL `https://sharkpark.app/support`), Pricing = Free / all territories, App Review contact + demo Azure AD creds provided. Only Step 6 (build upload, blocked on Lawrence's QA pass) and Step 7 (submit) remain.

**Step 6 — Build upload** — Xcode → Archive → Distribute → App Store Connect (blocked on Lawrence's QA pass).

**Step 7 — Submit for review.**

---

# 🔴 Pre-launch credentials & signing — DO NOT FORGET

These four are all "the binary won't ship without them." Cheap individually, catastrophic if discovered the day of submission. Owners split between Charles (CI/CD secrets) and Lawrence (Xcode/Apple developer console).

- **Charles — `BG_GEOLOCATION_LICENSE` env var in CI/CD** — Transistor Software's `react-native-background-geolocation` license key. Without it the SDK runs in trial mode and **stops working after a few hours in production builds**. Set as a secret in GitHub Actions (`BG_GEOLOCATION_LICENSE`) and in whichever build service we use for archives (Xcode Cloud / EAS Build / Fastlane). Inject into `Info.plist` and `AndroidManifest.xml` at build time. License key lives in 1Password.
- ✅ ~~**Charles — Production Android keystore**~~ — *done.* Release keystore generated, backed up off-machine, signing secrets set in GH Actions; deployed `assetlinks.json` at https://sharkpark.app/.well-known/assetlinks.json carries the real release SHA-256 (`D5:25:81:E0:7E:06:7C:69:CB:42:4F:33:6A:78:F0:D5:2B:4C:F5:72:1F:62:5C:A9:0F:2E:26:DB:47:EA:40:79`). **Follow-up:** the in-repo template at [`apps/mobile/docs/assetlinks.json`](apps/mobile/docs/assetlinks.json) still carries `REPLACE_WITH_PLAY_CONSOLE_SIGNING_KEY_SHA256` — once Play App Signing is enrolled and Charles pulls Google's deployment-key fingerprint from Play Console, swap it in there too (the deployed copy already uses the upload-key fingerprint as a stopgap). Per [`apps/mobile/docs/android-app-links.md`](apps/mobile/docs/android-app-links.md) §3 the deployed file must ultimately use Google's deployment key, not the upload key.
- ✅ ~~**Lawrence — Replace `TEAMID` placeholder**~~ — *shipped in PR #140.* Real Team ID `4K793ZW77F` is now in [`apps/mobile/docs/apple-app-site-association.json`](apps/mobile/docs/apple-app-site-association.json) and the deployed copy at `apps/marketing/public/.well-known/apple-app-site-association` (live at https://sharkpark.app/.well-known/apple-app-site-association).
- ✅ ~~**Lawrence — Set `DEVELOPMENT_TEAM` in `mobile.xcodeproj`**~~ — *shipped in PR #140.* `DEVELOPMENT_TEAM = 4K793ZW77F` set on both Debug and Release configs in [`apps/mobile/ios/mobile.xcodeproj/project.pbxproj`](apps/mobile/ios/mobile.xcodeproj/project.pbxproj).

---

# ✅ ~~Long-term weather forecast — shipped~~

NWS migration + long-term forecast cron landed together. The OWM `/data/2.5/weather` endpoint never returned `pop`, so `precipitation_probability` had been silently 0 in production — the very check `weather.service.ts` line 66 (`> 0.6`) couldn't fire. NWS forecast `periods[0]` carries a real probability, so swapping vendors fixed the bug as a side effect.

**Shipped:**
- `apps/backend/src/weather/nws.client.ts` — keyless NWS client with 24h `/points` cache, forecast helpers (`parseWindSpeedMph`, `probabilityToRate`, `deriveIsRaining`, `computeFeelsLikeF`).
- `WeatherFetchService` rewritten to read NWS hourly forecast `periods[0]` (one endpoint = one failure domain, identical shape to the long-term cron).
- New `WeatherForecast` Prisma model + migration `20260503111924_add_weather_forecasts` (unique on `(school_id, target_time)`, cascade on school delete).
- New `WeatherForecastFetchService` + `apps/backend/src/scheduler/jobs/fetch-weather-forecast.job.ts` cron at `0 */6 * * *`. Opportunistically prunes past `target_time` rows on each run.
- Sentry Cron monitor entry added to `_cron-monitors.ts` (lockstep spec stays green).
- Config: `OPENWEATHER_API_KEY` removed; `WEATHER_USER_AGENT` added with sensible default. `.env.example`, runbook secrets table, `api-access-tiers.md`, and `configuration.spec.ts` updated.
- Specs: `nws.client.spec.ts` (helpers), `weather-fetch.service.spec.ts` (rewritten — no more global-fetch mock), `weather-forecast-fetch.service.spec.ts` (new). All 53 weather/config/cron tests pass.

**Follow-ups (separate tickets):**
- **Ly (ML)** — extend `services/ml/src/postprocess/weather_adjustment.py` to accept a `WeatherForecast` row keyed by `target_time`. Wire into `predict_long_term.py` once it lands.
- **Ly (ML)** — `_SEVERE_KEYWORDS` in `services/ml/src/postprocess/weather_adjustment.py` matches bare `"thunderstorm"`, which over-corrects on NWS low-probability strings like *"Slight Chance Showers And Thunderstorms"* (50% median reduction triggered on a 20% forecast). Gate severity on `precipitation_probability` (or scope keyword to phrases like `"thunderstorms likely"` / `"severe thunderstorm"`). Folding into the long-term-weather PR.
- **Ly (ML)** — `weather` table is now retained permanently (PR #173 dropped it from `prune-old-data`) for future model features. Current schema only stores `temperature_f`, `condition`, `precipitation_probability`, `feels_like_f`, `is_raining`, `timestamp`, `school_id`. Revisit column width (wind, humidity, pressure, cloud cover) when wiring weather features into training.
- **Track separately:** long-term live MAE so we can tell whether the forecast feature actually helps or just stacks two error bands. Folds into the existing model-drift monitoring item.
- ✅ ~~**Ops (Charles)** — `flyctl secrets unset OPENWEATHER_API_KEY -a sharkpark-api`~~ *(done 2026-05-04).* The default `WEATHER_USER_AGENT` (`SharkPark/1.0 (ops@sharkpark.app)`) is correct as-is; only override the secret if the contact mailbox changes.

---

# 🚨 Critical path — these block 2+ people, do them first

✅ ~~**Zach — `POST /api/v1/reports` endpoint**~~ *(shipped in PR #121).* See Lawrence's mobile wire item and Ly's reliability-loop item below for the unblocked work.

- ✅ ~~**Charles — Schema drift on `notification_logs` + `push_tokens`**~~ — *shipped in PR #145.* Took option (b): both orphan tables dropped in a controlled migration; PR #147 then re-created them via the normal Prisma flow. No data lost (push tokens re-register on next app open; logs were dedup-only).

✅ ~~**Zach — Host Apple/Google deep-link manifests**~~ — *shipped via the marketing-site cluster.* Manifests are now served from the apex (NOT `api.sharkpark.app` — final standardization is on the marketing apex):
- https://sharkpark.app/.well-known/apple-app-site-association — Team ID `4K793ZW77F`, bundle `app.sharkpark.mobile`, paths `/map`, `/map/lot/*`, `/forecast/short/*`, `/forecast/long`, `/profile`
- https://sharkpark.app/.well-known/assetlinks.json — Android package `app.sharkpark.mobile`, real release-keystore SHA-256 fingerprint set

✅ **Lawrence — Write `docs/api-access-tiers.md`** *(shipped by Charles in PR #101 alongside the backend implementation)*
- 126-line contract spec at `docs/api-access-tiers.md` covering: (1) full endpoint map (Public / Contributor / Authenticated tiers), (2) the `403 { code: "BG_LOCATION_REQUIRED" }` response contract + the three sub-cases that produce it, (3) recommended mobile soft-ask copy that mirrors the access matrix.
- Unblocks Zach's 403 handling and Ly's `/users/me/forecast` shape freeze — both can implement against this doc now.

✅ **Lawrence — Fix mobile API base URL** *(PR #82, merged)*
- Production URL now `https://api.sharkpark.app/api/v1` (was the wrong `csulb.edu` subdomain). TestFlight builds will reach prod.
- Env-override (`SHARKPARK_API_URL` in `.env`) now actually loads at runtime — `react-native-dotenv` babel plugin wired up in the same PR, with `apps/mobile/.env.example` template. Physical-device dev: `cp .env.example .env`, set the LAN IP, `pnpm start --reset-cache`.

✅ **Charles — `DELETE /api/v1/users/me` cascade** *(PR #100, merged)*
- Endpoint exists at `apps/backend/src/users/users.controller.ts` (`@Delete('me')`), cascades favorites + audit log per P11.108e. App Store / Play Store privacy questionnaire requirement is satisfied **on the backend**. Mobile UI to call it is still TODO — see Lawrence's list below.

✅ ~~**Charles — Pre-launch credential rotation (Neon)**~~ — *done 2026-05-04.* Neon role password rotated in the Neon Console; `NEON_DATABASE_URL` updated in GH Actions; `DATABASE_URL` / `DIRECT_URL` rotated on Fly via `flyctl secrets set -a sharkpark-api` (with `sslmode=verify-full&channel_binding=require`, pooled URL gets `&pgbouncer=true&connection_limit=1`); old password verified dead. New values live only in 1Password + the secret stores — never in this repo.
- **Follow-up — R2 access keys** *(do before store submission as a hygiene sweep)*: not known to be leaked, but rotate to give every prod credential a known post-launch birthdate. Mint new R2 keys in Cloudflare → update GH Actions (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) + Fly (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Do not paste values into any tracked file.

✅ ~~**Charles — Marketing site at `sharkpark.app`**~~ *(shipped in PR #161 + the #166–#172 follow-up cluster).*
- Astro 5 + Tailwind v4 site at [`apps/marketing/`](apps/marketing/) with 6 pages: `/`, `/privacy`, `/terms`, `/support`, `/delete-account`, custom `/404`. SEO + JSON-LD (Organization, WebSite, MobileApplication, FAQPage, BreadcrumbList), og-image (1200×630), sitemap, hardened CSP.
- Deploys via [`.github/workflows/deploy-marketing.yml`](.github/workflows/deploy-marketing.yml) → Cloudflare Workers Static Assets (NOT Pages — migrated during the #166–#170 cascade).
- DNS attached: apex `sharkpark.app` proxied to the Worker; `www` → apex 301 redirect rule. AASA + assetlinks live at apex with real Team ID `4K793ZW77F` and real release-keystore SHA-256.
- All copy explicitly states SharkPark is **independent and not affiliated with CSULB** (hero, footer, privacy §intro, terms §1, support FAQ).
- Cloudflare Web Analytics zone-injected beacon allowed through CSP in #172.
- **Follow-ups (post-launch, non-blocking):**
  - Add real screenshots + hero phone-mockup video (autoplay path already wired)
  - Swap `appStoreUrl` / `playStoreUrl` in [`apps/marketing/src/consts.ts`](apps/marketing/src/consts.ts) once listings are live (currently `#`)
  - Mailing address in `privacy.astro` (some store reviewers require it — defer until reviewer pushes back)
  - Cloudflare dashboard: confirm Git integration is OFF, kill the `*.workers.dev` route
  - Re-verify Cloudflare Email Routing forwards `support@` / `security@` / `hello@sharkpark.app` to inbox

---

# 🟡 Lawrence — Mobile

**High priority**
- ✅ ~~**Persist `isGuest` across app restarts**~~ — *shipped in PR #148.* AsyncStorage flag `@SharkPark:isGuest` hydrates on mount; persists through `continueAsGuest` / `exitGuestMode`.
- ✅ ~~**Wire `ReportModal.onSubmit` → `POST /reports`**~~ — *shipped in PR #149.* New `reportsApi.create` in `apps/mobile/src/services/api/reports.ts`, `ReportThrottledError` (429) + `ReportUnauthorizedError` (401), guest redirect to Profile tab, inline error banner + loading spinner in modal.
- ✅ ~~**Replace `TEAMID` placeholder + set `DEVELOPMENT_TEAM`**~~ — *shipped in PR #140.* Team ID `4K793ZW77F` everywhere (AASA + pbxproj Debug & Release).
- ✅ ~~**Add `assetlinks.json` for Android App Links**~~ — *shipped via the marketing-site cluster (#161+).* Live at https://sharkpark.app/.well-known/assetlinks.json with real release-keystore SHA-256.
- ✅ ~~**Wire `BG_LOCATION_REQUIRED` 403 handler**~~ — *shipped in PR #139.* Two-stage location-permission soft-ask screen replaces the generic toast; WhenInUse first, escalate to Always on auto-contribute opt-in.
- ⏳ **Force-update screen** — *PR #160 open (Lawrence, branch `Feat/force-update-screen`).* Mobile side built: [`ForceUpdateScreen.tsx`](apps/mobile/src/screens/ForceUpdateScreen.tsx) + [`api/version.ts`](apps/mobile/src/services/api/version.ts) + 139-line test file. Calls `GET /min-version` on launch and renders blocking screen with App Store / Play Store CTA. **Blocked on review + Zach's `GET /min-version` backend endpoint** (still 🔴 — see his list).
- 🔴 **Push notification handling — mobile side** *(unblocked by PR #147 backend; FCM/APNs Fly secrets are now set on `sharkpark-api`, so this is the last remaining gap before push works end-to-end)* — install `@react-native-firebase/app` + `@react-native-firebase/messaging`, request permission, fetch FCM token, `POST /users/me/push-token` with `{ token, platform: 'ios' | 'android' }`, re-register on `onTokenRefresh`. Foreground + background message handlers, deep-link the tap into the right screen (favorites notification → map centered on that lot, event notification → forecast for affected lot).
- ⏳ **Re-audit "4 missing tests" — first slice in flight** — *PR #179 open (Lawrence, branch `test/service-coverage-audit`)* adds 34 tests covering `users`, `carBluetooth`, `contributor` services. Awaiting review. Remaining untested services after #179 merges: `locationService`, `leaveDetectionService`, `parkingValidationService`, `sdkConfig`, `headlessTask`, `modeSwitch`, `activityRecognition`, plus the API clients (`lots`, `reliability`, `favorites`, `deviceCredentials`). Suggest 60% coverage floor on `services/` and prioritize the remaining API clients + `deviceCredentials` (HMAC signing has a single test vector pinned but no integration test against the actual `apiService`). The 569 mobile tests that pass today are mostly screens/components.

**Already shipped (kept here for changelog visibility)**
- ✅ ~~**Delete Account UI in Settings**~~ — *shipped in PR #126.* Destructive button in ProfileScreen with confirm modal, calls `DELETE /api/v1/users/me`, signs out, returns to LoginScreen.
- ✅ ~~**Permission downgrade alert**~~ — *shipped in PR #83.*
- ✅ ~~**Bump package.json version to `1.0.0`**~~ — *shipped in PR #83.*
- ✅ ~~**"Continue without account" guest gate**~~ — *shipped in PR #127.* (See `isGuest` persistence follow-up above.)
- ✅ ~~**First-launch onboarding flow**~~ — *shipped in PR #84.*
- ✅ ~~**Deep-linking client config**~~ — *shipped in PR #84.* Custom scheme `sharkpark://` + universal links for `sharkpark.app`. Hosting of AASA/assetlinks JSON files still pending.

**Lower priority / pre-launch polish**
- **Finish `feat/mobile-ui-accessibility` branch** — your in-progress accessibility work (VoiceOver/TalkBack labels, contrast). Merge to main when ready, no big architectural decisions left.
- **App icons + splash screen** — generate all required sizes for iOS (`Assets.xcassets/AppIcon`) and Android (`mipmap-*dpi`). Use `react-native-bootsplash` or similar for the splash. Verify against [App Store icon size matrix](https://developer.apple.com/design/human-interface-guidelines/app-icons) and Play Store adaptive icon spec.
- **Pick + integrate analytics SDK** — Amplitude (free 10M events/mo), Mixpanel (free 20M events/mo), or PostHog (self-host or free 1M events/mo). Track: app_open, lot_view, favorite_added, report_submitted, forecast_view. Don't track location or device-identifying data.
- **Delete dead `GeofencingProvider.tsx`** *(audit 2026-04-30)* — confirmed: `apps/mobile/src/context/GeofencingProvider.tsx` is an empty file, `EnhancedGeofencingProvider.tsx` is the only active implementation. Just `rm` it. ~30 sec.
- **Resolve `// TODO` in [`apps/mobile/src/screens/LongTermForecastScreen.tsx`](apps/mobile/src/screens/LongTermForecastScreen.tsx#L84)** — `selectedDayIndex` is in the `useMemo` deps but never passed to `generateForecast`, so every day shows the same generic curve. Either (a) wire it through to the long-term API once Ly's `predict-all-lots.ts` cron seeds `PredictionLongTerm` rows, or (b) pass `selectedDayIndex` into the local generator as a temporary fix. Coordinates with Ly's prediction-cron item.
- ✅ ~~**Resolve `// TODO` in [`apps/mobile/src/services/api/lots.ts`](apps/mobile/src/services/api/lots.ts#L237)**~~ — *cleared post-#120 rebase.* The placeholder `position: { x: 0, y: 0 }` field is gone from `lots.ts`; the `react-native-maps` migration replaced the legacy custom-map UI that depended on it.
- **Gate stray `console.log` calls behind `__DEV__`** *(audit re-run 2026-05-04)* — [`apps/mobile/src/services/api/favorites.ts`](apps/mobile/src/services/api/favorites.ts#L23) is already `__DEV__`-gated. Remaining offenders:
  - [`apps/mobile/src/services/locationService.ts`](apps/mobile/src/services/locationService.ts) lines 83, 103, 116, 131, 146, 165, 531, 593, 609, 612 — SDK init / geofence registration / mode-switch / provider-change diagnostics.
  - [`apps/mobile/src/hooks/useTransitData.ts`](apps/mobile/src/hooks/useTransitData.ts) lines 53, 57 — socket connect/disconnect logs.
  - [`apps/mobile/src/auth/AzureAuth.tsx`](apps/mobile/src/auth/AzureAuth.tsx#L31) — internal `log()` helper that always fires; either gate the helper itself on `__DEV__` (one-line fix) or audit each call site.
  Not PII, but ships noise to release builds. ~10 min total.
- **Add `NSPhotoLibraryUsageDescription` to `Info.plist`** *only if* any feature actually touches photos (avatar upload, share-image-of-map, etc.). If no, skip — Apple rejects unused permission strings.
- **Apple App Store submission** — App Store Connect listing, screenshots (6.7" and 6.5" required), privacy nutrition labels (use Zach's data inventory), TestFlight build for review, respond to reviewer questions. Allow 1-2 weeks for review cycles.
- **Google Play submission** — Play Console listing, screenshots (phone + 7"/10" tablet), data safety form (mirror App Store labels), internal testing track first, then closed → open beta → production.
- **Privacy policy + ToS hosting** — content drafted by Zach (data inventory) + Ly (ML disclosures), you host on `sharkpark.app/privacy` and `sharkpark.app/terms`. Both stores will reject without these URLs.
- **Final QA pass + cross-team coordination** — run through the test plan on real iOS + Android devices the week before submission.

---

# 🟡 Zach — Backend Features & Admin

**High priority**
- ✅ ~~`POST /api/v1/reports`~~ — *shipped in PR #121 (see critical path).* Mobile wire shipped in #149. New `Report` model with `user_id` cascade.
- ✅ ~~**Verify reports endpoint actually requires auth**~~ — *covered.* `app.e2e-spec.ts` asserts anonymous `POST /reports` → 401 via the global `AzureAdGuard` (assertion landed alongside the access-tier audit closeout).
- ✅ ~~AASA + assetlinks.json hosting~~ — *shipped via the marketing-site cluster.* Both manifests served from https://sharkpark.app/.well-known/.
- ⏳ **`GET /api/v1/min-version`** — *PR #175 open (Zach, branch `Feat/min-version-endpoint`).* Awaiting review. Unblocks Lawrence's force-update screen (PR #160). Was 🔴 critical-path; downgraded to ⏳ now that the implementation exists.
- ✅ ~~**`DELETE /api/v1/users/me` cascade**~~ — *shipped by Charles in PR #100.* Cascades favorites + writes audit log (P11.108e). Mobile UI to call it is now on Lawrence's list above. **`Report` rows also cascade** — `Report.user_id` carries `onDelete: Cascade` in `schema.prisma` (verified 2026-05-04), so PR #121's report writes are covered by the same delete path with no extra work.
- ✅ ~~**Push notification service — backend (b)**~~ — *shipped in PR #147.* `push_tokens` + `notification_logs` schema, `POST /users/me/push-token` endpoint (upsert by token, supports re-installs/token rotation), sender service via `firebase-admin`, all 4 trigger crons (`notify-favorites-filling`, `notify-favorites-clearing`, `notify-surge`, `notify-events`) running on the Fly cron process group at 15-min cadence with `runCronJob` + advisory lock + Sentry Crons check-in.
- ✅ ~~**Push notification service — sub-ticket (a) FCM project + APNs key setup**~~ — *done.* Firebase project provisioned, Cloud Messaging enabled, APNs auth key generated under Team ID `4K793ZW77F` and uploaded to Firebase. `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` all deployed as Fly secrets on `sharkpark-api`, so the notify-* crons can actually deliver. Lawrence's mobile FCM token registration is now the only remaining blocker for end-to-end push.
- ✅ ~~**Privacy nutrition data inventory**~~ — *shipped (commits `14c7308` + `c1ff4ad`).* `docs/privacy-data-inventory.md` lists every collected datum, retention window, and third party. Lawrence is unblocked for both App Store privacy labels and Play data safety form.
- ✅ ~~**Campus event scraper**~~ — *shipped in PR #152 (2026-05-04).* `apps/backend/src/events/events-scraper.service.ts` + crontab entry. Includes the LBSU sports-events scraper (Sidearm calendar) and a weekly cron to prune past events. **Unblocks Ly's nearby-events badge** — table is now populated.

**Lower priority**
- ✅ ~~**Update parking lot metadata**~~ — *shipped in PR #152.* All 28 CSULB lots now carry concept3d-derived polygons, real centroids (single source of truth — see PR description), `is_structure`, EV/short-term/low-emission/pay-station/motorcycle/accessible counts reconciled against concept3d, plus `LotAdvisory` rows refreshed weekly from concept3d construction notices. Building footprints + categories + lat/lng landed alongside.
- ⏳ **Reports/analytics endpoints** — *PR #163 open (Zach, branch `Feat/analytics-endpoints`).* `GET /api/v1/lots/:id/trends?range=Nd` (hourly occupancy averages) + `GET /api/v1/lots/utilization?range=Nd` (per-lot utilization). +150 lines across [`lots.controller.ts`](apps/backend/src/lots/lots.controller.ts), [`lots.service.ts`](apps/backend/src/lots/lots.service.ts), [`parking-lot.interface.ts`](apps/backend/src/lots/interfaces/parking-lot.interface.ts). **Blocked on review.**
- **Admin dashboard** — either a separate Next.js app under `apps/admin/` or admin-scoped routes mounted at `/admin/*` with a JWT role check (`role: 'admin'` claim). Pages: lot CRUD, report review queue (acknowledge/dismiss reports), reliability score overrides. Probably the biggest single ticket on your list — a week of work — defer until after launch unless you have spare cycles.
- ✅ ~~**Audit parking-validation**~~ — *resolved 2026-05-04 audit:* the `@sharkpark/parking-validation` package no longer exists in `packages/`. The only remaining reference is a stale doc-comment in [`apps/mobile/src/services/parkingValidationService.ts`](apps/mobile/src/services/parkingValidationService.ts) line 7 — follow-up: scrub that comment so it doesn't re-confuse the next person who greps for it.
- ⏳ **GDPR/CCPA data export** — *PR #178 open (Zach, branch `Feat/gdpr-ccpa-data-export`).* `GET /api/v1/users/me/data` returns JSON of everything tied to the authenticated user. Awaiting review.
- ⏳ **Backend access-tier follow-ups** *(remaining slices from PR #101)* — *PR #174 open (Zach, branch `Feat/user-throttling-forecasts-scoring`).* Single PR covers all three:
  - `GET /api/v1/users/me/forecast` stacked `AzureAdGuard` + `ContributorGuard`.
  - `TierThrottlerGuard` (public 60rpm, contributor 300rpm, authed 600rpm) with default exception handling.
  - User reliability scoring weights wired through (complements PR #146's reports-factor work).

---

# 🟡 Ly — ML Engineering

**High priority**
- ✅ ~~**Sync with Ly on `/api/v1/users/me/forecast` response shape**~~ — *done, re-locked 2026-04-30 after re-negotiation.* Contract:
  ```ts
  {
    lotId: string,
    predictedAt: string,        // ISO8601, wall-clock when the cron ran the model (drives mobile "last updated Xm ago" badge)
    modelVersion: string,
    predictions: [{
      ts: string,               // ISO8601, hourly bucket start, hours 7–21 local only
      occupancyPct: number,     // 0..1 point estimate (rate, not count)
      ciLow: number,            // 0..1 lower CI bound
      ciHigh: number            // 0..1 upper CI bound
    }]
  }
  ```
  Notes: hourly granularity (matches what the model actually trains on); window is operating hours 7–21 local time only (CSULB lots are dead overnight, simulator hardcodes 0); if request falls outside the window return `predictions: []` with a valid `predictedAt`, **not** a 404. Window is documented in the type so consumers don't expect a fixed 24h slice. Revisit window post-launch if a real overnight use case appears.
- ✅ ~~**Reconcile `predict_short_term.py` output with the locked contract** *(audit 2026-04-30)*~~ — *resolved by Ly's INT→FLOAT change.* Script now outputs rates 0..1 + `ciLow`/`ciHigh` band matching the contract. Hourly granularity is the locked stepping (not 15-min as the original audit suggested). `PredictionShortTerm`/`PredictionLongTerm` Prisma columns flipped INT → FLOAT in the same change.
- ✅ ~~**Weather → ML features**~~ — *shipped in PR #119 as a rule-based postprocess layer instead of a learned feature.* Lives at `services/ml/src/postprocess/weather_adjustment.py`; reads latest `weather` row, classifies severity (`SEVERE`/`SNOW`/`HEAVY_RAIN`/`RAIN`/`EXTREME_HEAT`/`NORMAL`), applies deterministic median multipliers + asymmetric lower-bound widening. **Deliberate scope deviation from the original learned-feature plan** — pre-launch occupancy data is synthetic, so a learned weather model would memorize fabricated correlations; rule layer stays permanent as a safety floor for under-sampled severe events. Multipliers and signs are placeholder until real data arrives. Wired into `services/ml/scripts/predict_short_term.py` with a `WEATHER_MAX_AGE_HOURS` (default 3h) staleness gate. **Follow-up after launch:** revisit with real data to either (a) replace with learned features in `train.py`, or (b) calibrate the rule magnitudes/signs from the live MAE feedback.
- ✅ ~~**Scheduled prediction jobs — `predict-all-lots.ts` cron**~~ — *superseded; shipped as two separate jobs.* Instead of a single `predict-all-lots.ts`, the production layout splits horizons: [`apps/backend/src/scheduler/jobs/predict-short-term.job.ts`](apps/backend/src/scheduler/jobs/predict-short-term.job.ts) (every 15 min, `*/15 * * * *`-aligned) and [`apps/backend/src/scheduler/jobs/predict-long-term.job.ts`](apps/backend/src/scheduler/jobs/predict-long-term.job.ts) (daily 01:05 PT). Both shell out to the matching `services/ml/scripts/predict_*.py` and upsert `prediction_short_term` / `prediction_long_term`. Registered in [`apps/backend/src/scheduler/cron-monitors.ts`](apps/backend/src/scheduler/cron-monitors.ts).
- ✅ ~~**One-time prediction backfill**~~ — obsolete: the 15-min short-term cron above seeds `PredictionShortTerm` on its first tick after deploy; long-term cron seeds on its first 01:05 PT tick. No manual backfill needed.

**Medium priority — all on Fly + Cloudflare R2, no AWS**
*(We're Tier 3: Fly + Neon + Cloudflare. SageMaker and Lambda were carryovers from the old AWS plan and would add $30-100/mo for no benefit at our QPS.)*
- ⏳ **MLflow → R2 export** — *PR #151 open (Ly, branch `feat/ml-mlflow-r2-registry`).* Real upload now implemented in [`services/ml/src/utils/mlflow_utils.py`](services/ml/src/utils/mlflow_utils.py) (+208 lines) using `boto3` against R2's S3-compatible endpoint; `promote_short_term.py` + `promote_long_term.py` wired in; +156-line test suite at `tests/utils/test_mlflow_utils.py`; `boto3` added to `pyproject.toml`; new `.env.example` keys. **Blocked on review.** Once merged, unblocks the `predict-all-lots.ts` cron (so the bucket isn't empty on first run).
- ✅ ~~**Automated retraining — `retrain-models.ts` weekly cron**~~ — *superseded by GitHub Actions.* Production retraining lives in [.github/workflows/ml-retrain.yml](.github/workflows/ml-retrain.yml): short-term daily `0 10 * * *` UTC (≈02:00 PT), long-term weekly `0 11 * * 0` UTC (≈03:00 PT Sun). Both run training, evaluation, and conditional auto-promotion via `services/ml/scripts/promotion_guard.py` (4 rules: metric present, absolute MAE floor, ≥1% relative improvement, quantile coverage in [0.7, 0.9]). Manual `workflow_dispatch` allows ad-hoc training and `auto_promote=false` for human review. Running training off the cron VM avoids the XGBoost + pandas memory caveat entirely.
- ✅ ~~**Model drift monitoring**~~ — *shipped 2026-05 in [`apps/backend/src/scheduler/jobs/prediction-accuracy.job.ts`](apps/backend/src/scheduler/jobs/prediction-accuracy.job.ts).* Daily 05:15 PT cron joins yesterday's `prediction_short_term` against the matching `occupancy_snapshots` (±8 min of `target_time`), computes per-lot MAE / RMSE / coverage / 80%-interval-hit-rate, and emits a structured `Sentry.captureMessage` (level=info, tag=`cron:prediction-accuracy`, extra=`per_lot[...]`) so an ops alert can trigger on threshold breach. Registered with `track:true` in `cron-monitors.ts` — metadata flows into `ml_cron_runs` for historical inspection.

**Shipped**
- ✅ ~~**Feedback → model loop**~~ — *shipped in PR #146 (2026-05-03).* Report data now feeds the weighted reliability formula in `apps/backend/src/reliability/reliability.service.ts`.

**Unblocked by PR #152 (merged 2026-05-04)**
- 🟢 **Nearby-events surface — product decision (Ly owns the call, work is split across Zach + Lawrence)** *(decision 2026-04-30: replaces the previously-scoped “event-aware forecasting layer”. Events are too noisy/sparse to drive accurate per-lot occupancy predictions — we will surface them as context instead, not as a model feature.)*
  - ✅ ~~**Zach (~1 hr)**~~ — *shipped.* `GET /api/v1/lots/:id/nearby-events?within_hours=2` (default 2h, capped server-side) is live on [`LotsController`](apps/backend/src/lots/lots.controller.ts#L220), Public tier. Returns the count + summary of `CampusEvent` rows whose `affected_lots[]` includes `:id` and whose `start_time` is within the window. The forward-reference comment in [`apps/backend/src/lots/lots.service.ts`](apps/backend/src/lots/lots.service.ts) was updated in the same pass.
  - **Lawrence (~2 hr)** — badge on lot detail (“3 events nearby — occupancy may be affected”) sourced from the new endpoint; tap-through reveals event names + start times. No prediction-pipeline coupling.
  - **Lawrence (~1 hr, post-launch)** — when a favorited lot has ≥2 events starting within the next 2 hours, fire a local notification (“Events near \<lot\> may affect availability”). Throttled to once per lot per day.
  - **Ly (zero code)** — enforce the decision: do NOT wire `CampusEvent` into `predict_short_term.py`, `predict_long_term.py`, or `train.py`. There is no event-impact forecasting in this product — the `EventImpact` model + `ImpactLevel` enum + `/events/:id/impacts` route were removed 2026-04-30. Mobile decides which events are relevant to a given lot via the geographic `nearby-events` query at request time.
  - **Unblocked 2026-05-04** by PR #152 — `CampusEvent` table is now populated from the scraper, so the Zach + Lawrence sub-tickets above are actionable.

---

# 🟡 Charles (me) — Platform/Infra

**High priority**
- 🔴 **Pre-launch credential rotation** *(see critical path — do last)*
- 🔴 **Marketing site at `sharkpark.app`** *(see critical path — blocks store submission)*
- ✅ ~~**Harden Android release signing config to fail loudly**~~ — *shipped in PR #128.* Release variants now `throw new GradleException(...)` on any missing keystore env var; debug builds unaffected.
- ✅ ~~**Sentry alert rules — generic**~~ — *done.* Backend: `[backend] New issue created`, `[backend] Error spike (>50 events/hr)`, `[backend] p95 latency regression (>800ms)`. Mobile: `[mobile] New issue created`, `[mobile] Crash affecting >25 users/hr`.
- **Sentry per-transaction p95 alerts on `/lots` and `/users/me/forecast`** — the project-wide `p95 > 800ms` rule fires on the aggregate, which is dominated by high-traffic `/lots`. A regression on the lower-traffic `/users/me/forecast` (auth-only, only when forecast screen is opened) can easily double in latency without moving the project-wide p95 enough to trip. Add two transaction-scoped Performance alerts with their own thresholds (suggest 600ms for `/lots`, 1200ms for `/users/me/forecast` since it does an XGBoost inference round-trip). ~10 min in the Sentry UI, no code.
- **Native sourcemap upload step in mobile build workflow** — follow-up from PR #118; needed before production stack traces are readable. ~30 min once we have an EAS/Fastlane build pipeline.
- ✅ ~~**Add Python + ML deps to backend Dockerfile**~~ — *shipped in PR #129.* Runtime image now installs Python 3.11 + `python3-venv` + build deps, creates `/opt/venv` to sidestep PEP 668, and runs `uv sync --active --frozen --no-dev` against `services/ml/uv.lock`. Same PR bumped the cron process VM in `apps/backend/fly.toml` from 512 MB → 1 GB. Ly's `predict-all-lots.ts` cron is fully unblocked.
- ✅ ~~**Review PR #120 (Zach — Dynamic Map & Shuttle Integration)**~~ — *merged 2026-04-30.* Lawrence's `position: { x: 0, y: 0 }` cleanup item in `apps/mobile/src/services/api/lots.ts` is now actionable post-rebase.
- ✅ ~~**Triage open dependabot batch (#124 + #104–#117)**~~ — *cleared 2026-04-30.* Merged: #104, #105, #106, #107, #108, #109, #110, #111, #112, #114, #115, #116, #117, plus follow-ups #134 (jose ESM Jest transform), #135 (RN 0.85.2), #136 (minor-and-patch group).
- **Reviewing & merging open infra PRs as they come in** — don't let stale PRs rot. Will keep my queue clear daily.

**Already shipped**
- ✅ ~~**Mobile Sentry init**~~ — *JS-side shipped in PR #118* (native sourcemap upload still TODO above).
- ✅ ~~**Better Stack uptime ping**~~ — monitor on `/health/ready` is live. *(Kept — external blackbox probe Sentry can't replace.)*
- ✅ ~~**Better Stack heartbeat monitors per cron job**~~ — *shipped in PR #122, then migrated to Sentry Crons in PR #144.* All 7 crons now check in to Sentry; Better Stack heartbeats torn down + secrets unset on 2026-05-01.
- ✅ ~~**Sentry Crons migration**~~ — *shipped in PR #144.* Single tool now owns errors + cron liveness; new crons just add an entry to `_cron-monitors.ts`.

**Lower priority / standby**
- **Document `FLY_API_TOKEN` rotation cadence in runbook** — we use a long-lived deploy token instead of Fly OIDC (still in beta and rough). Add a quarterly rotation reminder + the `flyctl tokens create deploy --expiry 720h` command to `docs/runbooks/runbook.md` so this doesn't get silently forgotten. ~15 min.
- ✅ ~~**Public status page at `status.sharkpark.app`**~~ — *done.* Better Stack status page live; CNAME attached; linked from marketing footer via `SITE.statusUrl` in [`apps/marketing/src/consts.ts`](apps/marketing/src/consts.ts).
- **Evaluate consolidating uptime onto Sentry Uptime Monitoring** — Sentry now has a GA'd external uptime probe product. If we ever drop the public status page, we can move the `/health/ready` check off Better Stack and kill that vendor entirely. Not worth the migration cost while Better Stack is hosting the status page anyway. Revisit if Better Stack starts charging or status page gets killed.
- **k6 load tests pre-launch** — sustained 600 req/min on `/lots` (matches Cloudflare rate-limit cap) + 5-min spike to 2000 req/min. Verifies single Fly instance survives, validates throttler buckets, surfaces Neon connection-pool ceilings. Skip until other launch-blocking items are clear.
- On-call for any deploy/CI/DB pain anyone hits — ping me in groupchat
- Will pick up Zach's `GET /min-version` if he's slammed (small enough to grab in <1 hr)
- Will help draft privacy policy content once Zach + Ly hand off the data inventory
- Standby to bump cron VM to 1GB or wire up an ephemeral training Machine if Ly hits OOM during retraining

---

# 🔗 Dependency map

```
[✅ cleared]
Zach POST /reports          →  Lawrence ReportModal wire (#149) + Ly model loop (#146 ✅)
Zach AASA hosting           →  Lawrence universal links (#161 cluster)
Zach campus event scraper   →  Ly nearby-events badge (#152 ✅ — table populated)
Zach GET /lots/:id/nearby-events  →  ✅ endpoint live on LotsController (Lawrence's badge wire is the next step)
Lawrence access-tiers doc   →  Zach 403 handler + Ly endpoint shape freeze
Lawrence api.config env     →  cross-team prod QA on real devices
Ly forecast shape sync      →  Lawrence forecast UI implementation
Ly MLflow→R2 export         →  Ly predict-all-lots cron (PR #151 ⏳ — R2 has artifacts on merge)

[🔴 still blocking]
Zach FCM/APNs setup         →  ✅ done — Fly secrets deployed; Lawrence's mobile FCM wire is now the only remaining gap
Zach GET /min-version       →  Lawrence force-update screen (PR #160 ⏳ — ready, soft-blocked on PR #175 ⏳)
Zach data inventory         →  ✅ done — `docs/privacy-data-inventory.md` landed; Lawrence privacy labels unblocked
Ly predict-all-lots cron    →  Lawrence forecast UI shows real data on day 1 (next critical — #151 unblocks)
```

# Note on the ML infra choice

We're not using SageMaker or Lambda — both were carryovers from an earlier AWS-centric plan. Tier 3 stack is **Fly + Neon + Cloudflare**, and a `predict-all-lots.ts` cron on our existing always-on Fly cron Machine handles inference for $0 extra. R2 is our model artifact store (already paid for via DB backups). Net cost vs SageMaker: $0–$3/mo vs $30–100/mo, with no new cloud account or IAM setup.

# TL;DR

**Single highest-leverage ticket on the board: Zach's `POST /reports`.** Lawrence and Ly both unblocked simultaneously.

If anyone wants to swap items, flag a blocker I missed, or push back on a priority, feel free to message me.

---

# 🆕 PR review queue snapshot (updated 2026-05-03)

**Merged 2026-04-29:**
- ✅ #118 — Charles — Mobile Sentry init (JS-side)
- ✅ #119 — Ly — Weather-aware short-term predictions (rule-based postprocess layer)
- ✅ #121 — Zach — `POST /api/v1/reports` endpoint
- ✅ #122 — Charles — Better Stack heartbeat pings on cron success
- ✅ #123 — Charles — Mobile/backend access-tier alignment (guest mode unblockers)

**Merged 2026-04-30:**
- ✅ #84 — Lawrence — Onboarding flow + deep-linking client config (rebased onto main; AASA still has `TEAMID` placeholder — see pre-launch credentials)
- ✅ #104, #105, #106 — dependabot — mobile gem bumps (activesupport, bigdecimal, concurrent-ruby)
- ✅ #107 — dependabot — GitHub Actions group (6 updates)
- ✅ #108, #109, #110, #111, #112 — dependabot — ML deps (mlflow, python-dotenv, botocore, uvicorn, xgboost)
- ✅ #114, #115 — dependabot — backend dev deps (jest, @eslint/js)
- ✅ #116, #117 — dependabot — backend deps (jwks-rsa, @types/supertest)
- ✅ #120 — Zach — Dynamic Map & Shuttle Integration (`react-native-maps` + PassioGO! websocket)
- ✅ #126 — Lawrence — Delete Account UI in ProfileScreen (App Store 5.1.1(v))
- ✅ #127 — Lawrence — Guest Mode ("Continue without account", App Store 2.1). Includes follow-up fix so login-cancel restores guest mode instead of dumping the user back to the LoginScreen wall.
- ✅ #128 — Charles — Fail-loud Android release signing config
- ✅ #129 — Charles — Python 3.11 + ML venv in backend runtime image; cron VM 512→1024 MB
- ✅ #134 — Charles — Allow `jose` ESM through Jest transform
- ✅ #135 — Lawrence — Bump react-native to 0.85.2 + migrate to `@react-native/jest-preset`
- ✅ #136 — dependabot — minor-and-patch group (24 updates)

**Merged 2026-05-01:**
- ✅ #133 — Ly — INT→FLOAT predictions / rates contract
- ✅ #137 — Charles — Remove `EventImpact` forecasting layer
- ✅ #138 — Charles — Repo bootstrap script + fix `daily_rate` Decimal serialization
- ✅ #142 — Charles — CI Pods cache restore-keys fix
- ✅ #143 — Lawrence — RN 0.85.2 re-bump + jest-preset migration
- ✅ #144 — Charles — Migrate cron monitoring from Better Stack heartbeats to Sentry Crons

**Merged 2026-05-02 / 2026-05-03 (mobile critical-path + marketing launch):**
- ✅ #139 — Lawrence — Mobile 403 `BG_LOCATION_REQUIRED` → two-stage location permission UX (replaces generic toast with soft-ask screen)
- ✅ #140 — Lawrence — Real Apple Team ID `4K793ZW77F` in AASA + `DEVELOPMENT_TEAM` set in `mobile.xcodeproj` Release config
- ✅ #145 — Charles — Drop orphan `notification_logs` + `push_tokens` tables (resolves prod schema drift before #147)
- ✅ #147 — Zach — Push notifications backend: `push_tokens` + `notification_logs` schema, `POST /users/me/push-token` endpoint, sender service + 4 trigger crons (favorites filling/clearing, surge, events) at 15-min cadence
- ✅ #148 — Lawrence — Persist `isGuest` across cold restarts via AsyncStorage (`@SharkPark:isGuest`)
- ✅ #149 — Lawrence — Wire `ReportModal.onSubmit` → `POST /reports`; new `reportsApi.create`, throttle (429) + unauth (401) error classes, guest redirect to Profile tab
- ✅ #161 — Charles — **SharkPark rebrand + sharkpark.app marketing site.** Bundle ID `com.sharkpark.mobile` → `app.sharkpark.mobile`, full iOS/Android icon regen, amber-500 theme, Astro 5 + Tailwind v4 marketing site (6 pages), AASA + assetlinks hosted at apex.
- ✅ #166–#170 — Charles — Marketing CI cascade fixes (workflow path filters, build env, Cloudflare Workers Static Assets migration from Pages, custom domain attach, www→apex 301)
- ✅ #171 — Charles — Marketing site: normalize trailing slash on active-nav comparison (insufficient — followed up by #172)
- ✅ #172 — Charles — Marketing site: strip `.html` from build-time `Astro.url.pathname` so active-nav state actually works under `build.format: 'file'`; CSP allows Cloudflare Web Analytics (`static.cloudflareinsights.com` script-src, `cloudflareinsights.com` connect-src)

**Merged 2026-05-03 / 2026-05-04 (stability + scraper cluster):**
- ✅ #146 — Ly — Reports → reliability score loop
- ✅ #173 — Charles — Weather: NWS migration + long-term forecast cron + retention
- ✅ #176 — Charles — Stability cluster (cron VM 2 GB, cold-start health-check grace, pg connect timeout, idempotent pool teardown, Sentry 4xx noise)
- ✅ #177 — Charles — `min_machines_running = 1` (warm app machine, kills cold-start latency on first request)
- ✅ #152 — Zach — Campus event scraper + lot metadata enrichment (concept3d polygons, building footprints/categories, advisories, sports scraper, weekly prune cron)

**Still open:**
- #150 (Lawrence) — superseded by #161, **close without merging**.
- #151 (Ly) — MLflow R2 Registry. Awaiting review. **Unblocks `predict-all-lots.ts` cron.**
- #160 (Lawrence) — force-update screen on launch. Awaiting review. **Soft-blocked on PR #175 (Zach's `GET /min-version`).**
- #163 (Zach) — analytics endpoints (`/lots/:id/trends`, `/lots/utilization`). Awaiting review.
- #174 (Zach) — tier throttling + `/me/forecast` + reliability scoring (covers 3 backlog items in one PR).
- #175 (Zach) — `GET /min-version` endpoint. Awaiting review. **Unblocks PR #160.**
- #178 (Zach) — GDPR/CCPA data export `/me/data`. Awaiting review.
- #179 (Lawrence) — service-coverage audit, +34 tests for `users` / `carBluetooth` / `contributor`. Awaiting review.
- #180 (Charles) — events bulk-summary endpoint + sports-scraper fixes + mobile event polish. Awaiting review.
- #164, #165, #190 (dependabot) — Astro `apps/marketing` major bump (5.18 → 6.1.6 / 6.2.2). Needs migration check.
- #155, #156, #162, #181, #182, #184, #185, #186 (dependabot) — ML deps (gitpython, mako, uv group, pandas, pytest, pytest-cov, cuid2, fastapi).
- #183 (dependabot) — GitHub Actions group, 3 updates.
- #187 (dependabot) — npm minor-and-patch group, 7 updates.
- #188 (dependabot) — TypeScript 5.9 → 6.0 (root). Needs verification across all packages.
- #189 (dependabot) — `@react-native-async-storage/async-storage` 2.2 → 3.0 (major bump — verify guest-mode persistence still works after #148).

**Direct-to-main commits (not in PR list):**
- `14c7308` + `c1ff4ad` (Zach) — **`docs/privacy-data-inventory.md` landed.** App Store privacy labels + Play data safety form are now unblocked for Lawrence.
- `a40eddb` (Lawrence, 2026-05-02) — *force-update screen scaffolding* (later promoted to PR #160 for review).
- `c071caa` (Lawrence, 2026-05-02) — **assetlinks hardening per PR feedback** (drop debug fingerprint, runbook expansion, CI regex). See Recently shipped.
- `c7c5eb6` (Lawrence) — initial `assetlinks.json` for App Links autoVerify.
- `e6485fb` (Zach, merged via #147) — push notifications backend.
- `e8bd7b0` (Zach) — `POST /contributor/revoke` for immediate permission revocation.
- `88a594c` (Zach) — redact live occupancy for non-contributors + 24h permission grant.
- `c3b70aa` (Charles, via #137) — remove `EventImpact` forecasting layer.
- `7d1d358` (Charles, 2026-05-03) — marketing copy/legal/a11y polish. See Recently shipped.

---

# ❓ Open question (raised 2026-04-29) — long-term forecast weather features

*Promoted to a scoped ticket pair — see "🔴 Long-term weather forecast" section near the top of the file.*

---

# 🆕 Access-tier audit cluster — Charles (added 2026-04-28)

**Why this exists:** the access-tier model (Public / Contributor / Authenticated) was specced in PR #101 + `docs/api-access-tiers.md`, but the codebase still has pre-tier assumptions baked in (notably an `UNKNOWN` user-type throw that blocks guests from contributor enrollment). With Lawrence's "Continue without account" guest gate coming, every guest-mode call path needs to be audited end-to-end.

**Critical fixes (block guest mode shipping)**
- ✅ ~~**Mobile — remove `UNKNOWN` throw in `EnhancedGeofencingProvider.tsx`**~~ — *shipped in PR #123.* Geofencing is now device-scoped (no `useAuth` dep), and the dead `classifyUser`/`UserType` helpers were removed from `geoHelpers`.
- ✅ ~~**Mobile — drop `userEmail` from dev `console.log`**~~ — *shipped in PR #123.*
- ✅ ~~**Backend — tighten `users.service.ts` email check**~~ — *shipped in PR #123.* Now `endsWith('@student.csulb.edu')`, with a lookalike-subdomain regression test.

**🆕 Critical fixes added by PR #123 (were latent bugs, not in original audit)**
- ✅ ~~**Mobile — inject `x-device-id` on every request**~~ — was not being sent at all; would have hard-failed every `ContributorGuard`-protected endpoint in prod.
- ✅ ~~**Mobile — sign `POST /occupancy-events` with HMAC-SHA256**~~ — was not being signed; would have hard-failed `HmacGuard` once `DEVICE_EVENT_SECRET` was set in prod. New `deviceCredentials.ts` module is the single source of truth (AsyncStorage device UUID + `@noble/hashes` HMAC). RFC 4231 test vector pinned.
- ✅ ~~**Set `DEVICE_EVENT_SECRET` Fly secret in prod**~~ — *done.* Mobile build and Fly secret share the same value; HmacGuard is now enforcing.
- ✅ ~~**Set the 6 `BETTERSTACK_HEARTBEAT_*` Fly secrets**~~ — *done in #122, then unset 2026-05-01 after #144 migrated cron liveness to Sentry Crons.*

**Audit phase (do before further fixes — informs the rest)**
- ✅ ~~**Backend endpoint → tier audit**~~ — *done 2026-04-29.* Gap table appended to `docs/api-access-tiers.md` ("Current state vs spec — audit" section). Findings surfaced new decisions, see below.
- **Mobile service → tier audit** — every `apiService.get/post` call, what tier does it hit, what does the caller assume about auth state, what UI breaks if 401/403 returned in guest mode.
- ✅ ~~**Document findings**~~ — done in same commit as the audit.

**Decisions surfaced by the backend audit (2026-04-29) — all resolved**
- ✅ ~~`GET /occupancy-events/lots/:lotId` is Public but leaks live data~~ — *resolved.* Now gated by `ContributorGuard`; e2e seeds a `ContributorPing` and asserts 403 `BG_LOCATION_REQUIRED` without `x-device-id`.
- ✅ ~~Duplicate `/health` endpoint~~ — *resolved.* `AppController` + `AppService` deleted; `HealthController` (Terminus) is sole owner of `/health`, `/health/live`, `/health/ready`.
- ✅ ~~Spec lists `GET /events/:id` but it's not implemented~~ — *resolved.* Struck from spec.
- ✅ ~~`POST /reports` anonymous-coverage gap~~ — *resolved.* `app.e2e-spec.ts` asserts anonymous `POST /reports` returns 401 via the global `AzureAdGuard`.
- ✅ ~~`/lots/:id/history` tier~~ — *resolved.* Locked Public (cached aggregates, not a live signal).
- 🟡 **Spec table is missing 8 endpoints that exist in code** (all currently `@Public`): `/events/upcoming`, `/weather/impact`, `/reliability/lots/:lotId`, `/reliability/lots`, `/reliability/config`, `/occupancy-events/lots/:lotId/stats`, `/occupancy-events/snapshots/:lotId`, `/health/live` & `/health/ready`. Add to the doc once tier confirmations land.

**Mobile guest-mode hardening (after audit)**
- **MapScreen + lot list render for guests** — verify the public surface (`/lots`, `/lots/:id`, `/weather/current`, `/events`, `/transit/*`) renders cleanly with no token + no device-id.
- **API interceptor distinguishes 401 vs 403 `BG_LOCATION_REQUIRED`** — different UX (sign-in flow vs background-location soft-ask). Today the interceptor likely treats both as generic errors.
- **`x-device-id` header on every request** — must NOT be gated on user login. It's the ticket out of guest tier into Contributor. Verify it's set in the base apiService, not in any auth-conditional path.
- **Favorites / Profile / Settings UI** — show "Sign in to use" CTA for guests instead of broken screens or 401 toast spam.
- **ReportModal in guest mode** — `POST /reports` will be Authenticated tier per Zach's spec; either hide submit or route guests to sign-in.
- **FilterModal employee-lot section** — neutral labeling (or conditional surface) so guests/students aren't confused by "Employee Lot" header with no context.

**Backend test coverage (after audit)**
- **`ACCESS-3` e2e** — full guest happy path: Public works with no headers, Contributor returns 403 `BG_LOCATION_REQUIRED`, Authenticated returns 401.
- **`ACCESS-4` e2e** — guest enrolls via `POST /occupancy-events`, then Contributor endpoints succeed within `CONTRIBUTOR_PING_TTL_MS`.

**Backend tier decisions to lock in (independent, ship anytime)**
- ✅ ~~**`/lots/:id/history` tier**~~ — *resolved.* Locked Public.
- **Confirm `/weather/current` and `/events/*` are actually `@Public`** in code (not accidentally guarded).
- **`UserType` column fate** — delete (preferred — less PII, fewer App Store privacy questions, ~1 hr migration) or document as metadata-only with no enforcement. Currently populated, returned in API responses, **read for zero decisions**.

**Post-launch follow-ups (not blocking)**
- **Rename `LotType` STUDENT/EMPLOYEE → `LotCategory`** to remove the naming collision with `UserType`. Pure rename + migration.
- **Derive user role from Azure AD `affiliation` claim** (student / staff / faculty / member) instead of guessing from email substring. Authoritative source, no parsing fragility.