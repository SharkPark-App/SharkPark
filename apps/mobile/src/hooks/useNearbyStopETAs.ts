import { useState, useEffect, useMemo } from 'react';
import { TransitService } from '../services/api/transit';
import { nearbyStopsForLot } from '../utils/transitProximity';
import type { MapStop, RouteArrival } from '../types/transit';

const LOG_TAG = '[useNearbyStopETAs]';

export interface NearbyStopWithArrivals {
  stop: MapStop;
  arrivals: RouteArrival[];
  isLoading: boolean;
}

export function useNearbyStopETAs(
  lotId: string,
  fallbackLat?: number,
  fallbackLng?: number,
): NearbyStopWithArrivals[] {
  const [stops, setStops] = useState<MapStop[]>([]);
  const [etaMap, setEtaMap] = useState<Record<string, { arrivals: RouteArrival[]; isLoading: boolean }>>({});

  useEffect(() => {
    TransitService.getRoutesAndStops()
      .then((data) => setStops(data.stops))
      .catch((err) => console.warn(`${LOG_TAG} Failed to load stops — nearby transit card will be hidden`, err));
  }, []);

  const nearby = useMemo(
    () => nearbyStopsForLot(lotId, stops, fallbackLat, fallbackLng),
    [lotId, stops, fallbackLat, fallbackLng],
  );

  // Stable string — only changes when the actual set of nearby stop IDs
  // changes, avoiding effect restarts on stops array reference churn.
  const nearbyKey = nearby.map((s) => s.id).join(',');

  useEffect(() => {
    if (!nearbyKey) {
      setEtaMap({});
      return;
    }

    let isMounted = true;

    const fetchAll = async (showLoading: boolean) => {
      if (showLoading) {
        setEtaMap(Object.fromEntries(nearby.map((s) => [s.id, { arrivals: [], isLoading: true }])));
      }
      await Promise.all(
        nearby.map(async (stop) => {
          try {
            const arrivals = await TransitService.getStopETAs(stop.id);
            if (isMounted) {
              setEtaMap((prev) => ({ ...prev, [stop.id]: { arrivals, isLoading: false } }));
            }
          } catch {
            if (isMounted) {
              setEtaMap((prev) => ({ ...prev, [stop.id]: { arrivals: [], isLoading: false } }));
            }
          }
        }),
      );
    };

    fetchAll(true);
    const interval = setInterval(() => fetchAll(false), 15_000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
    // nearby is intentionally omitted — it's derived from nearbyKey and has
    // unstable reference identity. nearbyKey is the correct change signal.
  }, [nearbyKey]);

  return nearby.map((stop) => ({
    stop,
    arrivals: etaMap[stop.id]?.arrivals ?? [],
    isLoading: etaMap[stop.id]?.isLoading ?? true,
  }));
}
