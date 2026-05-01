import { useState, useEffect, useCallback, useRef } from 'react';
import { reliabilityApiService } from '../services/api/reliability';
import type { ReliabilityScore, ReliabilityScoreSummary } from '../types/reliability';

interface UseReliabilityReturn {
  reliability: ReliabilityScore | null;
  /** True only on the very first fetch (when `reliability` is still null).
   * Background refetches keep this false so the consuming UI doesn't unmount
   * the rendered meter and cause layout shift on every poll tick. */
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useReliability(lotId: string): UseReliabilityReturn {
  const [reliability, setReliability] = useState<ReliabilityScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Same pattern as useLotData: only flip `loading` on the first fetch so
  // background refetches don't unmount the ReliabilityMeter and shift the
  // surrounding layout (the meter sits between the occupancy badge and the
  // hourly chart on the lot detail screen — flicker is very visible).
  const hasLoadedOnceRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!lotId) return;

    const isFirstLoad = !hasLoadedOnceRef.current;

    try {
      if (isFirstLoad) setLoading(true);
      setError(null);
      const data = await reliabilityApiService.getLotReliability(lotId);
      setReliability(data);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch reliability data';
      setError(message);
      console.error('Error fetching reliability:', err);
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
    // Reset first-load tracking + clear stale data when switching lots so
    // we show the spinner instead of the previous lot's meter.
    hasLoadedOnceRef.current = false;
    setReliability(null);
    if (lotId) {
      refresh();
    }
  }, [lotId, refresh]);

  return { reliability, loading, error, refresh };
}

interface UseAllLotsReliabilityReturn {
  reliabilities: ReliabilityScoreSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAllLotsReliability(): UseAllLotsReliabilityReturn {
  const [reliabilities, setReliabilities] = useState<ReliabilityScoreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await reliabilityApiService.getAllLotsReliability();
      setReliabilities(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch reliability data';
      setError(message);
      console.error('Error fetching all lots reliability:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { reliabilities, loading, error, refresh };
}
