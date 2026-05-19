/**
 * Geographic Helpers
 *
 * Pure, stateless utility functions for distance calculations and campus
 * proximity checks.
 *
 * Note: user-type classification (formerly `classifyUser`) was removed when
 * the access-tier model landed — geofence registration is device-based, not
 * user-based, so the mobile app no longer needs to classify users at all.
 * The backend retains a `user_type` column for audit metadata only.
 */

import { NativeModules, Platform } from 'react-native';
import * as RNLocalize from 'react-native-localize';
import { DYNAMIC_GEOFENCE, TEST_CONSTANTS } from '../constants/geofencing';

// Regions that use imperial units for road/short distances.
// US, Liberia, Myanmar are fully imperial; UK uses miles for road distances.
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM', 'GB']);

// Regions that report temperature in Fahrenheit for everyday weather.
// The UK is metric for temperature (uses Celsius) despite using miles for
// road distance, so it's intentionally NOT in this set even though it's in
// IMPERIAL_REGIONS. Caribbean/Pacific micro-states that follow US convention
// are included so visitors see units that match their phone's weather app.
const FAHRENHEIT_REGIONS = new Set([
  'US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH', 'PR',
]);

/**
 * Best-effort detection of the device's BCP-47 locale (e.g. "en-US", "fr-FR").
 *
 * Uses `react-native-localize`, whose native bridge re-reads the system value
 * on every call. The older approach of reading `NativeModules.SettingsManager
 * .settings.AppleLocale` was a constant snapshot captured at bridge init, so
 * it never reflected a region change made while the app was suspended.
 * Falls back to the legacy snapshot, then to "en-US" if neither is available.
 */
export function getDeviceLocale(): string {
  try {
    const tags = RNLocalize.getLocales();
    if (tags.length > 0) return tags[0].languageTag;
  } catch {
    // Fall through to legacy snapshot.
  }
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings;
      return (
        settings?.AppleLocale ||
        settings?.AppleLanguages?.[0] ||
        'en-US'
      );
    }
    return NativeModules.I18nManager?.localeIdentifier || 'en-US';
  } catch {
    return 'en-US';
  }
}

/** True when the device locale's region uses imperial distance units. */
export function usesImperialUnits(locale: string = getDeviceLocale()): boolean {
  // iOS exposes a "Measurement System" toggle (Settings → General → Language &
  // Region → Measurement System) that is independent of the region code — a
  // US user can flip to Metric without changing their region to e.g. France.
  // `RNLocalize.usesMetricSystem()` reads this live on every call, so prefer
  // it over region inference. We invert it for the imperial check.
  // On Android (no system-wide toggle) the library derives the value from the
  // locale, which matches our region-based fallback.
  try {
    return !RNLocalize.usesMetricSystem();
  } catch {
    // Fall through to locale-region inference.
  }
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  return region ? IMPERIAL_REGIONS.has(region) : false;
}

/** True when the device locale's region reports temperature in Fahrenheit. */
export function usesFahrenheit(locale: string = getDeviceLocale()): boolean {
  // `react-native-localize` exposes a live read of the user's preferred
  // temperature unit. On iOS it reflects Settings → General → Language & Region
  // → Temperature (independent of region). On Android it derives from locale
  // since the OS has no system-wide temperature toggle. This is preferred over
  // `NativeModules.SettingsManager.settings.AppleTemperatureUnit`, which is a
  // constant snapshot taken at bridge init and never updates without an app
  // restart.
  try {
    const unit = RNLocalize.getTemperatureUnit();
    if (unit === 'fahrenheit') return true;
    if (unit === 'celsius') return false;
  } catch {
    // Fall through to locale-region inference.
  }
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  return region ? FAHRENHEIT_REGIONS.has(region) : false;
}

/**
 * Format a temperature value (always supplied in Fahrenheit from the backend)
 * for display, using the device's locale to pick the unit. Examples:
 *   formatTemperature(72)  → "72°F" (US) or "22°C" (everywhere else)
 *   formatTemperature(32)  → "32°F" (US) or  "0°C"
 *
 * Pass `withUnit: false` to get just the number (e.g. for hourly strips where
 * the unit is implied by a header or repeated cells).
 */
export function formatTemperature(
  fahrenheit: number,
  options: { withUnit?: boolean; locale?: string } = {},
): string {
  const { withUnit = true, locale } = options;
  if (usesFahrenheit(locale)) {
    return withUnit ? `${Math.round(fahrenheit)}°F` : `${Math.round(fahrenheit)}°`;
  }
  const celsius = ((fahrenheit - 32) * 5) / 9;
  return withUnit ? `${Math.round(celsius)}°C` : `${Math.round(celsius)}°`;
}

/**
 * Format a distance in metres for display, using the device's locale to pick
 * miles/feet vs. kilometres/metres. Examples:
 *   formatDistance(45)    → "150 ft"   (imperial) or "50 m"   (metric)
 *   formatDistance(800)   → "0.5 mi"   (imperial) or "800 m"  (metric)
 *   formatDistance(5400)  → "3.4 mi"   (imperial) or "5.4 km" (metric)
 */
export function formatDistance(meters: number, locale?: string): string {
  if (usesImperialUnits(locale)) {
    const miles = meters / 1609.344;
    if (miles < 0.1) {
      // Round feet to the nearest 10 for a less jittery readout.
      const feet = Math.round((meters * 3.28084) / 10) * 10;
      return `${feet} ft`;
    }
    return `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Haversine distance in meters between two lat/lng points. */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Check whether E-lots are currently available to students.
 *
 * Rules:
 *   - Saturday & Sunday → always open (students can park in E-lots all day)
 *   - Weekdays          → open after 5:30 PM
 */
export function isAfterELotOpen(now: Date = new Date()): boolean {
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return true;

  const h = now.getHours();
  const m = now.getMinutes();
  return (
    h > DYNAMIC_GEOFENCE.E_LOT_OPEN_HOUR ||
    (h === DYNAMIC_GEOFENCE.E_LOT_OPEN_HOUR && m >= DYNAMIC_GEOFENCE.E_LOT_OPEN_MINUTE)
  );
}

/** Check if a position is within CAMPUS_RADIUS of CSULB center. */
export function isOnCampus(
  lat: number,
  lng: number,
): boolean {
  const d = haversineDistance(
    lat, lng,
    TEST_CONSTANTS.CSULB_CENTER.latitude,
    TEST_CONSTANTS.CSULB_CENTER.longitude,
  );
  return d <= DYNAMIC_GEOFENCE.CAMPUS_RADIUS;
}
