/**
 * Custom hook for managing lot data and API calls
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { lotsApi, ParkingLotResponse, OccupancyHistoryRecord, ApiError } from '../services/api';

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

  const refreshLot = useCallback(async () => {
    if (!lotId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const lotData = await lotsApi.getLotDetails(lotId);
      setLot(lotData);
      
      // Fetch ML predictions, falling back to local heuristic
      const forecastData = await lotsApi.getForecast(lotData);
      setForecast(forecastData);
      
    } catch (err) {
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

  // Initial data load + polling
  useEffect(() => {
    if (!lotId) return;

    refreshLot();
    refreshHistory();

    const interval = setInterval(() => {
      refreshLot();
    }, LOT_DETAIL_POLL_MS);

    return () => clearInterval(interval);
  }, [lotId, refreshLot, refreshHistory]);

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

  return {
    lot,
    history,
    forecast,
    loading,
    error,
    refreshLot,
    refreshHistory,
  };
}

interface UseLotsListReturn {
  lots: ParkingLotResponse[];
  loading: boolean;
  error: string | null;
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

  // Stabilise the filters reference so that callers passing an inline object
  // literal don't cause the polling effect to reset on every render.
  const filtersRef = useRef(filters);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => { filtersRef.current = filters; }, [filtersKey]);

  const refreshLots = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const lotsData = await lotsApi.getAllLots(filtersRef.current);
      setLots(lotsData);
      
    } catch (err) {
      const errorMessage = err instanceof ApiError 
        ? `${err.message} (${err.status})`
        : 'Failed to fetch lots data';
      setError(errorMessage);
      console.error('Error fetching lots:', err);
    } finally {
      setLoading(false);
    }
  }, [filtersKey]);

  // Initial fetch + polling
  useEffect(() => {
    refreshLots();

    const interval = setInterval(() => {
      refreshLots();
    }, LOTS_LIST_POLL_MS);

    return () => clearInterval(interval);
  }, [refreshLots]);

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

  return {
    lots,
    loading,
    error,
    refreshLots,
  };
}
