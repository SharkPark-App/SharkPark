# SharkPark Mobile

The SharkPark mobile app: a React Native client that shows real-time CSULB
parking-lot occupancy, short- and long-term forecasts, and contributes
anonymous device-presence signals back to the backend to keep the live tile
accurate.

For project-wide context (architecture, services, data flow) see the
[repository README](../../README.md).

## Quick start

This app is part of the SharkPark monorepo and depends on workspace packages
(`@sharkpark/types`, `@sharkpark/utils`). Always install from the repo root:

```bash
# from repo root
pnpm install

# then, from this directory
pnpm ios       # iOS simulator (runs `pod install` automatically via postinstall)
pnpm android   # Android emulator
pnpm start     # Metro bundler only (pair with a connected device/emulator)
```

The backend must be reachable. By default the API base URL is resolved per
platform:

| Platform | Default base URL |
|----------|------------------|
| iOS simulator | `http://localhost:3000` |
| Android emulator | `http://10.0.2.2:3000` |
| Physical device (dev) | LAN IP (set via `API_BASE_URL` env or `src/services/api/config.ts`) |
| Production | `https://api.sharkpark.app` |

## Tech stack

- React Native 0.85.2, React 19.2.3
- React Navigation 7 (`@react-navigation/native`, `bottom-tabs`, `stack`)
- `react-native-maps` for the campus map
- `react-native-app-auth` for Azure AD SSO (PKCE)
- `react-native-keychain` for secure token storage
- `react-native-background-geolocation` for opt-in presence telemetry
- `@react-native-firebase/messaging` + `@notifee` for push notifications
- `socket.io-client` for the real-time `/shuttles` WebSocket namespace
- `@sentry/react-native` for crash + performance monitoring

## Architecture

### Where mobile fits in the system

This app is one of three runtimes in the SharkPark monorepo. The
[root README](../../README.md#how-the-pieces-connect) has the full
end-to-end picture; the short version from the mobile side is:

- **What we send up:** anonymous geofence ENTER/EXIT events to
  `POST /api/v1/occupancy-events` (HMAC-signed with `DEVICE_EVENT_SECRET`),
  plus an FCM push token to `POST /api/v1/users/me/push-token`.
- **What we read down:** lot list + live occupancy from `/lots`, ML
  predictions from `/lots/:id/predictions/{short,long}-term` (tagged
  `source: 'ml' | 'heuristic'`), live shuttles from the `/shuttles`
  socket.io namespace, weather/event impact from `/weather/*` and
  `/events/*`, and the version floor from `/min-version`.
- **What we never send:** raw GPS coordinates or anything that could
  identify the user. The polygon ray-cast happens **on-device** and only
  the lot ID + an opaque per-install UUID leave the phone.

### Provider hierarchy (top of `App.tsx`)

```
SafeAreaProvider
  └─ ThemeProvider          // colors, dark/light mode
     └─ AuthProvider         // Azure AD SSO state, JWT refresh
        └─ EnhancedGeofencingProvider  // opt-in presence detection + parking validation
           └─ NavigationContainer
              └─ Root navigator
```

### Screens (`src/screens/`)

| Screen | Purpose |
|--------|---------|
| `MapScreen` | Live campus map with per-lot occupancy pins and shuttle overlay |
| `ShortTermForecastScreen` | Next few hours of occupancy with confidence band; shows ML vs heuristic source badge |
| `LongTermForecastScreen` | Multi-day forecast with calendar awareness |
| `ProfileScreen` | Account, push-notification toggle, data export, sign-out |
| `LoginScreen` | Azure AD SSO entry |
| `OnboardingScreen` | First-run feature tour |
| `PermissionGateScreen` | Aggregates required permission prompts |
| `LocationPermissionScreen` | Background-location explainer + request |
| `ForceUpdateScreen` | Blocks the app when below the backend's minimum supported version |

### API client (`src/services/api/`, `src/services/api/config.ts`)

Thin `axios`/`fetch` wrappers that:

- Resolve the base URL per platform (see table above).
- Inject the Azure AD access token from Keychain on every authenticated request.
- Surface backend's `source: 'ml' | 'heuristic'` field on `/predictions` responses
  so forecast screens can render a small badge indicating whether the user is
  seeing an ML-backed prediction or the time-of-day heuristic fallback.

### Auth (`src/auth/`)

Azure AD SSO via `react-native-app-auth` with PKCE. Tokens are stored in the
device Keychain. The backend (`apps/backend`) validates these JWTs with the
Passport Azure AD strategy using JWKS — the mobile app never sees client
secrets.

### Geofencing (`src/utils/geofencing/`, `src/context/EnhancedGeofencingProvider.tsx`)

- Opt-in: requires the user to grant background-location and accept the
  presence-collection consent in onboarding.
- Uses `react-native-background-geolocation` to receive coarse location updates.
- A pure-TypeScript ray-casting algorithm tests whether the device sits inside a
  lot polygon (the polygons are served by the backend, not embedded).
- Each transition (enter/exit) is sent to the backend as an HMAC-signed event
  keyed by an anonymous per-install UUID. The backend salts and SHA-256-hashes
  the UUID server-side (`DEVICE_HASH_SALT`) before persisting — the raw UUID
  never lands in the database.

### Force-update gate

On launch, the app calls `GET /api/v1/min-version`. If the installed build is
below the returned floor, navigation is locked to `ForceUpdateScreen` until the
user updates from the App Store / Play Store. This lets the backend retire
clients with bad behavior (e.g. a buggy presence-event sender) without waiting
for organic updates.

### Push notifications

FCM token is obtained via `@react-native-firebase/messaging` and registered
with the backend through `POST /api/v1/users/me/push-token`. Users can revoke
from `ProfileScreen` (which calls `DELETE /api/v1/users/me/push-token`).

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm ios` | Build & launch on the iOS simulator |
| `pnpm android` | Build & launch on an Android emulator/device |
| `pnpm start` / `pnpm dev` | Metro bundler |
| `pnpm test` | Jest test suite (824 tests / 73 suites) |
| `pnpm test:hygiene` | Jest with `--runInBand --detectOpenHandles` for CI |
| `pnpm lint` | ESLint (flat config) |
| `pnpm typecheck` | `tsc --noEmit` |

A `postinstall` hook runs `pod install` automatically on macOS unless `$CI` is
set. To force a clean reinstall:

```bash
cd ios && pod deintegrate && pod install && cd ..
```

## Testing

Jest + React Native Testing Library. Tests live in `__tests__/`. Native
modules and platform-specific APIs are mocked under `__mocks__/`
(`react-native-background-geolocation`, `@react-native-community/*`, image
files via `fileMock.js`).

## Local dev requirements

- Node 22+ and pnpm 10.20.0 (managed at the repo root via `packageManager`).
- Xcode 16+ with iOS 17 SDK.
- Android Studio with API level 35 build tools.
- Ruby pinned to 3.3.11 (see [`.ruby-version`](.ruby-version)) for CocoaPods.
  macOS system Ruby is too old; use `rbenv` or `asdf`.
- Run the backend locally first (`pnpm --filter backend start:dev` from the
  repo root) so the app has something to talk to.

## Troubleshooting

- **`pod install` fails with Ruby errors** — your shell is using system Ruby.
  Install Ruby 3.3.11 via `rbenv install 3.3.11 && rbenv local 3.3.11`.
- **Android emulator can't reach the backend** — the emulator host alias is
  `10.0.2.2`, not `localhost`. This is already handled by `src/services/api/config.ts`.
- **Forecast screen shows "heuristic" badge** — backend has not returned an
  ML-backed forecast for that lot (cold-start window, ML job has not yet run,
  or upstream failure). Check backend logs / Sentry. This is expected during
  the cold-start phase described in [`services/ml/README.md`](../../services/ml/README.md).
- **Sign-in opens then immediately bounces** — usually a JWT clock-skew issue
  or the backend cannot reach Azure AD JWKS. Verify backend `AZURE_AD_*`
  environment variables.
