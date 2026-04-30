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

import { DYNAMIC_GEOFENCE, TEST_CONSTANTS } from '../constants/geofencing';

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
