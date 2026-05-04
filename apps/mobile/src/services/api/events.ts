import { apiService } from './base';
import { cacheService } from './cache';
import { API_CONFIG } from './config';
import type { CampusEvent, LotEventsSummary, NearbyEvent } from '../../types/events';

/** Matches the backend event-scrape cadence — there's no point fetching faster than the source updates. */
const EVENTS_SUMMARY_TTL_MS = 5 * 60 * 1000;

export const eventsApi = {
  /** Returns upcoming events (next 7 days) for a lot, matched server-side via building associations. */
  async getEventsForLot(lotId: string): Promise<CampusEvent[]> {
    const res = await apiService.get<CampusEvent[]>(
      API_CONFIG.ENDPOINTS.EVENTS_FOR_LOT(lotId),
    );
    return res.data;
  },

  /**
   * Compact list of upcoming events for a single lot inside `withinHours`.
   * Defaults to 2h (the badge window). Backed by `GET /lots/:id/nearby-events`.
   */
  async getNearbyEvents(lotId: string, withinHours = 2): Promise<NearbyEvent[]> {
    const res = await apiService.get<NearbyEvent[]>(
      `${API_CONFIG.ENDPOINTS.LOT_NEARBY_EVENTS(lotId)}?within_hours=${withinHours}`,
    );
    return res.data ?? [];
  },

  /**
   * Bulk per-lot upcoming-event summary used to render badges across the map
   * in a single round trip. Backed by `GET /lots/events-summary`.
   *
   * Routed through `cacheService.getOrFetch` so we get the layer's standard
   * benefits for free: in-flight coalescing across concurrent callers (Map
   * focus + AppState resume firing on the same tick), stale-while-revalidate
   * fallback when offline, and consistent cache semantics with the rest of
   * the lots data. TTL matches the backend scrape cadence — no point
   * re-fetching faster than the source updates.
   */
  async getEventsSummary(withinHours = 2): Promise<LotEventsSummary[]> {
    const result = await cacheService.getOrFetch<LotEventsSummary[]>(
      `events:summary:${withinHours}`,
      async () => {
        const res = await apiService.get<LotEventsSummary[]>(
          `${API_CONFIG.ENDPOINTS.LOTS_EVENTS_SUMMARY}?within_hours=${withinHours}`,
        );
        return res.data ?? [];
      },
      { ttl: EVENTS_SUMMARY_TTL_MS },
    );
    return result.data;
  },
};

