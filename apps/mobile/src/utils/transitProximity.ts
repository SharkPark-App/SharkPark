import { haversineDistance } from './geoHelpers';
import { LOT_POLYGONS } from '../data/lotPolygons';
import type { MapStop, RouteArrival, GroupedArrival } from '../types/transit';

const NEARBY_THRESHOLD_M = 100;

/**
 * Returns stops within `thresholdM` metres of a parking lot.
 * Distance is the minimum haversine distance from the stop to any polygon
 * vertex in LOT_POLYGONS. Falls back to the stored lot centre coordinate
 * for lots that don't yet have a polygon entry.
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
      const minDist = Math.min(
        ...vertices.map((v) => haversineDistance(stop.latitude, stop.longitude, v.lat, v.lng)),
      );
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
