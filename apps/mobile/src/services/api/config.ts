import { Platform } from 'react-native';
import { SHARKPARK_API_URL, WS_CONNECT_SECRET } from '@env';

/**
 * API Configuration for SharkPark Mobile App
 *
 * URL resolution priority (highest → lowest):
 *   1. SHARKPARK_API_URL  — set in apps/mobile/.env (see .env.example).
 *                           Inlined into the JS bundle at build time by
 *                           react-native-dotenv (see babel.config.js). After
 *                           changing .env, restart Metro with --reset-cache.
 *   2. Platform defaults  — Android emulator 10.0.2.2, iOS simulator localhost
 *   3. Production URL     — used automatically in release builds (!__DEV__)
 *
 * For physical-device development:
 *   cp apps/mobile/.env.example apps/mobile/.env
 *   # then edit .env to point SHARKPARK_API_URL at your machine's LAN IP
 */

const getOrigin = (url: string): string => {
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : url;
};

const getApiBaseUrl = (): string => {
  // 1. Explicit override (works for both simulator and physical device)
  if (SHARKPARK_API_URL) return SHARKPARK_API_URL;

  // 2. Production build
  if (!__DEV__) {
    return 'https://api.sharkpark.app/api/v1';
  }

  // 3. Development platform defaults
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000/api/v1';
  }

  // iOS simulator — localhost routes correctly
  return 'http://localhost:3000/api/v1';
};

const _baseUrl = getApiBaseUrl();

export const API_CONFIG = {
  // Base URL for the backend API
  BASE_URL: _baseUrl,
  SOCKET_ORIGIN: getOrigin(_baseUrl),
  SOCKET_PATH: '/api/v1/socket.io/',
  WS_SECRET: WS_CONNECT_SECRET ?? '',

  TIMEOUT: 30000,

  // API endpoints
  ENDPOINTS: {
    LOTS: '/lots',
    LOTS_SUMMARY: '/lots/summary',
    LOT_DETAILS: (id: string) => `/lots/${id}`,
    LOT_HISTORY: (id: string) => `/lots/${id}/history`,
    LOT_RECOMMENDATIONS: (id: string) => `/lots/${id}/recommendations`,
    LOT_PREDICTIONS_SHORT: (id: string) => `/lots/${id}/predictions/short-term`,
    LOT_PREDICTIONS_LONG: (id: string) => `/lots/${id}/predictions/long-term`,
    TRANSIT_SHUTTLES: '/transit/shuttles',
    TRANSIT_ROUTES: '/transit/routes',
    TRANSIT_STOPS: '/transit/stops',
    TRANSIT_ETAS: (id: string) => `/transit/etas/${id}`,
    OCCUPANCY_EVENTS: '/occupancy-events',
    CONTRIBUTOR_GRANT: '/contributor/grant',
    CONTRIBUTOR_REVOKE: '/contributor/revoke',
    USERS: '/users',
    WEATHER: '/weather',
    EVENTS_FOR_LOT: (lotId: string) => `/events/for-lot/${lotId}`,
    LOT_NEARBY_EVENTS: (lotId: string) => `/lots/${lotId}/nearby-events`,
    PERMIT_FEES: '/permit-fees',
  },

  // Default headers for all requests.
  //
  // `x-platform` is read by the backend `MinVersionController` to pick a
  // per-platform force-update floor (`MIN_SUPPORTED_APP_VERSION_IOS` /
  // `_ANDROID`). It also doubles as a useful breadcrumb for log filtering
  // on every other endpoint. `Platform.OS` returns 'ios' | 'android' on
  // mobile builds; on the rare web/dev path it falls back to a string the
  // backend treats as "unknown" and resolves to the global floor.
  DEFAULT_HEADERS: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-platform': Platform.OS,
  },
};

export default API_CONFIG;