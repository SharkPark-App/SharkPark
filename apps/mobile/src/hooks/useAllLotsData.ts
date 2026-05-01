/**
 * Custom hook for managing all lots data
 */
import { useState, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { lotsApi, ParkingLotResponse } from '../services/api';
import { subscribeContributorState } from '../services/api/contributor';

/** How often to re-fetch all lots data (ms) */
const ALL_LOTS_POLL_MS = 30_000; // 30 seconds

interface UseAllLotsDataReturn {
  lots: ParkingLotResponse[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAllLotsData(): UseAllLotsDataReturn {
  const [lots, setLots] = useState<ParkingLotResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Monotonic generation counter so a slow in-flight fetch from a previous
  // call doesn't overwrite a newer one. Critical on permission toggles where
  // AppState 'active' + onProviderChange + the grant 2-phase emit can fire
  // multiple fetches back-to-back, and the network can reorder them.
  const refreshGenRef = useRef(0);

  const fetchLots = async () => {
    const myGen = ++refreshGenRef.current;
    const isLatest = () => refreshGenRef.current === myGen;

    try {
      setLoading(true);
      setError(null);
      const allLots = await lotsApi.getAllLots();
      if (!isLatest()) return;
      setLots(allLots);
    } catch (err) {
      if (!isLatest()) return;
      console.error('[useAllLotsData] Error fetching lots:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch parking lots');
    } finally {
      if (isLatest()) setLoading(false);
    }
  };

  // Initial fetch + polling
  useEffect(() => {
    fetchLots();

    const interval = setInterval(() => {
      fetchLots();
    }, ALL_LOTS_POLL_MS);

    return () => clearInterval(interval);
  }, []);

  // Re-fetch when the app returns to the foreground
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        fetchLots();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  // Re-fetch the moment our contributor status flips so the map's pin
  // colors update immediately on grant/revoke instead of lagging by up
  // to one full poll interval (30s). On 'revoked' we redact in-memory
  // first so pins flip to neutral instantly; the follow-up refetch funnels
  // through the API redactor (lots.ts) so a late-landing pre-revoke GET
  // can't snap pins back to colored.
  useEffect(() => {
    return subscribeContributorState((state) => {
      if (state === 'revoked') {
        // Bump gen FIRST so any in-flight pre-revoke fetch can't land on
        // top of the in-memory clobber and re-color the pins.
        refreshGenRef.current++;
        setLots((prev) =>
          prev.map((lot) => ({
            ...lot,
            current_occupancy: null,
            available: null,
            occupancy_rate: null,
            fill_status: null,
            estimated_occupancy: null,
            estimated_available: null,
            raw_occupancy: null,
            effective_penetration_rate: null,
          })),
        );
      }
      fetchLots();
    });
  }, []);

  return {
    lots,
    loading,
    error,
    refresh: fetchLots,
  };
}
