/**
 * Custom hook for managing lot data and API calls
 */
import { useState, useEffect, useCallback } from 'react';
import { lotsApi, ParkingLotResponse, OccupancyHistoryRecord, ApiError } from '../services/api';

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
      
      // Generate forecast based on lot data
      const forecastData = lotsApi.generateForecast(lotData);
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

  // Initial data load
  useEffect(() => {
    if (lotId) {
      refreshLot();
      refreshHistory();
    }
  }, [lotId, refreshLot, refreshHistory]);

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

  const refreshLots = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const lotsData = await lotsApi.getAllLots(filters);
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
  }, [filters]);

  useEffect(() => {
    refreshLots();
  }, [refreshLots]);

  return {
    lots,
    loading,
    error,
    refreshLots,
  };
}
