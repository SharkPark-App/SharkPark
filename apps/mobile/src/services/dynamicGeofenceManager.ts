/**
 * Dynamic Geofence Manager
 *
 * Manages the 20-slot OS geofence budget by splitting it into:
 *   - **Guaranteed set** — lots the user can always park in, loaded immediately.
 *   - **Dynamic set**   — nearest lots from the other type, filled by GPS
 *                          proximity and recalculated when the user moves >300 m.
 *
 * Allocation:
 *   Students  → 16 G-lots guaranteed.  After 5:30 PM, 4 nearest E-lots dynamic.
 *   Employees → 12 E-lots guaranteed.  8 nearest G-lots dynamic (always).
 *
 * The map filter is visual-only — it does NOT affect geofence registration.
 */

import { ParkingLotResponse } from './api/lots';
import { DYNAMIC_GEOFENCE, TEST_CONSTANTS } from '../constants/geofencing';

// ── Types ────────────────────────────────────────────────────────────────────

export type UserType = 'STUDENT' | 'EMPLOYEE' | 'UNKNOWN';

export interface GeofenceAllocation {
  guaranteed: ParkingLotResponse[];
  dynamic: ParkingLotResponse[];
  all: ParkingLotResponse[];           // guaranteed + dynamic (≤20)
  userType: UserType;
  isAfterELotOpen: boolean;
  dynamicSlotsUsed: number;
  dynamicSlotsAvailable: number;
}

export interface DynamicGeofenceState {
  lastCalculationPosition: { latitude: number; longitude: number } | null;
  lastOdometer: number | null;
  currentAllocation: GeofenceAllocation | null;
  isOnCampus: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classify a CSULB email into STUDENT / EMPLOYEE / UNKNOWN. */
export function classifyUser(email: string): UserType {
  if (email.endsWith('@student.csulb.edu')) return 'STUDENT';
  if (email.endsWith('@csulb.edu')) return 'EMPLOYEE';
  return 'UNKNOWN';
}

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

/**
 * Sort lots by Haversine distance to a reference point (ascending).
 * Returns a new array — does not mutate the input.
 */
function sortByProximity(
  lots: ParkingLotResponse[],
  lat: number,
  lng: number,
): ParkingLotResponse[] {
  return [...lots].sort((a, b) => {
    const dA = haversineDistance(lat, lng, a.center_lat, a.center_lng);
    const dB = haversineDistance(lat, lng, b.center_lat, b.center_lng);
    return dA - dB;
  });
}

// ── Manager Class ────────────────────────────────────────────────────────────

class DynamicGeofenceManager {
  private state: DynamicGeofenceState = {
    lastCalculationPosition: null,
    lastOdometer: null,
    currentAllocation: null,
    isOnCampus: false,
  };

  /**
   * Compute the full geofence set (guaranteed + dynamic).
   *
   * @param allLots   All lots from the API.
   * @param email     The authenticated user's email.
   * @param position  Current GPS position; `null` if not yet available.
   * @param now       Optional Date override for testing.
   * @returns         GeofenceAllocation with ≤20 lots.
   */
  computeGeofenceSet(
    allLots: ParkingLotResponse[],
    email: string,
    position: { latitude: number; longitude: number } | null,
    now?: Date,
    odometer?: number,
  ): GeofenceAllocation {
    const userType = classifyUser(email);

    if (userType === 'UNKNOWN') {
      return this.emptyAllocation(userType, now);
    }

    const gLots = allLots.filter(l => l.lot_type === 'STUDENT');
    const eLots = allLots.filter(l => l.lot_type === 'EMPLOYEE');
    const afterELot = isAfterELotOpen(now);

    let guaranteed: ParkingLotResponse[];
    let dynamicPool: ParkingLotResponse[];
    let dynamicSlots: number;

    if (userType === 'STUDENT') {
      guaranteed = gLots.slice(0, DYNAMIC_GEOFENCE.STUDENT_GUARANTEED_SLOTS);
      // Dynamic E-lots only available after 5:30 PM
      dynamicPool = afterELot ? eLots : [];
      dynamicSlots = afterELot ? DYNAMIC_GEOFENCE.STUDENT_DYNAMIC_SLOTS : 0;
    } else {
      // EMPLOYEE
      guaranteed = eLots.slice(0, DYNAMIC_GEOFENCE.EMPLOYEE_GUARANTEED_SLOTS);
      dynamicPool = gLots;
      dynamicSlots = DYNAMIC_GEOFENCE.EMPLOYEE_DYNAMIC_SLOTS;
    }

    // Dynamic: sort by proximity if position available AND on campus
    let dynamicLots: ParkingLotResponse[];
    const onCampus = position ? isOnCampus(position.latitude, position.longitude) : false;

    if (position && onCampus && dynamicPool.length > 0) {
      dynamicLots = sortByProximity(dynamicPool, position.latitude, position.longitude)
        .slice(0, dynamicSlots);
    } else if (dynamicPool.length > 0) {
      // Off-campus or no GPS yet — use first N from pool (API default order)
      dynamicLots = dynamicPool.slice(0, dynamicSlots);
    } else {
      dynamicLots = [];
    }

    // Safety cap at 20
    const all = [...guaranteed, ...dynamicLots].slice(0, 20);

    const allocation: GeofenceAllocation = {
      guaranteed,
      dynamic: dynamicLots,
      all,
      userType,
      isAfterELotOpen: afterELot,
      dynamicSlotsUsed: dynamicLots.length,
      dynamicSlotsAvailable: dynamicSlots,
    };

    // Persist state for movement-threshold checks
    if (position) {
      this.state.lastCalculationPosition = { ...position };
    }
    if (odometer !== undefined) {
      this.state.lastOdometer = odometer;
    }
    this.state.currentAllocation = allocation;
    this.state.isOnCampus = onCampus;

    return allocation;
  }

  /**
   * Determine whether the dynamic slots should be recalculated.
   *
   * Uses the SDK's Kalman-filtered odometer for distance-traveled rather than
   * computing Haversine between two lat/lng snapshots. This is more accurate
   * (accounts for curved paths) and avoids manual trig math.
   *
   * Falls back to Haversine if no odometer data is available (e.g. first fix).
   */
  shouldRecalculate(newLat: number, newLng: number, odometer?: number): boolean {
    const last = this.state.lastCalculationPosition;
    if (!last) return true; // Never calculated — always recalculate

    // Prefer SDK odometer (Kalman-filtered distance traveled)
    if (odometer !== undefined && this.state.lastOdometer !== null) {
      const moved = odometer - this.state.lastOdometer;
      return moved >= DYNAMIC_GEOFENCE.RECALCULATION_DISTANCE;
    }

    // Fallback to Haversine for the first location before odometer is established
    const moved = haversineDistance(last.latitude, last.longitude, newLat, newLng);
    return moved >= DYNAMIC_GEOFENCE.RECALCULATION_DISTANCE;
  }

  /** Get current allocation (may be null before first compute). */
  getCurrentAllocation(): GeofenceAllocation | null {
    return this.state.currentAllocation;
  }

  /** Get full state for debugging. */
  getState(): DynamicGeofenceState {
    return { ...this.state };
  }

  /** Reset (e.g. on logout). */
  reset(): void {
    this.state = {
      lastCalculationPosition: null,
      lastOdometer: null,
      currentAllocation: null,
      isOnCampus: false,
    };
  }

  private emptyAllocation(userType: UserType, now?: Date): GeofenceAllocation {
    return {
      guaranteed: [],
      dynamic: [],
      all: [],
      userType,
      isAfterELotOpen: isAfterELotOpen(now),
      dynamicSlotsUsed: 0,
      dynamicSlotsAvailable: 0,
    };
  }
}

// Export singleton
const dynamicGeofenceManager = new DynamicGeofenceManager();
export default dynamicGeofenceManager;
