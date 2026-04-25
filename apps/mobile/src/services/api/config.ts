import { Platform } from 'react-native';

/**
 * API Configuration for SharkPark Mobile App
 *
 * URL resolution priority (highest → lowest):
 *   1. SHARKPARK_API_URL  — set this in a .env file at the repo root for local dev
 *                           (e.g. SHARKPARK_API_URL=http://192.168.1.42:3000/api/v1)
 *   2. Platform defaults  — Android emulator 10.0.2.2, iOS simulator localhost
 *   3. Production URL     — used automatically in release builds (!__DEV__)
 *
 * For physical-device development:
 *   echo "SHARKPARK_API_URL=http://<your-machine-ip>:3000/api/v1" >> .env
 */

// react-native-dotenv (or babel-plugin-transform-inline-environment-variables)
// exposes process.env at build time. Falls back to undefined if not configured.
declare const process: { env: Record<string, string | undefined> };

const getApiBaseUrl = (): string => {
  // 1. Explicit override (works for both simulator and physical device)
  const envOverride = process?.env?.SHARKPARK_API_URL;
  if (envOverride) return envOverride;

  // 2. Production build
  if (!__DEV__) {
    return 'https://api.sharkpark.csulb.edu/api/v1';
  }

  // 3. Development platform defaults
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000/api/v1';
  }

  // iOS simulator — localhost routes correctly
  return 'http://localhost:3000/api/v1';
};

export const API_CONFIG = {
  // Base URL for the backend API
  BASE_URL: getApiBaseUrl(),

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
    OCCUPANCY_EVENTS: '/occupancy-events',
    USERS: '/users',
    WEATHER: '/weather',
    EVENTS: '/events',
    // Auth / verification
    AUTH_VERIFY_EMAIL: '/auth/verify-email',
    AUTH_RESEND_VERIFICATION: '/auth/resend-verification',
  },

  // Default headers for all requests
  DEFAULT_HEADERS: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
};

export default API_CONFIG;
