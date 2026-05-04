/**
 * Unit tests for the geometric lot↔building derivation helper.
 *
 * Uses fixture data (not the real CSULB seed) so this spec stays isolated
 * from the prisma/ folder and respects tsconfig rootDir boundaries.
 *
 * For visual inspection of derivation against the real 28-lot / 93-building
 * dataset, see `prisma/scripts/print-lot-buildings.ts`.
 */

import {
  deriveLotBuildings,
  haversineMeters,
  DEFAULT_LOT_BUILDING_RADIUS_M,
  type BuildingPoint,
} from './derive-lot-buildings';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: 33.7838, lng: -118.1141 };
    expect(haversineMeters(p, p)).toBeCloseTo(0, 6);
  });

  it('returns ~111 km per degree of latitude', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 1, lng: 0 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('returns ~100 m for ~0.0009° latitude separation at CSULB', () => {
    const a = { lat: 33.7838, lng: -118.1141 };
    const b = { lat: 33.78470, lng: -118.1141 }; // ~100 m north
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe('deriveLotBuildings', () => {
  // Fixture: 5 buildings around a central lot, at known offsets.
  // Latitude: ~111,195 m/deg → 0.001° ≈ 111 m.
  const buildings: BuildingPoint[] = [
    { name: 'Near (50m N)',      lat: 33.78425, lng: -118.1141 },
    { name: 'Inside (200m N)',   lat: 33.78560, lng: -118.1141 },
    { name: 'Edge (240m N)',     lat: 33.78596, lng: -118.1141 },
    { name: 'Outside (400m N)',  lat: 33.78740, lng: -118.1141 },
    { name: 'Far (1km E)',       lat: 33.78380, lng: -118.1033 },
  ];
  const lot = { center_lat: 33.7838, center_lng: -118.1141 };

  it('includes only buildings within the default radius (250m)', () => {
    const result = deriveLotBuildings(lot, buildings);
    expect(result).toEqual([
      'Edge (240m N)',
      'Inside (200m N)',
      'Near (50m N)',
    ]);
  });

  it('returns deterministic, sorted output', () => {
    const result = deriveLotBuildings(lot, buildings);
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });

  it('respects custom radius', () => {
    const tight = deriveLotBuildings(lot, buildings, 100);
    expect(tight).toEqual(['Near (50m N)']);

    const loose = deriveLotBuildings(lot, buildings, 500);
    expect(loose).toContain('Outside (400m N)');
  });

  it('applies building_overrides.add for far buildings', () => {
    const result = deriveLotBuildings(
      { ...lot, building_overrides: { add: ['Far (1km E)'] } },
      buildings,
    );
    expect(result).toContain('Far (1km E)');
  });

  it('applies building_overrides.exclude for near buildings', () => {
    const result = deriveLotBuildings(
      { ...lot, building_overrides: { exclude: ['Near (50m N)'] } },
      buildings,
    );
    expect(result).not.toContain('Near (50m N)');
    expect(result).toContain('Inside (200m N)');
  });

  it('applies add and exclude together (exclude wins for same name)', () => {
    const result = deriveLotBuildings(
      {
        ...lot,
        building_overrides: {
          add: ['Outside (400m N)', 'Near (50m N)'],
          exclude: ['Near (50m N)'],
        },
      },
      buildings,
    );
    expect(result).toContain('Outside (400m N)');
    expect(result).not.toContain('Near (50m N)');
  });

  it('returns [] when no buildings are in range and no overrides', () => {
    const farLot = { center_lat: 0, center_lng: 0 };
    expect(deriveLotBuildings(farLot, buildings)).toEqual([]);
  });

  it('exports a sane default radius', () => {
    expect(DEFAULT_LOT_BUILDING_RADIUS_M).toBe(250);
  });
});
