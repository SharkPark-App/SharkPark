import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { eventsApi } from '../services/api/events';
import type { Event } from '../types/ui';

interface UseEventsReturn {
  events: Event[];
  loading: boolean;
  error: string | null;
}

/** How often to re-fetch the lot's upcoming-events list (ms). The server-side
 * scrapers run every 15 min, so a 5-min poll catches schedule changes within
 * one cron tick without hammering the API. Tuned independently of the lot /
 * forecast polls in `useLotData` so the EventBanner refreshes on its own
 * cadence rather than piggybacking on a single screen-wide tick. */
const EVENTS_POLL_MS = 5 * 60_000;

/** Returns upcoming events (next 7 days) for a lot, mapped to the EventBanner Event shape. */
export function useEvents(lotId: string): UseEventsReturn {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  // Monotonic generation counter: a slow in-flight fetch from the previous
  // poll tick (or a previous lotId) must not commit on top of a newer one.
  const genRef = useRef(0);

  const fetch = useCallback(async () => {
    if (!lotId) return;
    const myGen = ++genRef.current;
    const isLatest = () => genRef.current === myGen;
    const isFirstLoad = !hasLoadedOnceRef.current;
    try {
      if (isFirstLoad) setLoading(true);
      setError(null);
      const data = await eventsApi.getEventsForLot(lotId);
      if (!isLatest()) return;
      setEvents(
        data.map(e => ({
          id: e.id,
          name: e.event_name,
          date: new Date(e.start_time),
          endDate: e.end_time ? new Date(e.end_time) : undefined,
          location: e.location,
          description: e.description,
          url: e.event_url,
          status: e.status ?? null,
          homeScore: e.home_score ?? null,
          awayScore: e.away_score ?? null,
          resultStatus: e.result_status ?? null,
        })),
      );
      hasLoadedOnceRef.current = true;
    } catch (err) {
      if (!isLatest()) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
    } finally {
      if (isLatest() && isFirstLoad) setLoading(false);
    }
  }, [lotId]);

  // Fetch on mount / lotId change + poll while mounted. A plain `useEffect`
  // (not `useFocusEffect`) keeps this hook usable outside a navigator
  // (tests, future contexts); the consumer screens already gate their own
  // mount/unmount via the navigator stack.
  useEffect(() => {
    hasLoadedOnceRef.current = false;
    setEvents([]);
    if (!lotId) return;
    fetch();
    const interval = setInterval(fetch, EVENTS_POLL_MS);
    return () => clearInterval(interval);
  }, [lotId, fetch]);

  // Re-fetch when the app returns to the foreground so a long suspend doesn't
  // leave stale events visible (the next poll could be up to 5 min away).
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        fetch();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [fetch]);

  return { events, loading, error };
}
