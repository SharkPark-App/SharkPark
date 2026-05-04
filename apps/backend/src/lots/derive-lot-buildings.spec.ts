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
  pointToPolygonMeters,
  polygonToPolygonMeters,
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

describe('polygonToPolygonMeters', () => {
  // ~111,195 m per degree of latitude. At CSULB's latitude (~33.78°),
  // longitude resolves to ~92,400 m/deg (cos(33.78°) ≈ 0.831).
  // Use a 50 m × 50 m square for "lot A" centered at the origin.
  const lotA: ReadonlyArray<{ lat: number; lng: number }> = [
    { lat: 33.78380, lng: -118.11410 },
    { lat: 33.78380, lng: -118.11355 }, // ~50 m east
    { lat: 33.78425, lng: -118.11355 }, // ~50 m north-east
    { lat: 33.78425, lng: -118.11410 }, // ~50 m north
  ];

  it('returns 0 for overlapping polygons', () => {
    // lotB shifted ~25 m east — overlaps lotA on its right half.
    const lotB: ReadonlyArray<{ lat: number; lng: number }> = lotA.map(
      (v) => ({ lat: v.lat, lng: v.lng + 0.00025 }),
    );
    expect(polygonToPolygonMeters(lotA, lotB)).toBe(0);
  });

  it('returns 0 when one polygon fully contains the other', () => {
    const tiny: ReadonlyArray<{ lat: number; lng: number }> = [
      { lat: 33.78395, lng: -118.11395 },
      { lat: 33.78395, lng: -118.11385 },
      { lat: 33.78410, lng: -118.11385 },
      { lat: 33.78410, lng: -118.11395 },
    ];
    expect(polygonToPolygonMeters(lotA, tiny)).toBe(0);
    expect(polygonToPolygonMeters(tiny, lotA)).toBe(0);
  });

  it('returns the gap distance for separated polygons', () => {
    // lotC is ~100 m east of lotA's east edge.
    const eastShift = 100 / 92_400; // ~0.001083° lng
    const lotC: ReadonlyArray<{ lat: number; lng: number }> = lotA.map(
      (v) => ({ lat: v.lat, lng: v.lng + 0.00055 + eastShift }),
    );
    const d = polygonToPolygonMeters(lotA, lotC);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });

  it('is much smaller than centroid haversine for adjacent large lots', () => {
    // Two long, thin parking lots side-by-side. Centers are far apart,
    // but their nearest edges nearly touch — the case the recommender
    // used to misjudge.
    const longA: ReadonlyArray<{ lat: number; lng: number }> = [
      { lat: 33.78300, lng: -118.11410 },
      { lat: 33.78300, lng: -118.11355 },
      { lat: 33.78500, lng: -118.11355 }, // ~220 m tall
      { lat: 33.78500, lng: -118.11410 },
    ];
    const longB: ReadonlyArray<{ lat: number; lng: number }> = [
      { lat: 33.78300, lng: -118.11340 }, // ~15 m gap east of longA
      { lat: 33.78300, lng: -118.11285 },
      { lat: 33.78500, lng: -118.11285 },
      { lat: 33.78500, lng: -118.11340 },
    ];
    const centroidA = { lat: 33.78400, lng: -118.113825 };
    const centroidB = { lat: 33.78400, lng: -118.113125 };

    const edgeDist = polygonToPolygonMeters(longA, longB, centroidA, centroidB);
    const centroidDist = haversineMeters(centroidA, centroidB);

    expect(edgeDist).toBeLessThan(20); // ~15 m gap
    expect(centroidDist).toBeGreaterThan(60); // centers are ~65 m apart
  });

  it('falls back to point-to-polygon when one polygon is degenerate', () => {
    const pointB = { lat: 33.78380, lng: -118.11300 }; // ~100 m east of lotA
    const d = polygonToPolygonMeters(
      lotA,
      [],
      undefined,
      pointB,
    );
    // Should equal pointToPolygonMeters(pointB, lotA)
    const expected = pointToPolygonMeters(pointB, lotA);
    expect(d).toBeCloseTo(expected, 6);
  });

  it('falls back to centroid haversine when both polygons are degenerate', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 1, lng: 0 };
    const d = polygonToPolygonMeters([], [], a, b);
    expect(d).toBeCloseTo(haversineMeters(a, b), 6);
  });

  it('returns +Infinity when degenerate polygons have no fallback centroids', () => {
    expect(polygonToPolygonMeters([], [])).toBe(Number.POSITIVE_INFINITY);
  });
});
