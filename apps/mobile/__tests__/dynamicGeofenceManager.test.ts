/**
 * Unit tests for DynamicGeofenceManager
 *
 * Validates the core geofence allocation logic:
 *   Students:  16 G-lots guaranteed. After 5:30 PM weekdays OR anytime on
 *              weekends → +4 nearest E-lots.
 *   Employees: 12 E-lots guaranteed. +8 nearest G-lots by proximity.
 *   Unknown:   empty allocation.
 *
 * Also tests: movement threshold, on/off-campus detection, reset.
 */

import dynamicGeofenceManager, {
  classifyUser,
  haversineDistance,
  isAfterELotOpen,
  isOnCampus,
} from '../src/services/dynamicGeofenceManager';
import { ParkingLotResponse } from '../src/services/api/lots';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal ParkingLotResponse stub with only the fields the manager uses. */
function makeLot(
  lot_id: string,
  lot_type: 'STUDENT' | 'EMPLOYEE',
  center_lat = 33.78,
  center_lng = -118.11,
): ParkingLotResponse {
  return {
    lot_id,
    lot_name: lot_id,
    display_name: lot_id,
    lot_number: lot_id.slice(1),
    lot_type,
    capacity: 100,
    current_occupancy: 0,
    location_description: '',
    building_proximity: [],
    center_lat,
    center_lng,
    geofence_polygon: [],
    geofence_radius: 50,
    permit_types: [],
    daily_permit_allowed: false,
    hours_weekday: '',
    hours_saturday: '',
    hours_sunday: '',
    ev_charging_stations: 0,
    motorcycle_spaces: 0,
    accessible_spaces: 0,
    has_lighting: true,
    has_cameras: true,
    has_emergency_phone: true,
    is_covered: false,
    is_paved: true,
    penetration_rate: 0.05,
    avg_turnover_minutes: 120,
    confidence: 'MEDIUM',
    timestamp: new Date().toISOString(),
    available: 100,
    occupancy_rate: 0,
    fill_status: 'AVAILABLE',
    estimated_occupancy: 0,
    estimated_available: 100,
    raw_occupancy: 0,
    effective_penetration_rate: 0.05,
  } as ParkingLotResponse;
}

// 16 G-lots, 12 E-lots — matching CSULB's actual counts
const gLots = Array.from({ length: 16 }, (_, i) => makeLot(`G${i + 1}`, 'STUDENT', 33.78 + i * 0.001, -118.11));
const eLots = Array.from({ length: 12 }, (_, i) => makeLot(`E${i + 1}`, 'EMPLOYEE', 33.79 + i * 0.001, -118.10));
const allLots = [...gLots, ...eLots];

// A position on CSULB campus
const ON_CAMPUS = { latitude: 33.7838, longitude: -118.1089 };
// A position far from campus
const OFF_CAMPUS = { latitude: 34.05, longitude: -118.25 }; // downtown LA

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dynamicGeofenceManager.reset();
});

describe('classifyUser', () => {
  it('identifies student emails', () => {
    expect(classifyUser('john@student.csulb.edu')).toBe('STUDENT');
  });

  it('identifies employee emails', () => {
    expect(classifyUser('prof@csulb.edu')).toBe('EMPLOYEE');
  });

  it('does not confuse student email for employee', () => {
    // @student.csulb.edu ends with @csulb.edu — guard must catch this
    expect(classifyUser('jane@student.csulb.edu')).toBe('STUDENT');
  });

  it('returns UNKNOWN for non-CSULB emails', () => {
    expect(classifyUser('user@gmail.com')).toBe('UNKNOWN');
    expect(classifyUser('')).toBe('UNKNOWN');
  });
});

describe('isAfterELotOpen', () => {
  // 2026-04-14 is a Tuesday (weekday)
  it('returns false before 5:30 PM on a weekday', () => {
    expect(isAfterELotOpen(new Date('2026-04-14T17:00:00'))).toBe(false);
    expect(isAfterELotOpen(new Date('2026-04-14T12:00:00'))).toBe(false);
  });

  it('returns true at exactly 5:30 PM on a weekday', () => {
    expect(isAfterELotOpen(new Date('2026-04-14T17:30:00'))).toBe(true);
  });

  it('returns true after 5:30 PM on a weekday', () => {
    expect(isAfterELotOpen(new Date('2026-04-14T18:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-14T23:59:00'))).toBe(true);
  });

  // 2026-04-18 is a Saturday, 2026-04-19 is a Sunday
  it('returns true on Saturday regardless of time', () => {
    expect(isAfterELotOpen(new Date('2026-04-18T08:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-18T12:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-18T17:00:00'))).toBe(true);
  });

  it('returns true on Sunday regardless of time', () => {
    expect(isAfterELotOpen(new Date('2026-04-19T08:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-19T12:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-19T17:00:00'))).toBe(true);
  });
});

describe('isOnCampus', () => {
  it('returns true for CSULB campus coordinates', () => {
    expect(isOnCampus(ON_CAMPUS.latitude, ON_CAMPUS.longitude)).toBe(true);
  });

  it('returns false for downtown LA', () => {
    expect(isOnCampus(OFF_CAMPUS.latitude, OFF_CAMPUS.longitude)).toBe(false);
  });
});

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistance(33.78, -118.11, 33.78, -118.11)).toBe(0);
  });

  it('returns a reasonable distance for nearby points', () => {
    // ~111 m per 0.001° latitude
    const d = haversineDistance(33.780, -118.110, 33.781, -118.110);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(130);
  });
});

describe('computeGeofenceSet', () => {
  describe('student', () => {
    const studentEmail = 'alice@student.csulb.edu';

    it('returns all 16 G-lots as guaranteed before 5:30 PM', () => {
      const before530 = new Date('2026-04-14T12:00:00');
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, studentEmail, null, before530);

      expect(alloc.userType).toBe('STUDENT');
      expect(alloc.guaranteed).toHaveLength(16);
      expect(alloc.guaranteed.every(l => l.lot_type === 'STUDENT')).toBe(true);
      expect(alloc.dynamic).toHaveLength(0);
      expect(alloc.isAfterELotOpen).toBe(false);
      expect(alloc.all).toHaveLength(16);
    });

    it('adds 4 dynamic E-lots after 5:30 PM with GPS', () => {
      const after530 = new Date('2026-04-14T18:00:00');
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, studentEmail, ON_CAMPUS, after530);

      expect(alloc.guaranteed).toHaveLength(16);
      expect(alloc.dynamic).toHaveLength(4);
      expect(alloc.dynamic.every(l => l.lot_type === 'EMPLOYEE')).toBe(true);
      expect(alloc.isAfterELotOpen).toBe(true);
      expect(alloc.all.length).toBeLessThanOrEqual(20);
    });

    it('still adds default dynamic E-lots after 5:30 PM without GPS', () => {
      const after530 = new Date('2026-04-14T18:00:00');
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, studentEmail, null, after530);

      expect(alloc.dynamic).toHaveLength(4);
      expect(alloc.dynamic.every(l => l.lot_type === 'EMPLOYEE')).toBe(true);
    });

    it('never exceeds 20 total', () => {
      const after530 = new Date('2026-04-14T18:00:00');
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, studentEmail, ON_CAMPUS, after530);
      expect(alloc.all.length).toBeLessThanOrEqual(20);
    });

    it('adds 4 dynamic E-lots on Saturday morning (weekend rule)', () => {
      const saturdayMorning = new Date('2026-04-18T10:00:00');
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, studentEmail, ON_CAMPUS, saturdayMorning);

      expect(alloc.guaranteed).toHaveLength(16);
      expect(alloc.dynamic).toHaveLength(4);
      expect(alloc.dynamic.every(l => l.lot_type === 'EMPLOYEE')).toBe(true);
      expect(alloc.isAfterELotOpen).toBe(true);
      expect(alloc.all.length).toBeLessThanOrEqual(20);
    });

    it('adds 4 dynamic E-lots on Sunday morning (weekend rule)', () => {
      const sundayMorning = new Date('2026-04-19T09:00:00');
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, studentEmail, ON_CAMPUS, sundayMorning);

      expect(alloc.dynamic).toHaveLength(4);
      expect(alloc.isAfterELotOpen).toBe(true);
    });
  });

  describe('employee', () => {
    const employeeEmail = 'prof@csulb.edu';

    it('returns all 12 E-lots as guaranteed', () => {
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, employeeEmail, null);

      expect(alloc.userType).toBe('EMPLOYEE');
      expect(alloc.guaranteed).toHaveLength(12);
      expect(alloc.guaranteed.every(l => l.lot_type === 'EMPLOYEE')).toBe(true);
    });

    it('adds 8 nearest G-lots as dynamic with GPS on campus', () => {
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, employeeEmail, ON_CAMPUS);

      expect(alloc.dynamic).toHaveLength(8);
      expect(alloc.dynamic.every(l => l.lot_type === 'STUDENT')).toBe(true);
      expect(alloc.all.length).toBeLessThanOrEqual(20);
    });

    it('adds default G-lots without GPS', () => {
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, employeeEmail, null);

      expect(alloc.dynamic).toHaveLength(8);
      expect(alloc.dynamic.every(l => l.lot_type === 'STUDENT')).toBe(true);
    });

    it('never exceeds 20 total', () => {
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, employeeEmail, ON_CAMPUS);
      expect(alloc.all.length).toBeLessThanOrEqual(20);
    });
  });

  describe('unknown user', () => {
    it('returns empty allocation', () => {
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, 'unknown@gmail.com', ON_CAMPUS);
      expect(alloc.userType).toBe('UNKNOWN');
      expect(alloc.all).toHaveLength(0);
    });

    it('returns empty allocation for empty email', () => {
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, '', null);
      expect(alloc.all).toHaveLength(0);
    });
  });

  describe('proximity sorting', () => {
    it('sorts dynamic lots by distance to user position', () => {
      // Create E-lots at known distances from ON_CAMPUS
      const nearE = makeLot('E_NEAR', 'EMPLOYEE', ON_CAMPUS.latitude + 0.001, ON_CAMPUS.longitude);
      const farE = makeLot('E_FAR', 'EMPLOYEE', ON_CAMPUS.latitude + 0.01, ON_CAMPUS.longitude);
      const testLots = [...gLots, nearE, farE];

      const after530 = new Date('2026-04-14T18:00:00');
      const alloc = dynamicGeofenceManager.computeGeofenceSet(testLots, 'a@student.csulb.edu', ON_CAMPUS, after530);

      // Near E-lot should come first in dynamic set
      expect(alloc.dynamic[0].lot_id).toBe('E_NEAR');
    });
  });

  describe('off-campus', () => {
    it('falls back to default order for dynamic lots when off campus', () => {
      const alloc = dynamicGeofenceManager.computeGeofenceSet(allLots, 'prof@csulb.edu', OFF_CAMPUS);

      // Dynamic lots should still be present (default order)
      expect(alloc.dynamic).toHaveLength(8);
    });
  });
});

describe('shouldRecalculate', () => {
  it('returns true when no previous calculation exists', () => {
    expect(dynamicGeofenceManager.shouldRecalculate(33.78, -118.11)).toBe(true);
  });

  it('returns false when user has not moved enough', () => {
    // Do an initial computation to set the last position
    dynamicGeofenceManager.computeGeofenceSet(allLots, 'a@student.csulb.edu', ON_CAMPUS);

    // Move only 100m (below 300m threshold)
    expect(dynamicGeofenceManager.shouldRecalculate(
      ON_CAMPUS.latitude + 0.0009, // ~100m
      ON_CAMPUS.longitude,
    )).toBe(false);
  });

  it('returns true when user has moved more than 300m', () => {
    dynamicGeofenceManager.computeGeofenceSet(allLots, 'a@student.csulb.edu', ON_CAMPUS);

    // Move ~400m
    expect(dynamicGeofenceManager.shouldRecalculate(
      ON_CAMPUS.latitude + 0.0036, // ~400m
      ON_CAMPUS.longitude,
    )).toBe(true);
  });
});

describe('reset', () => {
  it('clears all state', () => {
    dynamicGeofenceManager.computeGeofenceSet(allLots, 'a@student.csulb.edu', ON_CAMPUS);
    expect(dynamicGeofenceManager.getCurrentAllocation()).not.toBeNull();

    dynamicGeofenceManager.reset();
    expect(dynamicGeofenceManager.getCurrentAllocation()).toBeNull();
    expect(dynamicGeofenceManager.getState().lastCalculationPosition).toBeNull();
  });
});
