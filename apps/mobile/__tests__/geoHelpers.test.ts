/**
 * Unit tests for geoHelpers
 *
 * Tests the pure geographic functions:
 *   haversineDistance, isAfterELotOpen, isOnCampus
 */

import {
  haversineDistance,
  isAfterELotOpen,
  isOnCampus,
} from '../src/utils/geoHelpers';

// A position on CSULB campus
const ON_CAMPUS = { latitude: 33.7838, longitude: -118.1089 };
// A position far from campus
const OFF_CAMPUS = { latitude: 34.05, longitude: -118.25 }; // downtown LA

// ── Tests ────────────────────────────────────────────────────────────────────

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
