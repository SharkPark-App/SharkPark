/**
 * Custom hook for managing lot data and API calls
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { lotsApi, ParkingLotResponse, OccupancyHistoryRecord, ApiError, BackgroundLocationRequiredError } from '../services/api';
import { subscribeContributorState } from '../services/api/contributor';

/** How often to re-fetch lot data (ms) */
const LOT_DETAIL_POLL_MS = 60_000;  // 60 seconds
const LOTS_LIST_POLL_MS  = 30_000;  // 30 seconds

interface UseLotDataReturn {
  lot: ParkingLotResponse | null;
  history: OccupancyHistoryRecord[];
  forecast: Array<{
    time: string;
    occupancy: number;
    lowerBound: number;
    upperBound: number;
    accuracy: number;
  }>;
  loading: boolean;
  error: string | null;
  /** True when the backend rejected with BG_LOCATION_REQUIRED (403). */
  bgLocationRequired: boolean;
  /** Reset the bgLocationRequired flag (call after routing to the soft-ask screen). */
  clearBgLocationRequired: () => void;
  refreshLot: () => Promise<void>;
  refreshHistory: (date?: string) => Promise<void>;
}

export function useLotData(lotId: string): UseLotDataReturn {
  const [lot, setLot] = useState<ParkingLotResponse | null>(null);
  const [history, setHistory] = useState<OccupancyHistoryRecord[]>([]);
  const [forecast, setForecast] = useState<Array<{
    time: string;
    occupancy: number;
    lowerBound: number;
    upperBound: number;
    accuracy: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bgLocationRequired, setBgLocationRequired] = useState(false);

  const refreshLot = useCallback(async () => {
    if (!lotId) return;
    
    try {
      setLoading(true);
      setError(null);
      setBgLocationRequired(false);
      
      const lotData = await lotsApi.getLotDetails(lotId);
      setLot(lotData);
      
      // Fetch ML predictions, falling back to local heuristic
      const forecastData = await lotsApi.getForecast(lotData);
      setForecast(forecastData);
      
    } catch (err) {
      if (err instanceof BackgroundLocationRequiredError) {
        setBgLocationRequired(true);
        return;
      }
      const errorMessage = err instanceof ApiError 
        ? `${err.message} (${err.status})`
        : 'Failed to fetch lot data';
      setError(errorMessage);
      console.error('Error fetching lot data:', err);
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  const refreshHistory = useCallback(async (date?: string) => {
    if (!lotId) return;
    
    try {
      const historyData = await lotsApi.getLotHistory(lotId, {
        date,
        limit: 96, // 15-minute intervals for 24 hours
      });
      setHistory(historyData);
    } catch (err) {
      console.error('Error fetching lot history:', err);
      // Don't set error state for history as it's secondary data
    }
  }, [lotId]);

  // Fetch on focus + poll while focused. Using `useFocusEffect` (instead
  // of a plain `useEffect` on mount) ensures we re-pull whenever the
  // user returns to this screen — e.g. after coming back from the
  // LocationPermission soft-ask — without waiting up to a full poll
  // interval. Polling is also paused while the screen is blurred,
  // which is what we want for battery + bandwidth.
  useFocusEffect(
    useCallback(() => {
      if (!lotId) return;

      refreshLot();
      refreshHistory();

      const interval = setInterval(() => {
        refreshLot();
      }, LOT_DETAIL_POLL_MS);

      return () => clearInterval(interval);
    }, [lotId, refreshLot, refreshHistory]),
  );

  // Re-fetch when the app returns to the foreground
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        refreshLot();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refreshLot]);

  // Re-fetch the moment our contributor status changes (grant or revoke)
  // so the locked badge / occupancy_rate flips without waiting for the
  // next poll tick. Fires from registerContributorGrant / revokeContributorGrant.
  //
  // Critical: on 'revoked' we MUST clobber the cached lot's live fields
  // *immediately*, not just refetch. The /contributor/revoke POST and our
  // refetch GET are two independent network round-trips, and the GET
  // frequently wins the race — returning the same colored/contributor view
  // we had before the toggle. Server reconciliation happens on the
  // follow-up refetch; the client-side redaction guarantees the UI flips
  // instantly to match OS truth.
  useEffect(() => {
    return subscribeContributorState((state) => {
      if (state === 'revoked') {
        setLot((prev) =>
          prev
            ? {
                ...prev,
                current_occupancy: null,
                available: null,
                occupancy_rate: null,
                fill_status: null,
                estimated_occupancy: null,
                estimated_available: null,
                raw_occupancy: null,
                effective_penetration_rate: null,
              }
            : prev,
        );
        setForecast([]);
        setBgLocationRequired(true);
      }
      refreshLot();
    });
  }, [refreshLot]);

  return {
    lot,
    history,
    forecast,
    loading,
    error,
    bgLocationRequired,
    clearBgLocationRequired: () => setBgLocationRequired(false),
    refreshLot,
    refreshHistory,
  };
}

interface UseLotsListReturn {
  lots: ParkingLotResponse[];
  loading: boolean;
  error: string | null;
  /** True when the backend rejected with BG_LOCATION_REQUIRED (403). */
  bgLocationRequired: boolean;
  /** Reset the bgLocationRequired flag (call after routing to the soft-ask screen). */
  clearBgLocationRequired: () => void;
  refreshLots: () => Promise<void>;
}

export function useLotsList(filters?: {
  type?: 'STUDENT' | 'EMPLOYEE';
  available_only?: boolean;
  min_available?: number;
}): UseLotsListReturn {
  const [lots, setLots] = useState<ParkingLotResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bgLocationRequired, setBgLocationRequired] = useState(false);

  // Stabilise the filters reference so that callers passing an inline object
  // literal don't cause the polling effect to reset on every render.
  const filtersRef = useRef(filters);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => { filtersRef.current = filters; }, [filtersKey]);

  const refreshLots = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setBgLocationRequired(false);
      
      const lotsData = await lotsApi.getAllLots(filtersRef.current);
      setLots(lotsData);
      
    } catch (err) {
      if (err instanceof BackgroundLocationRequiredError) {
        setBgLocationRequired(true);
        return;
      }
      const errorMessage = err instanceof ApiError 
        ? `${err.message} (${err.status})`
        : 'Failed to fetch lots data';
      setError(errorMessage);
      console.error('Error fetching lots:', err);
    } finally {
      setLoading(false);
    }
  }, [filtersKey]);

  // Fetch on focus + poll while focused. See note in `useLotData` above:
  // this ensures the map / forecast screens immediately re-pull when the
  // user returns from the LocationPermission soft-ask (or any other
  // pushed screen) instead of showing stale neutral pins / locked badges
  // until the next poll tick.
  useFocusEffect(
    useCallback(() => {
      refreshLots();

      const interval = setInterval(() => {
        refreshLots();
      }, LOTS_LIST_POLL_MS);

      return () => clearInterval(interval);
    }, [refreshLots]),
  );

  // Re-fetch when the app returns to the foreground
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        refreshLots();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refreshLots]);

  // Re-fetch on contributor grant/revoke. On 'revoked' we redact the
  // cached lots client-side first to beat the GET-vs-revoke-POST race —
  // see useLotData above for the rationale.
  useEffect(() => {
    return subscribeContributorState((state) => {
      if (state === 'revoked') {
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
      refreshLots();
    });
  }, [refreshLots]);

  return {
    lots,
    loading,
    error,
    bgLocationRequired,
    clearBgLocationRequired: () => setBgLocationRequired(false),
    refreshLots,
  };
}
