import { haversineDistance } from './geoHelpers';
import { LOT_POLYGONS } from '../data/lotPolygons';
import type { MapStop, RouteArrival, GroupedArrival } from '../types/transit';

const NEARBY_THRESHOLD_M = 100;

/**
 * Minimum distance (metres) from a point to a line segment, computed by
 * projecting the point onto the segment in a local equirectangular frame
 * (accurate for the sub-kilometre spans of a parking-lot edge) and then
 * back-converting the projected lat/lng to metres via haversine.
 */
function pointToSegmentDistance(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  // Use the segment midpoint latitude as the local longitude scale so the
  // projection is roughly isometric across the segment.
  const refLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const lngScale = Math.cos(refLat);

  const ax = aLng * lngScale;
  const ay = aLat;
  const bx = bLng * lngScale;
  const by = bLat;
  const px = pLng * lngScale;
  const py = pLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  // Degenerate segment — fall back to point-to-point distance to A.
  if (lenSq === 0) return haversineDistance(pLat, pLng, aLat, aLng);

  // Clamp parametric position onto [0, 1] so we measure to the nearest
  // point on the actual segment (not its infinite extension).
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const projLng = (ax + t * dx) / lngScale;
  const projLat = ay + t * dy;
  return haversineDistance(pLat, pLng, projLat, projLng);
}

/**
 * Returns stops within `thresholdM` metres of a parking lot.
 * Distance is the minimum point-to-segment distance from the stop to any
 * edge of the lot polygon in LOT_POLYGONS — vertex-only sampling would
 * over-report distance for stops sitting near an edge midpoint between two
 * distant vertices (long/thin polygons especially). Falls back to the
 * stored lot centre coordinate for lots that don't yet have a polygon entry.
 */
export function nearbyStopsForLot(
  lotId: string,
  stops: MapStop[],
  fallbackLat?: number,
  fallbackLng?: number,
  thresholdM = NEARBY_THRESHOLD_M,
): MapStop[] {
  const vertices = LOT_POLYGONS[lotId];

  return stops.filter((stop) => {
    if (vertices && vertices.length > 0) {
      // Single vertex — degenerate ring, fall back to point-to-point.
      if (vertices.length === 1) {
        return (
          haversineDistance(stop.latitude, stop.longitude, vertices[0].lat, vertices[0].lng) <=
          thresholdM
        );
      }
      // Iterate every consecutive pair as a polygon edge.
      let minDist = Infinity;
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        const d = pointToSegmentDistance(
          stop.latitude,
          stop.longitude,
          a.lat,
          a.lng,
          b.lat,
          b.lng,
        );
        if (d < minDist) minDist = d;
        if (minDist <= thresholdM) return true; // early-out
      }
      return minDist <= thresholdM;
    }
    if (fallbackLat === undefined || fallbackLng === undefined) return false;
    return haversineDistance(stop.latitude, stop.longitude, fallbackLat, fallbackLng) <= thresholdM;
  });
}

/** Groups arrivals by route, capping at 3 ETAs per route. */
export function groupArrivals(arrivals: RouteArrival[]): GroupedArrival[] {
  const map = new Map<string, GroupedArrival>();
  for (const arrival of arrivals) {
    const existing = map.get(arrival.routeId);
    if (existing) {
      if (existing.etas.length < 3) existing.etas.push(arrival.etaMinutes);
    } else {
      map.set(arrival.routeId, {
        routeId: arrival.routeId,
        routeName: arrival.routeName,
        abbreviation: arrival.abbreviation,
        color: arrival.color,
        etas: [arrival.etaMinutes],
      });
    }
  }
  return [...map.values()];
}

/** Formats a grouped ETA list into a display string, e.g. "3, 8, 15 min". */
export function formatEtas(etas: (number | null)[]): string {
  const nums = etas.filter((e): e is number => e !== null);
  return nums.length > 0 ? nums.join(', ') + ' min' : 'no vehicles';
}
