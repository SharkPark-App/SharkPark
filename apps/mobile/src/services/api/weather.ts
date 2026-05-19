import { apiService } from './base';
import { API_CONFIG } from './config';

/**
 * Current observed conditions for the CSULB campus, persisted hourly by
 * the backend `weather-fetch` cron. Shape mirrors the `Weather` Prisma
 * model with only the fields the mobile UI surfaces today.
 */
export interface CurrentWeather {
  temperature_f: number;
  humidity_percent: number;
  conditions: string;
  recorded_at: string;
}

export const weatherApi = {
  /** Returns the most recent observation, or `null` when unavailable. */
  async getCurrent(): Promise<CurrentWeather | null> {
    const res = await apiService.get<CurrentWeather | null>(
      `${API_CONFIG.ENDPOINTS.WEATHER}/current`,
    );
    return res.data ?? null;
  },
};
