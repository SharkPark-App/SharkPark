/**
 * Lots API Service
 * Handles all parking lot related API calls
 */
import { apiService } from './base';
import API_CONFIG from './config';
import { getDeviceId } from './deviceCredentials';
import { cacheService } from './cache';

// Backend response interfaces (matching the backend)
export interface ParkingLot {
  lot_id: string;
  lot_name: string;
  display_name: string;
  lot_number: string;
  lot_type: 'STUDENT' | 'EMPLOYEE';
  capacity: number;
  current_occupancy: number;
  location_description: string;
  building_proximity: string[];
  center_lat: number;
  center_lng: number;
  geofence_polygon: Array<{ lat: number; lng: number }>;
  geofence_radius: number;
  permit_types: string[];
  daily_permit_allowed: boolean;
  daily_rate?: number;
  hours_weekday: { open: string; close: string } | string;
  hours_saturday: { open: string; close: string } | string;
  hours_sunday: { open: string; close: string } | string;
  ev_charging_stations: number;
  motorcycle_spaces: number;
  accessible_spaces: number;
  has_lighting: boolean;
  has_cameras: boolean;
  has_emergency_phone: boolean;
  is_covered: boolean;
  is_paved: boolean;
  levels?: number;
  penetration_rate: number;
  avg_turnover_minutes: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  timestamp: string;
}

export interface ParkingLotResponse extends ParkingLot {
  available: number;
  occupancy_rate: number;
  fill_status: 'AVAILABLE' | 'FILLING' | 'NEARLY_FULL' | 'FULL';
  /** Estimated true occupancy (scaled up from raw device count) */
  estimated_occupancy: number;
  /** Estimated available spots (capacity - estimated_occupancy) */
  estimated_available: number;
  /** Raw device count (current_occupancy before scaling) */
  raw_occupancy: number;
  /** Effective penetration rate used for estimation (0.01–1.0) */
  effective_penetration_rate: number;
}

export interface OccupancySummary {
  total_lots: number;
  total_capacity: number;
  total_occupied: number;
  total_available: number;
  overall_occupancy_rate: number;
  by_type: {
    STUDENT: {
      lots: number;
      capacity: number;
      occupied: number;
      available: number;
      occupancy_rate: number;
    };
    EMPLOYEE: {
      lots: number;
      capacity: number;
      occupied: number;
      available: number;
      occupancy_rate: number;
    };
  };
  high_occupancy_lots: ParkingLotResponse[];
  timestamp: string;
}

export interface OccupancyHistoryRecord {
  lot_id: string;
  timestamp: string;
  occupancy: number;
  capacity: number;
  occupancy_rate: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface GetLotsParams {
  type?: 'STUDENT' | 'EMPLOYEE';
  available_only?: boolean;
  min_available?: number;
  permit_type?: string;
  daily_permit?: boolean;
  ev_charging?: boolean;
}

export interface GetHistoryParams {
  // YYYY-MM-DD format
  date?: string;
  // Max 200
  limit?: number;
}

export interface LotRecommendation extends ParkingLotResponse {
  recommendation_score: number;
  distance_meters: number;
  reason: string;
}

class LotsApiService {
  /** Cache TTLs by data type */
  private static readonly CACHE_TTL = {
    ALL_LOTS: 60 * 1000,           // 1 minute — lot data changes frequently
    SUMMARY: 60 * 1000,            // 1 minute
    LOT_DETAILS: 30 * 1000,        // 30 seconds — individual lot detail is time-sensitive
    HISTORY: 5 * 60 * 1000,        // 5 minutes — historical data is stable
    RECOMMENDATIONS: 2 * 60 * 1000, // 2 minutes
    FORECAST: 5 * 60 * 1000,       // 5 minutes
  };

  /**
   * Get all parking lots with optional filtering.
   * Uses stale-while-revalidate caching for offline support.
   */
  async getAllLots(params?: GetLotsParams): Promise<ParkingLotResponse[]> {
    const queryString = params ? this.buildQueryString(params) : '';
    const endpoint = `${API_CONFIG.ENDPOINTS.LOTS}${queryString}`;
    const cacheKey = `lots:all${queryString}`;

    const result = await cacheService.getOrFetch(
      cacheKey,
      async () => {
        const response = await apiService.get<ParkingLotResponse[]>(endpoint);
        return response.data;
      },
      { ttl: LotsApiService.CACHE_TTL.ALL_LOTS },
    );
    return result.data;
  }

  /**
   * Get campus-wide occupancy summary.
   * Cached for offline dashboard access.
   */
  async getOccupancySummary(): Promise<OccupancySummary> {
    const result = await cacheService.getOrFetch(
      'lots:summary',
      async () => {
        const response = await apiService.get<OccupancySummary>(API_CONFIG.ENDPOINTS.LOTS_SUMMARY);
        return response.data;
      },
      { ttl: LotsApiService.CACHE_TTL.SUMMARY },
    );
    return result.data;
  }

  /**
   * Get details for a specific lot.
   * Cached per-lot for offline detail views.
   */
  async getLotDetails(lotId: string): Promise<ParkingLotResponse> {
    const endpoint = API_CONFIG.ENDPOINTS.LOT_DETAILS(lotId);
    const result = await cacheService.getOrFetch(
      `lots:detail:${lotId}`,
      async () => {
        const response = await apiService.get<ParkingLotResponse>(endpoint);
        return response.data;
      },
      { ttl: LotsApiService.CACHE_TTL.LOT_DETAILS },
    );
    return result.data;
  }

  /**
   * Get historical occupancy data for a specific lot.
   * History is stable — longer cache TTL.
   */
  async getLotHistory(
    lotId: string,
    params?: GetHistoryParams
  ): Promise<OccupancyHistoryRecord[]> {
    const queryString = params ? this.buildQueryString(params) : '';
    const endpoint = `${API_CONFIG.ENDPOINTS.LOT_HISTORY(lotId)}${queryString}`;
    const cacheKey = `lots:history:${lotId}${queryString}`;

    const result = await cacheService.getOrFetch(
      cacheKey,
      async () => {
        const response = await apiService.get<OccupancyHistoryRecord[]>(endpoint);
        return response.data;
      },
      { ttl: LotsApiService.CACHE_TTL.HISTORY },
    );
    return result.data;
  }

  /**
   * Get recommended alternative lots for a given source lot.
   * Returns lots ranked by availability, distance, type match, and permit compatibility.
   */
  async getRecommendedLots(
    sourceLotId: string,
    limit: number = 5,
  ): Promise<LotRecommendation[]> {
    const queryString = limit !== 5 ? `?limit=${limit}` : '';
    const endpoint = `${API_CONFIG.ENDPOINTS.LOT_RECOMMENDATIONS(sourceLotId)}${queryString}`;
    const cacheKey = `lots:recommend:${sourceLotId}:${limit}`;

    const result = await cacheService.getOrFetch(
      cacheKey,
      async () => {
        const response = await apiService.get<LotRecommendation[]>(endpoint);
        return response.data;
      },
      { ttl: LotsApiService.CACHE_TTL.RECOMMENDATIONS },
    );
    return result.data;
  }

  /**
   * Fetch short-term predictions from backend ML pipeline.
   * Uses cache for offline support; falls back to local heuristic if
   * neither the backend nor a cached result is available.
   */
  async getForecast(lot: ParkingLotResponse): Promise<Array<{
    time: string;
    occupancy: number;
    lowerBound: number;
    upperBound: number;
    accuracy: number;
  }>> {
    try {
      const result = await cacheService.getOrFetch(
        `lots:forecast:${lot.lot_id}`,
        async () => {
          const endpoint = API_CONFIG.ENDPOINTS.LOT_PREDICTIONS_SHORT(lot.lot_id);
          const response = await apiService.get<{
            predictions: Array<{
              target_time: string;
              predicted_occupancy: number;
              confidence_lower: number;
              confidence_upper: number;
            }>;
          }>(endpoint);

          const predictions = response.data.predictions;
          if (predictions && predictions.length > 0) {
            return predictions.map((p) => {
              const hour = new Date(p.target_time).getHours();
              const occupancyPercent = lot.capacity > 0
                ? Math.round((p.predicted_occupancy / lot.capacity) * 100)
                : p.predicted_occupancy;
              const lower = lot.capacity > 0
                ? Math.round((p.confidence_lower / lot.capacity) * 100)
                : p.confidence_lower;
              const upper = lot.capacity > 0
                ? Math.round((p.confidence_upper / lot.capacity) * 100)
                : p.confidence_upper;

              return {
                time: hour.toString(),
                occupancy: Math.min(100, Math.max(0, occupancyPercent)),
                lowerBound: Math.min(100, Math.max(0, lower)),
                upperBound: Math.min(100, Math.max(0, upper)),
                accuracy: lot.confidence === 'HIGH' ? 95 :
                         lot.confidence === 'MEDIUM' ? 85 : 70,
              };
            });
          }
          // No predictions from backend — return local heuristic (still cache it)
          return this.generateForecast(lot);
        },
        { ttl: LotsApiService.CACHE_TTL.FORECAST },
      );
      return result.data;
    } catch {
      // Cache miss + network failure — generate locally
      return this.generateForecast(lot);
    }
  }

  /**
   * Generate forecast data for short-term predictions (local fallback)
   */
  generateForecast(lot: ParkingLotResponse): Array<{
    time: string;
    occupancy: number;
    lowerBound: number;
    upperBound: number;
    accuracy: number;
  }> {
    const forecast = [];
    const now = new Date();

    // Typical campus occupancy curve
    const campusCurve: Record<number, number> = {
      7: 15, 8: 40, 9: 70, 10: 85, 11: 90, 12: 80,
      13: 75, 14: 70, 15: 60, 16: 50, 17: 55, 18: 45,
      19: 30, 20: 20, 21: 10};

    // Generate hourly forecast for prediction hours 7 AM – 9 PM
    for (let hour = 7; hour <= 21; hour++) {
      const occupancyPercent = campusCurve[hour] ?? 50;
      const confidenceMargin =
        lot.confidence === 'HIGH' ? 3 : lot.confidence === 'MEDIUM' ? 5 : 8;

      const targetTime = new Date(now);
      targetTime.setHours(hour, 0, 0, 0);

      forecast.push({
        time: targetTime.toISOString(),
        occupancy: occupancyPercent,
        lowerBound: Math.max(0, occupancyPercent - confidenceMargin),
        upperBound: Math.min(100, occupancyPercent + confidenceMargin),
        accuracy:
          lot.confidence === 'HIGH'
            ? 95
            : lot.confidence === 'MEDIUM'
              ? 85 : 70,
      });
    }

    return forecast;
  }

  /**
   * Record anonymous occupancy event (ENTER/EXIT)
   * Device ID is hashed server-side for privacy
   */
  /**
   * Record anonymous occupancy event (ENTER/EXIT).
   *
   * The body carries `device_id` so the backend can upsert the
   * `ContributorPing` row that gates ContributorGuard. The same value is
   * also injected into the `x-device-id` header by ApiService for the read
   * endpoints — both surfaces share the install-scoped UUID owned by
   * deviceCredentials.ts.
   */
  async recordOccupancyEvent(event: {
    lotId: string;
    eventType: 'ENTER' | 'EXIT';
    source: 'GEOFENCE' | 'MANUAL';
    timestamp?: string;
  }): Promise<{ event_id: string; deduplicated: boolean }> {
    const deviceId = await getDeviceId();

    const payload = {
      lot_id: event.lotId,
      event_type: event.eventType,
      device_id: deviceId,
      timestamp: event.timestamp || new Date().toISOString(),
    };

    const response = await apiService.post<{ event_id: string; deduplicated: boolean }>(
      API_CONFIG.ENDPOINTS.OCCUPANCY_EVENTS,
      payload,
    );
    return response.data;
  }

  private buildQueryString(params: GetLotsParams | GetHistoryParams): string {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query.append(key, String(value));
      }
    });

    const queryString = query.toString();
    return queryString ? `?${queryString}` : '';
  }
}

export const lotsApi = new LotsApiService();
export default lotsApi;
