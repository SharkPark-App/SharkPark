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
| `GET`  | `/api/v1/lots`                    | All lots, static metadata + last-known occupancy snapshot |
| `GET`  | `/api/v1/lots/:id`                | Single-lot details                   |
| `GET`  | `/api/v1/lots/:id/history`        | Historical occupancy (debatable; currently public — revisit if abused) |
| `GET`  | `/api/v1/health`                  | Liveness                             |
| `GET`  | `/api/v1/weather/current`         | Current weather (via OpenWeather proxy) |
| `GET`  | `/api/v1/events`                  | Campus event calendar                |
| `GET`  | `/api/v1/events/:id`              | Single event                         |
| `GET`  | `/api/v1/events/:id/impacts`      | Per-event lot impact estimates       |
| `POST` | `/api/v1/occupancy-events`        | Anonymous device contribution. **This is the contribution mechanism that unlocks the Contributor tier.** Server hashes `device_id` and bumps `ContributorPing.last_seen_at` on every successful (or even deduplicated) call. |

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
| `DEVICE_HASH_SALT`          | required in prod, dev-only fallback | Salt for `SHA-256(salt:device_id)` |

## Test coverage

- **Unit**: `apps/backend/src/auth/contributor.guard.spec.ts` — missing header, empty header, unknown device, stale ping, fresh ping, TTL override, array header.
- **E2E** (`apps/backend/test/lots.e2e-spec.ts`):
  - `ACCESS-1`: public endpoints succeed with no headers
  - `ACCESS-2`: gated endpoints return `403 BG_LOCATION_REQUIRED` without a fresh ping; succeed with one

When changing the access tier of any endpoint, update both the table above and the matching test block — the tests are the executable contract.
