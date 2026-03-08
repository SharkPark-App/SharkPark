/**
 * Custom hook for managing all lots data
 */
import { useState, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { lotsApi, ParkingLotResponse } from '../services/api';

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

  const fetchLots = async () => {
    try {
      setLoading(true);
      setError(null);
      const allLots = await lotsApi.getAllLots();
      setLots(allLots);
    } catch (err) {
      console.error('[useAllLotsData] Error fetching lots:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch parking lots');
    } finally {
      setLoading(false);
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

  return {
    lots,
    loading,
    error,
    refresh: fetchLots,
  };
}
