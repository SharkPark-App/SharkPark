# SharkPark API — Access Tiers

**Audience**: backend, mobile, future integrators (Lawrence: this is the contract for guest-mode routing)
**Status**: implemented in `feat/p11-access-tier-contract`
**Source of truth**: this file. If the implementation diverges, file an issue and update this doc in the same PR.

The reciprocity access model has three tiers. Each tier corresponds to a different set of permissions the device/user has granted, and each endpoint is mapped to exactly one tier. The tier list is closed: every public endpoint belongs to one of these three.

## TL;DR

| Tier            | Required to call                                   | Failure response                                          |
|-----------------|----------------------------------------------------|-----------------------------------------------------------|
| **Public**      | nothing                                            | (always succeeds for valid input)                         |
| **Contributor** | `x-device-id` header + recent `ContributorPing`    | `403 { code: "BG_LOCATION_REQUIRED" }`                    |
| **Authenticated** | Valid Azure AD bearer token (`Authorization`)    | `401 Unauthorized` (no body code; standard Passport flow) |

A few endpoints stack tiers (e.g. *favorites* requires both Authenticated and Contributor in some forecast flows). When tiers stack, **all** of them must pass; any single failure short-circuits with that tier's failure response.

## Why these tiers exist

- **Public** keeps the app usable without any permissions, satisfying Apple App Review 5.1.1 (the reviewer can boot the app and see the campus map without granting location or signing in).
- **Contributor** enforces *reciprocity*: live data is only visible to devices that are themselves contributing data. This solves the cold-start problem (every viewer is also a producer) and gives the background-location ask an immediately-visible benefit.
- **Authenticated** is the price of personalization (favorites, alerts, reports) and is intentionally optional — visitors get the static layer without ever seeing MSAL.

## Endpoint map

### Public (no headers required)

| Method | Path                              | Notes                                |
|--------|-----------------------------------|--------------------------------------|
| `GET`  | `/api/v1/lots`                    | All lots, **static metadata only** for non-contributors. Live-occupancy fields (`current_occupancy`, `available`, `occupancy_rate`, `fill_status`, `estimated_occupancy`, `estimated_available`, `raw_occupancy`, `effective_penetration_rate`) are redacted to `null` unless the caller passes a valid `x-device-id` with a fresh `ContributorPing` — see [Public-with-redaction](#public-with-redaction). `Cache-Control: private, max-age=15`. |
| `GET`  | `/api/v1/lots/:id`                | Single-lot details. Same redaction + cache rules as `/api/v1/lots`. |
| `GET`  | `/api/v1/lots/:id/history`        | Historical occupancy. Public: per-day aggregates, cached 5–10min, no live signal. Same data class as `/occupancy-events/snapshots/:lotId`. (Locked Public 2026-04-29.) |
| `GET`  | `/api/v1/health`                  | Liveness                             |
| `GET`  | `/api/v1/weather/current`         | Current weather (via NWS proxy)         |
| `GET`  | `/api/v1/events`                  | Campus event calendar                |
| `POST` | `/api/v1/occupancy-events`        | Anonymous device contribution. **This is the contribution mechanism that unlocks the Contributor tier.** Server hashes `device_id` and bumps `ContributorPing.last_seen_at` on every successful (or even deduplicated) call. |
| `POST` | `/api/v1/contributor/grant`       | Records a permission-grant grace pass for the calling device. Requires `x-device-id` (no body). Sets `ContributorPing.granted_at = NOW()` so subsequent gated reads succeed for `CONTRIBUTOR_GRANT_TTL_MS` (24h) before any geofence event lands. Solves the cold-start chicken-and-egg without violating Apple App Review 5.1.1. Idempotent. Returns `204`. Throws `403 BG_LOCATION_REQUIRED` if `x-device-id` is missing. |
| `POST` | `/api/v1/contributor/revoke`      | Companion to `/grant`. Mobile calls this immediately when it detects that background-location permission has been revoked (Settings toggle, SDK reports `Denied`). Clears `granted_at` and backdates `last_seen_at` to epoch so neither freshness check passes. Without it, the server would keep serving live data for up to 24h after revocation. Idempotent — returns `204` even if the device was never seen. Missing/empty `x-device-id` is a silent no-op (not an error). |

### Contributor (`x-device-id` header + fresh ping)

| Method | Path                                          | Notes                                       |
|--------|-----------------------------------------------|---------------------------------------------|
| `GET`  | `/api/v1/lots/summary`                        | Live availability badges across all lots    |
| `GET`  | `/api/v1/lots/:id/recommendations`            | Live "try these instead" suggestions        |
| `GET`  | `/api/v1/lots/:id/predictions/short-term`     | Next ~hour forecast                         |
| `GET`  | `/api/v1/lots/:id/predictions/long-term`      | Multi-day forecast                          |

### Authenticated (Azure AD bearer)

| Method     | Path                                       | Notes                              |
|------------|--------------------------------------------|------------------------------------|
| `GET`      | `/api/v1/users/:userId`                    | Own profile only (IDOR-checked)    |
| `GET`      | `/api/v1/users/:userId/favorites`          | Own favorites only                 |
| `POST`     | `/api/v1/users/:userId/favorites/:lotId`   | Add favorite                       |
| `DELETE`   | `/api/v1/users/:userId/favorites/:lotId`   | Remove favorite                    |
| `PATCH`    | `/api/v1/users/:userId/notifications`      | Notification preferences           |
| `DELETE`   | `/api/v1/users/me`                         | Account deletion (P11.108e)        |
| `DELETE`   | `/api/v1/users/:userId`                    | Own account only                   |

## How the Contributor tier works

1. Mobile client generates a stable, opaque `device_id` (UUID, kept in secure storage).
2. On every background-geofence event, mobile POSTs to `/api/v1/occupancy-events` with `{ device_id, lot_id, event_type, timestamp }`.
3. Server hashes `device_id` → `device_hash` (SHA-256 with `DEVICE_HASH_SALT`) and atomically:
   - Upserts `ContributorPing.last_seen_at = NOW()` for that hash (this happens *first*, even if the event is later deduplicated)
   - Records the occupancy event and updates the lot count
4. On every gated read, mobile sends the **same `device_id`** as the `x-device-id` request header.
5. `ContributorGuard` hashes the header value identically and looks up `ContributorPing`. If the row exists and `last_seen_at` is within `CONTRIBUTOR_PING_TTL_MS` (default **30 minutes**), the request passes.

Privacy note: the server only ever sees the hash, not the raw `device_id`. The hash is irreversible, so even if the audit row outlives the device, it carries no PII.

## Failure shapes

### 403 BG_LOCATION_REQUIRED (Contributor tier)

```json
{
  "success": false,
  "statusCode": 403,
  "timestamp": "2026-04-26T22:48:01.123Z",
  "path": "/api/v1/lots/summary",
  "method": "GET",
  "message": "...",
  "code": "BG_LOCATION_REQUIRED"
}
```

The mobile client should inspect `body.code === 'BG_LOCATION_REQUIRED'` and trigger the soft-ask UX, **not** treat this as an unrecoverable error. Three sub-cases all return the same code (the message differs for diagnostics but is not part of the contract):

- Missing `x-device-id` header
- Empty/whitespace `x-device-id`
- `device_id` known but no fresh ping (device offline, app force-quit, location permission revoked)

### 401 Unauthorized (Authenticated tier)

Standard Passport-issued response. No structured `code` field — the mobile client should react by triggering the MSAL sign-in flow.

### 404 Not Found

Public-tier endpoints can still 404 for invalid resource IDs. The 404 is **not** gated; the response shape is the same as for any other 404.

## Recommended mobile soft-ask copy (mirrors the access matrix)

> **See live availability**
> SharkPark uses your phone's parking activity (no foreground tracking) to keep live counts fresh. Grant background location to see live availability and forecasts — and you'll be helping every other shark on campus too.
> [ Not now ] [ Allow background location ]

After grant, the next gated GET should succeed within seconds (the first geofence event will write the ping). If the user denies, the app remains fully functional in the public tier — map, lot details, shuttle, directions all work.

## Tunables (env)

| Var                         | Default        | Effect                                                 |
|-----------------------------|----------------|--------------------------------------------------------|
| `CONTRIBUTOR_PING_TTL_MS`   | `1800000` (30m)| Maximum age of `ContributorPing.last_seen_at` for the guard to allow the request |
| `CONTRIBUTOR_GRANT_TTL_MS`  | `86400000` (24h)| Maximum age of `ContributorPing.granted_at` (set on permission grant) — lets a freshly-granting device read live data even before the first geofence event lands |
| `DEVICE_HASH_SALT`          | required in prod, dev-only fallback | Salt for `SHA-256(salt:device_id)` |

## Public-with-redaction

A subset of Public endpoints (`GET /api/v1/lots`, `GET /api/v1/lots/:id`) return a *partially redacted* payload to non-contributors instead of the full document. The motivation:

- **Apple App Review 5.1.1**: the app must remain usable without granting background location, so the lot map and lot-detail screens cannot 403 — they must always return enough static metadata (name, capacity, coordinates, amenities, hours) for the user to find and choose a lot.
- **Reciprocity**: live occupancy / availability / fill-status are still gated to contributors, exactly like the dedicated Contributor endpoints. Non-contributors see `null` for all eight live fields and a neutral "locked" pin/badge in the mobile UI.
- **No CDN cross-tenanting**: redacted endpoints set `Cache-Control: private, max-age=15` so the Cloudflare edge cannot serve a contributor's response to a non-contributor (or vice versa). We give up shared-cache throughput to guarantee correctness.
- **No cardinality leak**: when redacting, the server also silently drops `available_only` and `min_available` filters (returning the full result set unchanged) — otherwise the size of the response would itself leak which lots have spots. This is graceful degradation, not a 400.

For a non-contributor, the response shape is:

```json
{
  "lot_id": "G1",
  "lot_name": "Lot G1",
  "capacity": 350,
  "center_lat": 27.x,
  "center_lng": -82.x,
  "current_occupancy": null,
  "available": null,
  "occupancy_rate": null,
  "fill_status": null,
  "estimated_occupancy": null,
  "estimated_available": null,
  "raw_occupancy": null,
  "effective_penetration_rate": null
}
```

For a contributor (valid `x-device-id` + fresh ping or grant), every field is populated as before.

## Test coverage

- **Unit**: `apps/backend/src/auth/contributor.guard.spec.ts` — missing header, empty header, unknown device, stale ping, fresh ping, TTL override, array header.
- **E2E** (`apps/backend/test/lots.e2e-spec.ts`):
  - `ACCESS-1`: public endpoints succeed with no headers
  - `ACCESS-2`: gated endpoints return `403 BG_LOCATION_REQUIRED` without a fresh ping; succeed with one

When changing the access tier of any endpoint, update both the table above and the matching test block — the tests are the executable contract.

---

## Current state vs spec — audit (2026-04-29, Charles)

Audit method: `grep` every `@Controller`/`@Public`/`@UseGuards`/`@Get|Post|Put|Patch|Delete` decorator in `apps/backend/src/**/*.controller.ts`, cross-reference against the endpoint map above. Global guard is `AzureAdGuard` (`app.module.ts:89`), so **no decorator = Authenticated**.

### How the decorators map to tiers

| Decorator combo on a route                         | Effective tier              |
|----------------------------------------------------|-----------------------------|
| (no decorator, no `@UseGuards`)                    | Authenticated               |
| `@Public()` only                                   | Public                      |
| `@Public()` + `@UseGuards(ContributorGuard)`       | Contributor                 |
| `@Public()` + `@UseGuards(HmacGuard)`              | Public + signed body        |
| `@UseGuards(ContributorGuard)` only (no `@Public`) | Authenticated + Contributor *(stacked — used nowhere today)* |

### Endpoints implemented but **not in the spec table** (must add or remove)

| Method | Path                                       | Code tier   | Recommendation |
|--------|--------------------------------------------|-------------|----------------|
| `GET`  | `/api/v1/events/upcoming`                  | Public      | **Add to Public table.** Used by mobile event banner. Same data as `/events` filtered by time window. |
| `GET`  | `/api/v1/weather/impact`                   | Public      | **Add to Public table.** Heuristic weather→occupancy multiplier; no PII, no live counts. |
| `GET`  | `/api/v1/reliability/lots/:lotId`          | Public      | **Add to Public table.** Static-ish per-lot reliability score, derived from history. |
| `GET`  | `/api/v1/reliability/lots`                 | Public      | **Add to Public table.** Bulk version of the above. |
| `GET`  | `/api/v1/reliability/config`               | Public      | **Add to Public table.** Returns scoring weights — config, not user data. |
| `GET`  | `/api/v1/occupancy-events/lots/:lotId`     | **Contributor** ✅ | **Fixed 2026-04-29.** Now `@UseGuards(ContributorGuard)`. Returns the recent raw event stream for a lot — same live-availability signal `/lots/summary` is gated on, so it sits behind the same reciprocity gate. |
| `GET`  | `/api/v1/occupancy-events/lots/:lotId/stats` | Public    | Acceptable as Public if it returns aggregates only (counts/averages, not per-event rows). **Verify the response shape.** |
| `GET`  | `/api/v1/occupancy-events/snapshots/:lotId`  | Public    | Same data class as `/lots/:id/history` — keep aligned with whatever decision is made there. |
| `GET`  | `/api/v1/health/live`, `/health/ready`     | Public      | **Add to Public table** as a footnote. Fly/k8s probes; not user-facing. |
| `GET`  | `/api/v1/health` (legacy alias)            | Public      | **Fixed 2026-04-29.** Duplicate `AppController.health` deleted; `HealthController` is now the sole owner of `/health`, `/health/live`, `/health/ready`. |

### Endpoints in the spec table but **not in the code**

_None as of 2026-04-30._ Previously listed `/api/v1/events/:id` was struck from the spec on 2026-04-29 (no handler, no mobile caller). `/api/v1/events/:id/impacts` was removed entirely on 2026-04-30 along with the `EventImpact` model — events are a display/notification surface, not a forecasting layer.

### Endpoints in spec **and** in code, tier matches ✅

| Path                                          | Spec tier     | Code tier     |
|-----------------------------------------------|---------------|---------------|
| `GET /lots`, `/lots/:id`, `/lots/:id/history` | Public        | Public ✅      |
| `GET /weather/current`                        | Public        | Public ✅      |
| `GET /events`                                 | Public        | Public ✅      |
| `POST /occupancy-events`                      | Public + HMAC | Public + HMAC ✅ |
| `GET /lots/summary`                           | Contributor   | Contributor ✅ |
| `GET /lots/:id/recommendations`               | Contributor   | Contributor ✅ |
| `GET /lots/:id/predictions/short-term`        | Contributor   | Contributor ✅ |
| `GET /lots/:id/predictions/long-term`         | Contributor   | Contributor ✅ |
| `GET /users/:userId` (+ favorites, notifications, deletes) | Authenticated | Authenticated ✅ (global guard, no `@Public`) — also IDOR-checked via `assertOwner` |
| `DELETE /users/me`                            | Authenticated | Authenticated ✅ |
| `POST /reports`                               | Authenticated | Authenticated ✅ — enforced by global `AzureAdGuard`. Anonymous-POST coverage asserted in `apps/backend/test/app.e2e-spec.ts` (2026-04-29). |

### Open decisions surfaced by this audit

_All resolved 2026-04-29._

1. ~~`/lots/:id/history` tier~~ — ✅ **Resolved**: locked Public. Cached aggregates, not a live signal; same call applies to `/occupancy-events/snapshots/:lotId`.
2. ~~`/occupancy-events/lots/:lotId` tier~~ — ✅ **Resolved**: moved to Contributor.
3. ~~Duplicate health endpoint~~ — ✅ **Resolved**: `AppController` + `AppService` deleted; `HealthController` is sole owner.
4. ~~Spec drift on `/events/:id`~~ — ✅ **Resolved**: struck from spec.
5. ~~Anonymous-POST coverage gap on `POST /reports`~~ — ✅ **Resolved**: `app.e2e-spec.ts` now asserts anonymous `POST /reports` returns 401 via the global `AzureAdGuard`.

### What this audit does **not** cover (next slices)

- Mobile-side audit (`apps/mobile/src/services/api/*` → tier per call → guest-mode behavior on 401/403). Tracked as a separate `TODO.md` line.
- ACCESS-3 / ACCESS-4 e2e tests. Tracked separately.
- Whether ContributorGuard's HMAC counterpart `HmacGuard` is in permissive or strict mode in prod. Today it is **permissive when `DEVICE_EVENT_SECRET` is unset** — confirmed. Setting the secret in Fly is on the urgent list.
