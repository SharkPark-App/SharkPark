import { useState, useEffect, useCallback, useRef } from 'react';
import { eventsApi } from '../services/api/events';
import type { Event } from '../types/ui';

interface UseEventsReturn {
  events: Event[];
  loading: boolean;
  error: string | null;
}

/** Returns upcoming events (next 7 days) for a lot, mapped to the EventBanner Event shape. */
export function useEvents(lotId: string): UseEventsReturn {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const fetch = useCallback(async () => {
    if (!lotId) return;
    const isFirstLoad = !hasLoadedOnceRef.current;
    try {
      if (isFirstLoad) setLoading(true);
      setError(null);
      const data = await eventsApi.getEventsForLot(lotId);
      setEvents(
        data.map(e => ({
          id: e.id,
          name: e.event_name,
          date: new Date(e.start_time),
          endDate: e.end_time ? new Date(e.end_time) : undefined,
          location: e.location,
          description: e.description,
          url: e.event_url,
        })),
      );
      hasLoadedOnceRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
    } finally {
      if (isFirstLoad) setLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
    hasLoadedOnceRef.current = false;
    setEvents([]);
    if (lotId) fetch();
  }, [lotId, fetch]);

  return { events, loading, error };
}
