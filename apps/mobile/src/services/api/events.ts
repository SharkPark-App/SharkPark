import { apiService } from './base';
import { API_CONFIG } from './config';
import type { CampusEvent, NearbyEvent } from '../../types/events';

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
};

