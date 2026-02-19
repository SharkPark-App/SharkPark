import { useState, useEffect, useCallback } from 'react';
import { reliabilityApiService } from '../services/api/reliability';
import type { ReliabilityScore, ReliabilityScoreSummary } from '../types/reliability';

interface UseReliabilityReturn {
  reliability: ReliabilityScore | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useReliability(lotId: string): UseReliabilityReturn {
  const [reliability, setReliability] = useState<ReliabilityScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!lotId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await reliabilityApiService.getLotReliability(lotId);
      setReliability(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch reliability data';
      setError(message);
      console.error('Error fetching reliability:', err);
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
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
