# SharkPark — Pre-Launch TODO

*Last updated 2026-05-01 (post-merge of #137, #138, #142, #143, #144). This document tracks remaining work to App Store / Play Store submission. For day-to-day status, sections are organized per-owner with priority tiers.*

---

# ✅ Recently shipped (since 2026-04-28)

**Backend / infra (Charles):**
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

**Backend (Zach):**
- PR #121 — `POST /api/v1/reports` endpoint (DTO `{ lotId, type, message? }`, throttled 5/min/user, 401 for guests)

**Mobile (Lawrence):**
- PR #82 — Env-based API URL (production points at `https://api.sharkpark.app/api/v1`)
- PR #83 — Permission downgrade alert + version bump to 1.0.0
- PR #84 — First-launch onboarding flow (4 slides), deep-linking client config (custom scheme + universal links), App Store readiness fixes (Info.plist purpose strings, AASA stub, Android App Links intent filter, `POST_NOTIFICATIONS` permission, release signing scaffold)
- PR #126 — Delete Account UI in ProfileScreen (App Store guideline 5.1.1(v))
- PR #127 — Guest Mode — "Continue without account" affordance (App Store guideline 2.1), with cancel-restores-guest follow-up
- PR #143 — Re-bump `react-native` to 0.85.2 + migrate to `@react-native/jest-preset` (re-application of #135 after rebase noise)

**Apple / Play store blockers cleared by these merges:**
- 5.1.1(v) in-app account deletion (UI now wired to backend `DELETE /users/me`)
- 2.1 browse-without-account
- Onboarding + permission priming (no more iOS location sheet during slide 1)

---

# � App Store submission sequence (added 2026-05-02)

Ordered list of what's actively in flight to get SharkPark submitted. Don't reorder — each step unblocks the next.

**Step 0 — Email migrations** (independent, ~30 min total). Mailbox plan:
- `ops@sharkpark.app` → Fly, Neon, Sentry, Better Stack, Prisma (operational alerts)
- `security@sharkpark.app` → GitHub security advisories, future Snyk
- `billing@sharkpark.app` → Apple Developer billing, Google Play billing, future Stripe
- `support@sharkpark.app` → user-facing (App Store support URL, in-app email, press contact via `hello@`)
- `hello@sharkpark.app` → press / general inbound (already used on marketing site)
- All forward to personal inbox via Cloudflare Email Routing.

Migration order (avoids lockouts):
1. ⏳ Cloudflare Email Routing — set up forwarding for `ops@`, `security@`, `billing@`, `support@`, `hello@`
2. ⏳ Fly.io account email → `ops@`
3. ⏳ Neon account email → `ops@` (keep billing owner = Charles personal)
4. ⏳ Sentry account + org owner email → `ops@`
5. ⏳ Better Stack account email → `ops@`
6. ⏳ Prisma Data Platform email → `ops@` (skip if not using Accelerate/Pulse)
7. ⏳ GitHub — add `security@` as verified secondary email (don't replace primary)
8. ⏳ Apple Developer — update billing email → `billing@` (defer if mid-onboarding)
9. ⏳ Google Play Console — create new account with `ops@` ($25 fee, deferred until Android submission)

**Step 1 — Land marketing scaffold PR** (separate from #154). Includes [`apps/marketing/`](apps/marketing/) + [`.github/workflows/deploy-marketing.yml`](.github/workflows/deploy-marketing.yml) + AASA/assetlinks updates with real Team ID `4K793ZW77F` and `app.sharkpark.mobile` bundle ID.

**Step 2 — Cloudflare Pages project** — create `sharkpark-marketing`, connect repo, add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` GH secrets.

**Step 3 — DNS** — apex `sharkpark.app` + `www` → Pages project via custom-domain UI. Verify `https://sharkpark.app/.well-known/apple-app-site-association` returns JSON with `Content-Type: application/json`.

**Step 4 — Merge marketing PR** once #154 is in.

**Step 5 — App Store Connect** — paste `https://sharkpark.app/privacy`, run App Privacy questionnaire (cheat sheet: Email/Name/UserID/Location/DeviceID/CrashData/PerformanceData/ProductInteraction; Tracking = NO for everything), fill App Information (Navigation primary, Utilities secondary, support URL `https://sharkpark.app/support`), Pricing (Free, all territories), App Review contact + demo Azure AD creds.

**Step 6 — Build upload** — Xcode → Archive → Distribute → App Store Connect (blocked on Lawrence's QA pass).

**Step 7 — Submit for review.**

---

# �🔴 Pre-launch credentials & signing — DO NOT FORGET

These four are all "the binary won't ship without them." Cheap individually, catastrophic if discovered the day of submission. Owners split between Charles (CI/CD secrets) and Lawrence (Xcode/Apple developer console).

- **Charles — `BG_GEOLOCATION_LICENSE` env var in CI/CD** — Transistor Software's `react-native-background-geolocation` license key. Without it the SDK runs in trial mode and **stops working after a few hours in production builds**. Set as a secret in GitHub Actions (`BG_GEOLOCATION_LICENSE`) and in whichever build service we use for archives (Xcode Cloud / EAS Build / Fastlane). Inject into `Info.plist` and `AndroidManifest.xml` at build time. License key lives in 1Password.
- **Charles — Production Android keystore** — generate once with `keytool -genkey -v -keystore sharkpark-release.keystore -alias sharkpark -keyalg RSA -keysize 2048 -validity 10000`, **back up off-machine immediately** (lose this and you can never push an update to existing installs — ever). Store in 1Password + an offline copy. Set `RELEASE_KEYSTORE_PATH`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` as GitHub Actions secrets. Wire into `apps/mobile/android/app/build.gradle` `signingConfigs.release`.
- **Lawrence — Replace `TEAMID` placeholder in [`apps/mobile/docs/apple-app-site-association.json`](apps/mobile/docs/apple-app-site-association.json)** — needs the real 10-character Apple Developer Team ID (find under Apple Developer → Membership). Then the file gets deployed to **`https://sharkpark.app/.well-known/apple-app-site-association`** (NOT `sharkpark.csulb.edu` — we standardized on the apex domain in PR #84). Hosting falls under Charles's marketing-site item; Lawrence just needs to fix the Team ID and hand it off.
- **Lawrence — Set `DEVELOPMENT_TEAM` in [`apps/mobile/ios/mobile.xcodeproj/project.pbxproj`](apps/mobile/ios/mobile.xcodeproj/project.pbxproj) Release config** — same 10-character Team ID. Without this, archive builds fail with "No signing certificate found" in CI. Set for both `mobile` and `mobile-tvOS` (if present) targets, Release configuration. Easiest path: open in Xcode → Signing & Capabilities → pick the team in dropdown, commit the diff.

---

# 🔴 Long-term weather forecast — approved, scoped

Charles asked, answer is yes. Promoted from open-question to a real ticket pair.

**Source:** NWS `api.weather.gov` hourly forecast (7-day, no key, no quota). Picked over OpenWeatherMap because finer granularity and no rate limit.

**Order matters — Ly's `predict-all-lots.ts` cron must land first**, otherwise we'd be wiring weather features into a code path that doesn't run in prod.

**Tickets:**
- **Zach (backend, ~2 hr)** — new `WeatherForecast` Prisma model (`target_time`, `temperature_f`, `precipitation_probability`, `conditions`, `fetched_at`); new `apps/backend/src/scripts/fetch-weather-forecast.ts` cron; crontab entry `0 */6 * * *` (forecasts don't churn fast); add a new entry to `apps/backend/src/scripts/_cron-monitors.ts` (Sentry Cron auto-creates the monitor on first check-in — no Better Stack secret needed). Use the existing `runCronJob` + `withAdvisoryLock` pattern from `fetch-weather.ts`. NWS requires a `User-Agent` header — set it to something like `SharkPark/1.0 (charles@sharkpark.app)`.
- **Ly (ML, ~3 hr, after Zach's cron)** — extend `services/ml/src/postprocess/weather_adjustment.py` to accept a forecasted-weather row keyed by `target_time` (instead of always reading the latest observation). Wire into the future `predict_long_term.py`. Same caveats from PR #119 apply: placeholder coefficients, asymmetric lower-bound widening, staleness gate.
- **Track separately:** long-term live MAE, so we can tell whether the forecast feature actually helps or just stacks two error bands. Folds into the existing model-drift monitoring item on Ly's list.

---

# 🚨 Critical path — these block 2+ people, do them first

✅ ~~**Zach — `POST /api/v1/reports` endpoint**~~ *(shipped in PR #121).* See Lawrence's mobile wire item and Ly's reliability-loop item below for the unblocked work.

- 🔴 **Charles — Schema drift on `notification_logs` + `push_tokens`** *(blocks Zach's notification PR)*
Both tables exist in prod (created via untracked manual SQL during Zach's spike) but are absent from `apps/backend/prisma/schema.prisma` and from every committed migration. `prisma migrate deploy` doesn't drop them (it only applies forward migrations), but Zach's incoming notif PR will collide with them — his `prisma migrate dev` will try to CREATE the same tables. Two options: (a) reverse-engineer the prod schema into a baseline migration that matches reality, then have Zach build on top, or (b) drop both tables in a controlled migration and let Zach's PR re-create them through the normal flow. Option (b) is cleaner since the data is non-critical (push tokens re-register on next app open, logs are append-only). Decide before reviewing his PR.

🔴 **Zach — Host Apple/Google deep-link manifests**
Apple and Google both require static JSON files served from your domain root to enable universal/app links. We need:
- `https://api.sharkpark.app/.well-known/apple-app-site-association` (no extension, `Content-Type: application/json`)
- `https://api.sharkpark.app/.well-known/assetlinks.json`

Easiest: add a NestJS controller that returns the static JSON, or serve via Cloudflare Pages. Lawrence will give you the bundle IDs and SHA256 fingerprint. *Unblocks: Lawrence's universal links → App Store submission.*

✅ **Lawrence — Write `docs/api-access-tiers.md`** *(shipped by Charles in PR #101 alongside the backend implementation)*
- 126-line contract spec at `docs/api-access-tiers.md` covering: (1) full endpoint map (Public / Contributor / Authenticated tiers), (2) the `403 { code: "BG_LOCATION_REQUIRED" }` response contract + the three sub-cases that produce it, (3) recommended mobile soft-ask copy that mirrors the access matrix.
- Unblocks Zach's 403 handling and Ly's `/users/me/forecast` shape freeze — both can implement against this doc now.

✅ **Lawrence — Fix mobile API base URL** *(PR #82, merged)*
- Production URL now `https://api.sharkpark.app/api/v1` (was the wrong `csulb.edu` subdomain). TestFlight builds will reach prod.
- Env-override (`SHARKPARK_API_URL` in `.env`) now actually loads at runtime — `react-native-dotenv` babel plugin wired up in the same PR, with `apps/mobile/.env.example` template. Physical-device dev: `cp .env.example .env`, set the LAN IP, `pnpm start --reset-cache`.

✅ **Charles — `DELETE /api/v1/users/me` cascade** *(PR #100, merged)*
- Endpoint exists at `apps/backend/src/users/users.controller.ts` (`@Delete('me')`), cascades favorites + audit log per P11.108e. App Store / Play Store privacy questionnaire requirement is satisfied **on the backend**. Mobile UI to call it is still TODO — see Lawrence's list below.

🔴 **Charles — Pre-launch credential rotation** *(do LAST, before store submission)*
- Neon password (`npg_QTZNAxE96jDp`) and R2 token were both pasted in chat history during initial setup — treat as compromised. Rotate both, update GH Actions secrets (`NEON_DATABASE_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) and Fly secrets (`DATABASE_URL`, `DIRECT_URL`, R2 keys), redeploy backend, re-verify cron + backup. Per user mandate this is the very last item before App Store / Play submission.

� **Charles — Marketing site at `sharkpark.app`** *(scaffold landed; deploy + DNS still blocking store submission)*
- ✅ Astro + Tailwind v4 scaffold landed in [`apps/marketing/`](apps/marketing/) with pages: `/`, `/privacy`, `/terms`, `/support`, `/delete-account`, plus `_headers`, `robots.txt`, sitemap, favicon, and both `.well-known/` manifests. Build verified green (5 pages, 1.06s).
- ✅ Deploy workflow at [`.github/workflows/deploy-marketing.yml`](.github/workflows/deploy-marketing.yml) (Cloudflare Pages via wrangler-action, triggered on `apps/marketing/**` changes).
- ✅ All copy explicitly states SharkPark is **independent and not affiliated with CSULB** (hero, footer, privacy §intro, terms §1, support FAQ).
- ⏳ **Cloudflare Pages project** — create project `sharkpark-marketing` in CF dashboard, connect GitHub repo, set build output `apps/marketing/dist` (build command blank — workflow handles it). One-time setup steps in [`apps/marketing/README.md`](apps/marketing/README.md#one-time-cloudflare-pages-setup).
- ⏳ **GitHub Actions secrets** — add `CLOUDFLARE_API_TOKEN` (Pages:Edit scope) and `CLOUDFLARE_ACCOUNT_ID` to repo secrets. Workflow will fail loudly without them (per [development-principles](#) — no graceful skip gates).
- ⏳ **DNS** — point apex `sharkpark.app` (and `www.sharkpark.app`) at the Pages project via custom-domain UI in CF.
- ⏳ **Placeholder swaps** before first production deploy:
  - `TEAMID` → real Apple Team ID in `apps/marketing/public/.well-known/apple-app-site-association` (and keep in sync with `apps/mobile/docs/apple-app-site-association.json` — Lawrence's item)
  - `REPLACE_WITH_RELEASE_KEYSTORE_SHA256_FINGERPRINT` → release keystore fingerprint in `apps/marketing/public/.well-known/assetlinks.json` (Play Console → App integrity → App signing key certificate)
  - `appStoreUrl` / `playStoreUrl` in [`apps/marketing/src/consts.ts`](apps/marketing/src/consts.ts) once listings are live (currently `#`)
- ⏳ **Email routing** — confirm Cloudflare Email Routing is forwarding `support@`, `security@`, and `hello@sharkpark.app` to your real inbox (the site uses `support@` for general help, `security@` for privacy/data requests, `hello@` for press). `postmaster@` and `abuse@` are RFC-mandated and stay internal — not surfaced on the site.
- ⏳ **Mailing address in privacy policy** — some store reviewers require it; placeholder needs swap before submission (currently omitted in `privacy.astro`).

---

# 🟡 Lawrence — Mobile

**High priority**
- 🔴 **Persist `isGuest` across app restarts** *(post-merge finding from PR #127)* — `AuthContext.isGuest` is `useState(false)`, so a user who picks "Continue without account" on first launch is dumped back onto the LoginScreen wall on the next cold start. Add an AsyncStorage flag (mirror the `useOnboarding` pattern: `@SharkPark:isGuest`), hydrate on mount, persist in `continueAsGuest` / `exitGuestMode`. ~30 min.
- 🔴 **Wire `ReportModal.onSubmit` → `POST /reports`** *(unblocked by PR #121)* — endpoint is live. Payload is `{ lotId: string (cuid, NOT 'G2'-style code), type: 'blockage'|'crash'|'other', message?: string }`. Existing modal likely uses `reason`/`comment` — rename to `type`/`message` to match the DTO. Response is `{ id, created_at }`. Throttled 5/min/user, returns 401 for guests (route them to sign-in).
- 🔴 **Replace `TEAMID` placeholder in [`apps/mobile/docs/apple-app-site-association.json`](apps/mobile/docs/apple-app-site-association.json)** — needs the real 10-character Apple Developer Team ID. File then deploys to `https://sharkpark.app/.well-known/apple-app-site-association`.
- 🔴 **Set `DEVELOPMENT_TEAM` in [`apps/mobile/ios/mobile.xcodeproj/project.pbxproj`](apps/mobile/ios/mobile.xcodeproj/project.pbxproj) Release config** — same 10-character Team ID. Without this, archive builds fail with "No signing certificate found" in CI.
- 🔴 **Add `assetlinks.json` for Android App Links** *(post-merge finding from PR #84)* — PR #84 set `android:autoVerify="true"` on the App Links intent filter for `https://sharkpark.app`, but no `assetlinks.json` exists in the repo. Without it deployed at `https://sharkpark.app/.well-known/assetlinks.json`, `autoVerify` silently fails and Android shows the disambiguation dialog. Generate via `keytool -list -v -keystore <release-keystore>` + Google's [Asset Links generator](https://developers.google.com/digital-asset-links/tools/generator). Coordinates with Charles's marketing-site item for hosting.
- **Wire `BG_LOCATION_REQUIRED` 403 handler** — backend already returns this status code with that error string when a guest taps a contributor-gated endpoint. Mobile-side `BackgroundLocationRequiredError` class + interceptor were added in the access-tier audit cluster commit, but the **UX** still TODO: route to a soft-ask screen explaining why background location is needed instead of a generic toast. Two-stage prompt: WhenInUse first, escalate to Always only if user opts into auto-contribute.
- **Force-update screen** — on app launch, call Zach's new `GET /min-version` endpoint. If `currentVersion < minSupportedVersion`, render a blocking screen with a button to the App Store / Play Store.
- **Push notification handling** — once Zach's sender ships: register for FCM/APNs tokens, POST token to backend, render notifications when received, route taps to the right screen (e.g., a `favorites_filling` notification opens the map centered on that lot).
- **Re-audit "4 missing tests" — actual gap is much wider** *(audit 2026-04-30)*. Only `apps/mobile/src/services/__tests__/behavioralDataCollector.test.ts` exists. Untested services include: `locationService`, `leaveDetectionService`, `parkingValidationService`, `carBluetooth`, `sdkConfig`, `headlessTask`, `modeSwitch`, `activityRecognition`, plus every API client (`lots`, `users`, `reliability`, `favorites`, `deviceCredentials`). Pick a coverage floor (suggest 60% on `services/`) and prioritize the API clients + `deviceCredentials` (HMAC signing has a single test vector pinned but no integration test against the actual `apiService`). The 569 mobile tests that pass today are mostly screens/components.

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
- **Resolve `// TODO` in [`apps/mobile/src/services/api/lots.ts`](apps/mobile/src/services/api/lots.ts#L237)** — `position: { x: 0, y: 0 }` is a placeholder for the legacy custom-map UI. PR #120 (Zach's `react-native-maps` migration) replaces this surface entirely; once #120 lands and you rebase, delete the stubbed `position` field rather than carrying it forward.
- **Gate stray `console.log` calls behind `__DEV__`** *(audit 2026-04-30)* — unconditional `console.log` in [`apps/mobile/src/services/locationService.ts`](apps/mobile/src/services/locationService.ts#L75) and [`apps/mobile/src/services/api/favorites.ts`](apps/mobile/src/services/api/favorites.ts#L23). Not PII, but ships noise to release builds. ~5 min.
- **Add `NSPhotoLibraryUsageDescription` to `Info.plist`** *only if* any feature actually touches photos (avatar upload, share-image-of-map, etc.). If no, skip — Apple rejects unused permission strings.
- **Apple App Store submission** — App Store Connect listing, screenshots (6.7" and 6.5" required), privacy nutrition labels (use Zach's data inventory), TestFlight build for review, respond to reviewer questions. Allow 1-2 weeks for review cycles.
- **Google Play submission** — Play Console listing, screenshots (phone + 7"/10" tablet), data safety form (mirror App Store labels), internal testing track first, then closed → open beta → production.
- **Privacy policy + ToS hosting** — content drafted by Zach (data inventory) + Ly (ML disclosures), you host on `sharkpark.app/privacy` and `sharkpark.app/terms`. Both stores will reject without these URLs.
- **Final QA pass + cross-team coordination** — run through the test plan on real iOS + Android devices the week before submission.

---

# 🟡 Zach — Backend Features & Admin

**High priority**
- ✅ ~~`POST /api/v1/reports`~~ — *shipped in PR #121 (see critical path).* Mobile wire-up moved to Lawrence's queue. New `Report` model with `user_id` cascade.
- **Verify reports endpoint actually requires auth** — `ReportsController` has no explicit guard decorator; relies on global guard chain. Add a one-line e2e: anonymous `POST /reports` → 401. ~10 min.
- 🔴 AASA + assetlinks.json hosting (see critical path)
- **`GET /api/v1/min-version`** — trivial endpoint, returns `{ ios: { min: "1.0.0", current: "1.0.0" }, android: { ... } }`. Hardcode for now, move to env or a `MobileVersion` Prisma model later. Lawrence's force-update screen calls this on every app launch. *~30 min.*
- ✅ ~~**`DELETE /api/v1/users/me` cascade**~~ — *shipped by Charles in PR #100.* Cascades favorites + writes audit log (P11.108e). Mobile UI to call it is now on Lawrence's list above. **Note:** does not yet delete `Report` rows — re-visit once `POST /reports` ships and the model exists.
- **Push notification service — split into 2 sub-tickets:**
  - **(a) FCM project + APNs key setup** — one-time. Create Firebase project (free Spark tier), enable Cloud Messaging, generate APNs auth key in Apple Developer portal, upload to Firebase. Store `FIREBASE_SERVER_KEY` + `APNS_KEY_ID` as Fly secrets.
  - **(b) Sender service + token endpoint + trigger crons** — new `NotificationsModule` with `sendPush(userId, payload)` using `firebase-admin`, exported so cron scripts can import it. New `POST /api/v1/users/me/push-token` endpoint to register device tokens (new `PushToken` Prisma model: `userId`, `token`, `platform`, `createdAt`). Trigger crons live in `apps/backend/src/scripts/notify-*.ts` (one file per trigger, follow `snapshot.ts` / `prune-old-data.ts` pattern: `runCronJob` + advisory lock), and each gets a line in `apps/backend/cron/crontab` — **NOT NestJS `@Cron` decorators**, our cron tier is the dedicated Fly `cron` process group. Add a `NotificationLog` model (`userId`, `type`, `lotId?`, `sentAt`) for dedup so a user doesn't get the same alert twice. Triggers (each script runs every 15 min):
    - `notify-favorites-filling.ts` — favorite lot crosses 80% occupancy
    - `notify-favorites-clearing.ts` — favorite lot drops below 30% after being >75%
    - `notify-surge.ts` — campus-wide occupancy spike (any lot >90%)
    - `notify-events.ts` — within 2 hours of a `CampusEvent` start
- **Privacy nutrition data inventory** — single doc (`docs/privacy-data-inventory.md`) listing everything the app collects: device hash (SHA-256, no raw IDs), email (from Azure AD), location (used in-app only, never stored), favorites, reports. For each: where stored, retention window, third parties. Lawrence needs this for the App Store privacy labels questionnaire and Play Store data safety form. *~1-2 hrs of writing.*
- 🔴 **Campus event scraper** *(feeds the nearby-events display/notification surface — see Ly's section. NOT a forecasting input as of 2026-04-30.)* — daily Fly Machine cron script at `apps/backend/src/scripts/scrape-campus-events.ts` that fetches CSULB events and upserts into the existing `CampusEvent` table. **Follow the pattern in `apps/backend/src/scripts/fetch-weather.ts`**: `runCronJob('scrape-campus-events', ...)` from `_bootstrap.ts`, advisory lock via `withAdvisoryLock`, idempotent upsert by `(source_id, start_time)`. Add the schedule line to `apps/backend/cron/crontab` (suggest `0 5 * * *` — daily 5 AM PT, after retention prune). **Do NOT use NestJS `@Cron` decorators** — our entire cron tier runs on the dedicated Fly `cron` process group via supercronic, not in the API process. **Verify a source exists before scoping**: check `https://www.csulb.edu/events` for a JSON feed / RSS / iCal. If only HTML, add a parser (cheerio is already in the tree). The read API for campus events (`GET /api/v1/events`, `GET /api/v1/events/upcoming`) already exists in `apps/backend/src/events/events.controller.ts` — this task is purely the scraper that populates the table. Today the table is empty in prod, so the nearby-events badge is inert.

**Lower priority**
- **Update parking lot metadata** — Neon `lots` table has `id, name, capacity, type, lat, lng` etc. Verify all 28 CSULB lots have correct capacity (CSULB Parking Services PDF), accurate polygons (open `lots.geojson` if it exists in `apps/backend/data/`), and current permit codes. Coordinate with Lawrence if any new fields are needed (e.g., `accessibility_spaces`, `ev_chargers`).
- **Reports/analytics endpoints** — `GET /api/v1/lots/:id/trends?range=7d` returns hourly occupancy averages for the past N days from `occupancy_snapshots`. `GET /api/v1/lots/utilization?range=30d` returns per-lot utilization rates. Useful for the admin dashboard and any future investor/CSULB-Parking demos.
- **Admin dashboard** — either a separate Next.js app under `apps/admin/` or admin-scoped routes mounted at `/admin/*` with a JWT role check (`role: 'admin'` claim). Pages: lot CRUD, report review queue (acknowledge/dismiss reports), reliability score overrides. Probably the biggest single ticket on your list — a week of work — defer until after launch unless you have spare cycles.
- **Audit parking-validation** — `grep -r "@sharkpark/parking-validation" apps/ packages/` — if zero non-self-references, delete the package. If used, add a one-paragraph README so the next person knows what it does. *30 sec check.*
- **GDPR/CCPA data export** — `GET /api/v1/users/me/data` returning JSON of everything tied to the authenticated user (favorites, audit-log rows, push tokens once those exist, reports once those exist). Strictly required if any EU/CA traffic, soft-required for App Store privacy answers. Light lift since we have minimal PII. Pair with the existing `DELETE /users/me` so the privacy section is complete.
- **Backend access-tier follow-ups** *(remaining slices from PR #101)*
  - `GET /api/v1/users/me/forecast` — stack `AzureAdGuard` + `ContributorGuard` (personalized forecast: requires both auth and a recent contributor ping). Spec is in [docs/api-access-tiers.md](docs/api-access-tiers.md).
  - `x-app-mode` header + tier-aware throttler (public 60rpm, contributor 300rpm, authed 600rpm). Today everyone shares the default bucket.
  - Reliability scoring weights — anonymous device 0.3–0.6, authed user 1.0, flagged user 0. Belongs in `apps/backend/src/reliability/reliability.service.ts`.

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
- 🔴 **Scheduled prediction jobs — `predict-all-lots.ts` cron** *(NOT shipped by PR #119 — confirmed)*. PR #119 only added the postprocess module + modified the standalone `predict_short_term.py` script; no Node cron exists yet. **Good news from the 2026-04-30 audit:** [`services/ml/scripts/predict_long_term.py`](services/ml/scripts/predict_long_term.py) already exists, so the cron just needs to invoke both Python scripts — no second script to write. New file at `apps/backend/src/scripts/predict-all-lots.ts` following the same `runCronJob` + `withAdvisoryLock` pattern as `prune-old-data.ts` and `snapshot.ts`. Add schedule line to `apps/backend/cron/crontab` — `*/15 * * * *` aligned with snapshot cron (or 1 min after, e.g. `1-59/15`, so the latest snapshot row is already written when the predictor reads features). **Note:** prediction *granularity* is hourly (per locked contract) but cron *cadence* is every 15 min — the current-hour row gets refreshed 4× per hour as new snapshots arrive, so the mobile "last updated Xm ago" badge stays green and the next-hour estimate sharpens as the hour progresses. Every run: shell out to the Python `predict_short_term.py` and `predict_long_term.py`, which load the active model from R2 (cache to local disk after first call so we don't refetch every 15 min), pull latest features per lot from `occupancy_snapshots`, apply the weather adjustment layer (short-term only today — see long-term gap below), and write predictions to `PredictionShortTerm` and `PredictionLongTerm` tables. Backend's `/users/me/forecast` reads from these tables — no live inference needed. *Currently long-term predictions always fall back to a heuristic because the table is empty. This fixes that.* **Unblocked 2026-05-01:** Python 3.11 + ML venv now in the runtime image (PR #129) and cron VM bumped to 1 GB; Ly is fully unblocked on this item.
- **One-time prediction backfill** — once the cron above is shipped, run it manually to seed `PredictionShortTerm` so the forecast UI has data on day 1 of launch. Single invocation populates the full operating-window (hours 7–21) for every lot, so a one-shot `node predict-all-lots.js` is sufficient — no loop needed.

**Medium priority — all on Fly + Cloudflare R2, no AWS**
*(We're Tier 3: Fly + Neon + Cloudflare. SageMaker and Lambda were carryovers from the old AWS plan and would add $30-100/mo for no benefit at our QPS.)*
- 🔴 **MLflow → R2 export is currently a placeholder** *(audit 2026-04-30)* — [`services/ml/src/utils/mlflow_utils.py`](services/ml/src/utils/mlflow_utils.py#L76-L80) literally logs `"Not implemented yet"` for the `--export-s3` flag. Models are saved to local `./mlruns/` only, so the prediction cron has nothing to pull from R2 even after the cron itself is built. Bucket exists (`sharkpark-ml-exports`) and creds are set, just need to write the upload. Also add `boto3` to [`services/ml/pyproject.toml`](services/ml/pyproject.toml#L7) — only `botocore` is listed today, which is insufficient for the S3 client. Then point the artifact store at the R2 S3-compatible endpoint via `MLFLOW_S3_ENDPOINT_URL`, reuse the same R2 credentials, and use `s3://sharkpark-ml-exports/models/<model-name>/<version>/` as the artifact root. **Order of operations:** ship this *before* the `predict-all-lots.ts` cron, otherwise the cron will hit an empty bucket on first run.
- **Automated retraining — `retrain-models.ts` weekly cron** — new file `apps/backend/src/scripts/retrain-models.ts` with a matching crontab entry. Sundays 3 AM PT (`0 3 * * 0`) — after the 2 AM Sunday backup and before the 4 AM Sunday retention prune. Pulls last N weeks of training data from Neon's `occupancy_snapshots`, shells out via `child_process.spawn` to `python services/ml/src/sharkpark_ml/train.py` (the runtime image will need Python + the ML package — coordinate with Charles on Dockerfile changes), runs `evaluate.py` against persistence baseline, runs `promote.py` if MAE improvement ≥ 5%. Promoted model uploads to R2; next 15-min prediction cron picks it up automatically. **Caveat: XGBoost + pandas can easily exceed our 512MB cron VM. Two options if it OOMs (exit 137):** (a) bump cron VM to 1GB (~+$3/mo, edit `apps/backend/fly.toml [[vm]]` for the cron process group); or (b) run training as an ephemeral one-shot Fly Machine via `fly machine run --rm <image> -a sharkpark-api -g trainer` that scales to zero between weekly runs — Charles can wire this up. Option (b) is cheaper and isolates the heavy load.
- **Model drift monitoring** — track live MAE (predictions vs actual `occupancy_snapshots` 1 hour after prediction window) vs training MAE. **Decide destination first** — easiest is Sentry custom metric (we already have Sentry wired backend-side, just `Sentry.metrics.distribution('ml.live_mae', value, { tags: { model_version }})`). Otherwise create a Better Stack dashboard. Alert if live MAE > 1.5× training MAE for 3 consecutive runs. *(Confirmed not implemented anywhere as of 2026-04-30 audit — no metric emit, no table writes, no comments in either predict script.)*

**Unblocked (was blocked on #121)**
- 🔴 **Feedback → model loop** *(unblocked by PR #121)* — `Report` model + `POST /reports` endpoint are live. Wire report data into reliability scoring: a user reporting "blockage" / "crash" / "other" on a lot should reduce that lot's reliability score (existing weighted formula in `apps/backend/src/reliability/reliability.service.ts`). Anonymous device weight 0.3-0.6, authed user 1.0, repeat-flagged user 0. **Note:** all current reports are authed (NOT NULL `user_id`), so the anonymous weight tier is for future expansion only.

**Blocked on Zach's campus-event scraper**
- � **Nearby-events display + notification surface** *(decision 2026-04-30: replaces the previously-scoped "event-aware forecasting layer". Events are too noisy/sparse to drive accurate per-lot occupancy predictions — we will surface them as context instead, not as a model feature.)*
  - **Backend (~1 hr):** add `GET /api/v1/lots/:id/nearby-events?within_hours=2` returning the count + summary of `CampusEvent` rows whose `affected_lots[]` includes `:id` and whose `start_time` is within the window. Reuse existing `EventsService` query helpers. Public tier (mirrors `/lots`).
  - **Mobile (~2 hr):** badge on lot detail ("3 events nearby — occupancy may be affected") sourced from the new endpoint; tap-through reveals event names + start times. No prediction-pipeline coupling.
  - **Mobile push (~1 hr, post-launch):** when a favorited lot has ≥2 events starting within the next 2 hours, fire a local notification ("Events near <lot> may affect availability"). Throttled to once per lot per day.
  - **Do NOT** wire `CampusEvent` into `predict_short_term.py`, `predict_long_term.py`, or `train.py`. There is no event-impact forecasting in this product — the `EventImpact` model + `ImpactLevel` enum + `/events/:id/impacts` route were removed 2026-04-30. Mobile decides which events are relevant to a given lot via the geographic `nearby-events` query at request time.
  - **Hard-blocked by Zach's campus-event scraper** — table is empty in prod, so the badge is inert until the scraper lands.

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
- **Public status page at `status.sharkpark.app`** — deferred until launch-prep checklist. Better Stack free tier auto-publishes a status page from the `/health/ready` uptime monitor; ~10 min to enable + CNAME + link from marketing footer. No value pre-launch (no users to point at it).
- **Evaluate consolidating uptime onto Sentry Uptime Monitoring** — Sentry now has a GA'd external uptime probe product. If we ever drop the public status page, we can move the `/health/ready` check off Better Stack and kill that vendor entirely. Not worth the migration cost while Better Stack is hosting the status page anyway. Revisit if Better Stack starts charging or status page gets killed.
- **k6 load tests pre-launch** — sustained 600 req/min on `/lots` (matches Cloudflare rate-limit cap) + 5-min spike to 2000 req/min. Verifies single Fly instance survives, validates throttler buckets, surfaces Neon connection-pool ceilings. Skip until other launch-blocking items are clear.
- On-call for any deploy/CI/DB pain anyone hits — ping me in groupchat
- Will pick up Zach's `GET /min-version` if he's slammed (small enough to grab in <1 hr)
- Will help draft privacy policy content once Zach + Ly hand off the data inventory
- Standby to bump cron VM to 1GB or wire up an ephemeral training Machine if Ly hits OOM during retraining

---

# 🔗 Dependency map

```
Zach POST /reports          →  Lawrence ReportModal wire + Ly model loop
Zach AASA hosting           →  Lawrence universal links → App Store submission
Zach GET /min-version       →  Lawrence force-update screen
Zach data inventory         →  Lawrence privacy labels (App Store + Play)
Zach push sender            →  Lawrence push handling
Lawrence access-tiers doc   →  Zach 403 handler + Ly endpoint shape freeze
Lawrence api.config env     →  cross-team prod QA on real devices
Ly forecast shape sync      →  Lawrence forecast UI implementation
Ly prediction cron + back-  →  Lawrence forecast UI shows real data on day 1
   fill
```

# Note on the ML infra choice

We're not using SageMaker or Lambda — both were carryovers from an earlier AWS-centric plan. Tier 3 stack is **Fly + Neon + Cloudflare**, and a `predict-all-lots.ts` cron on our existing always-on Fly cron Machine handles inference for $0 extra. R2 is our model artifact store (already paid for via DB backups). Net cost vs SageMaker: $0–$3/mo vs $30–100/mo, with no new cloud account or IAM setup.

# TL;DR

**Single highest-leverage ticket on the board: Zach's `POST /reports`.** Lawrence and Ly both unblocked simultaneously.

If anyone wants to swap items, flag a blocker I missed, or push back on a priority, feel free to message me.

---

# 🆕 PR review queue snapshot (updated 2026-05-01)

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

**Still open:**
- (No other PRs open as of 2026-05-01.)

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