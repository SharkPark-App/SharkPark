/**
 * transitProximity utility tests
 *
 * Pure-function coverage for:
 * - nearbyStopsForLot  (polygon-based and fallback-coord distance filtering)
 * - groupArrivals      (route grouping, 3-ETA cap)
 * - formatEtas         (display string formatting)
 */
import { nearbyStopsForLot, groupArrivals, formatEtas } from '../src/utils/transitProximity';
import type { MapStop, RouteArrival } from '../src/types/transit';

// ────────────────────── LOT_POLYGONS mock ──────────────────────
// Inject a small, controlled polygon so tests don't depend on the real data file.

jest.mock('../src/data/lotPolygons', () => ({
  LOT_POLYGONS: {
    // A tiny 4-vertex square centred on 33.785, -118.115 (≈ 22 m side)
    'LOT_A': [
      { lat: 33.7851, lng: -118.1151 },
      { lat: 33.7851, lng: -118.1149 },
      { lat: 33.7849, lng: -118.1149 },
      { lat: 33.7849, lng: -118.1151 },
    ],
  },
}));

// ────────────────────── Helpers ──────────────────────

const makeStop = (id: string, lat: number, lng: number): MapStop => ({
  id,
  name: `Stop ${id}`,
  latitude: lat,
  longitude: lng,
  routeIds: ['r1'],
  color: '#ff0000',
});

const makeArrival = (routeId: string, eta: number): RouteArrival => ({
  routeId,
  routeName: `Route ${routeId}`,
  abbreviation: routeId.toUpperCase(),
  color: '#00ff00',
  etaMinutes: eta,
});

// ────────────────────── nearbyStopsForLot ──────────────────────

describe('nearbyStopsForLot', () => {
  it('includes stops within threshold of a polygon vertex', () => {
    // Stop exactly at a polygon vertex — distance = 0
    const stop = makeStop('s1', 33.7851, -118.1151);
    const result = nearbyStopsForLot('LOT_A', [stop]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
  });

  it('excludes stops beyond the threshold', () => {
    // Stop ~500 m away
    const stop = makeStop('s_far', 33.790, -118.115);
    const result = nearbyStopsForLot('LOT_A', [stop]);
    expect(result).toHaveLength(0);
  });

  it('filters correctly when multiple stops are mixed near/far', () => {
    const near = makeStop('near', 33.7850, -118.1150); // inside polygon area
    const far = makeStop('far', 33.800, -118.100);
    const result = nearbyStopsForLot('LOT_A', [near, far]);
    expect(result.map(s => s.id)).toEqual(['near']);
  });

  it('falls back to fallbackLat/Lng when lot has no polygon entry', () => {
    const stop = makeStop('s1', 33.785, -118.115);
    // LOT_B has no polygon — uses fallback coords which equal the stop's coords
    const result = nearbyStopsForLot('LOT_B', [stop], 33.785, -118.115);
    expect(result).toHaveLength(1);
  });

  it('returns empty when lot has no polygon and no fallback coords are given', () => {
    const stop = makeStop('s1', 33.785, -118.115);
    const result = nearbyStopsForLot('LOT_B', [stop]);
    expect(result).toHaveLength(0);
  });

  it('returns empty when stops array is empty', () => {
    const result = nearbyStopsForLot('LOT_A', []);
    expect(result).toHaveLength(0);
  });
});

// ────────────────────── groupArrivals ──────────────────────

describe('groupArrivals', () => {
  it('groups arrivals by routeId', () => {
    const arrivals = [
      makeArrival('r1', 3),
      makeArrival('r1', 8),
      makeArrival('r2', 5),
    ];
    const groups = groupArrivals(arrivals);
    expect(groups).toHaveLength(2);
    const r1 = groups.find(g => g.routeId === 'r1')!;
    expect(r1.etas).toEqual([3, 8]);
  });

  it('caps each route at 3 ETAs', () => {
    const arrivals = [
      makeArrival('r1', 1),
      makeArrival('r1', 5),
      makeArrival('r1', 10),
      makeArrival('r1', 15), // should be dropped
    ];
    const groups = groupArrivals(arrivals);
    expect(groups[0].etas).toHaveLength(3);
    expect(groups[0].etas).toEqual([1, 5, 10]);
  });

  it('preserves routeName, abbreviation, and color from the first arrival', () => {
    const arrivals = [makeArrival('r1', 3)];
    const groups = groupArrivals(arrivals);
    expect(groups[0]).toMatchObject({
      routeName: 'Route r1',
      abbreviation: 'R1',
      color: '#00ff00',
    });
  });

  it('returns empty array when given no arrivals', () => {
    expect(groupArrivals([])).toEqual([]);
  });
});

// ────────────────────── formatEtas ──────────────────────

describe('formatEtas', () => {
  it('formats a single ETA', () => {
    expect(formatEtas([7])).toBe('7 min');
  });

  it('formats multiple ETAs as a comma-separated list', () => {
    expect(formatEtas([3, 8, 15])).toBe('3, 8, 15 min');
  });

  it('returns "no vehicles" for an empty array', () => {
    expect(formatEtas([])).toBe('no vehicles');
  });

  it('filters out null values', () => {
    expect(formatEtas([3, null, 10])).toBe('3, 10 min');
  });

  it('returns "no vehicles" when all values are null', () => {
    expect(formatEtas([null, null])).toBe('no vehicles');
  });
});
