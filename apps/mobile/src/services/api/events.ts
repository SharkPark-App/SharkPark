import { apiService } from './base';
import { API_CONFIG } from './config';
import type { CampusEvent } from '../../types/events';

export const eventsApi = {
  /** Returns upcoming events (next 7 days) for a lot, matched server-side via building associations. */
  async getEventsForLot(lotId: string): Promise<CampusEvent[]> {
    const res = await apiService.get<CampusEvent[]>(
      API_CONFIG.ENDPOINTS.EVENTS_FOR_LOT(lotId),
    );
    return res.data;
  },
};
