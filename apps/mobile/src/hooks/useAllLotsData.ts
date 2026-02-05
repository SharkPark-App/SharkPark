/**
 * Custom hook for managing all lots data
 */
import { useState, useEffect } from 'react';
import { lotsApi, ParkingLotResponse } from '../services/api';

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

  useEffect(() => {
    fetchLots();
  }, []);

  return {
    lots,
    loading,
    error,
    refresh: fetchLots,
  };
}
