import { useEffect, useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { eventsApi } from '../services/api/events';
import type { LotEventsSummary } from '../types/events';

/** Refresh cadence for the bulk summary. Matches the campus-events scrape interval. */
const DEFAULT_REFRESH_MS = 5 * 60 * 1000;

interface UseEventsSummaryReturn {
  /** Map of `lot_id` → upcoming-event count inside the requested window. */
  byLotId: Record<string, number>;
  /** Map of `lot_id` → full summary row, for callers that need the next event details. */
  summaryByLotId: Record<string, LotEventsSummary>;
  loading: boolean;
  error: string | null;
}

/**
 * Single fetch for upcoming-event counts across every lot in the next
 * `withinHours` (default 2). One round trip serves the entire map's badges,
 * eliminating N per-lot calls. Refreshes on a timer and when the app
 * returns to foreground.
 */
export function useEventsSummary(
  withinHours = 2,
  refreshMs: number = DEFAULT_REFRESH_MS,
): UseEventsSummaryReturn {
  const [summary, setSummary] = useState<LotEventsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const cancelledRef = useRef(false);

  const fetch = useCallback(async () => {
    const isFirstLoad = !hasLoadedOnceRef.current;
    try {
      if (isFirstLoad) setLoading(true);
      const data = await eventsApi.getEventsSummary(withinHours);
      if (cancelledRef.current) return;
      setSummary(data);
      setError(null);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch events summary');
    } finally {
      if (!cancelledRef.current && isFirstLoad) setLoading(false);
    }
  }, [withinHours]);

  // Poll only while the screen is focused. The map stays mounted in the
  // tab stack — without focus gating the bulk endpoint would keep firing
  // every 5 min while the user is on Profile / Long Term Forecast / etc.
  // Mirrors the focus-gated polling already used by useLotsList.
  useFocusEffect(
    useCallback(() => {
      cancelledRef.current = false;
      fetch();
      const interval = setInterval(fetch, refreshMs);
      return () => {
        cancelledRef.current = true;
        clearInterval(interval);
      };
    }, [fetch, refreshMs]),
  );

  // Re-fetch when the app returns to the foreground. We don't tear this
  // listener down on blur — if the user backgrounds the app from another
  // tab and returns to it, the next focus event will refresh anyway, and
  // having the listener live across blurs costs nothing.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetch();
    });
    return () => sub.remove();
  }, [fetch]);

  // Reset hasLoadedOnce when the input window changes so the next fetch
  // shows a loading state (the previous summary's counts are now stale).
  useEffect(() => {
    hasLoadedOnceRef.current = false;
  }, [withinHours]);

  const byLotId: Record<string, number> = {};
  const summaryByLotId: Record<string, LotEventsSummary> = {};
  for (const row of summary) {
    byLotId[row.lot_id] = row.count;
    summaryByLotId[row.lot_id] = row;
  }

  return { byLotId, summaryByLotId, loading, error };
}
