/**
 * Lots API Service
 * Handles all parking lot related API calls
 */
import { apiService } from './base';
import API_CONFIG from './config';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  /**
   * Get all parking lots with optional filtering
   */
  async getAllLots(params?: GetLotsParams): Promise<ParkingLotResponse[]> {
    const queryString = params ? this.buildQueryString(params) : '';
    const endpoint = `${API_CONFIG.ENDPOINTS.LOTS}${queryString}`;

    const response = await apiService.get<ParkingLotResponse[]>(endpoint);
    return response.data;
  }

  /**
   * Get campus-wide occupancy summary
   */
  async getOccupancySummary(): Promise<OccupancySummary> {
    const response = await apiService.get<OccupancySummary>(API_CONFIG.ENDPOINTS.LOTS_SUMMARY);
    return response.data;
  }

  /**
   * Get details for a specific lot
   */
  async getLotDetails(lotId: string): Promise<ParkingLotResponse> {
    const endpoint = API_CONFIG.ENDPOINTS.LOT_DETAILS(lotId);
    const response = await apiService.get<ParkingLotResponse>(endpoint);
    return response.data;
  }

  /**
   * Get historical occupancy data for a specific lot
   */
  async getLotHistory(
    lotId: string,
    params?: GetHistoryParams
  ): Promise<OccupancyHistoryRecord[]> {
    const queryString = params ? this.buildQueryString(params) : '';
    const endpoint = `${API_CONFIG.ENDPOINTS.LOT_HISTORY(lotId)}${queryString}`;

    const response = await apiService.get<OccupancyHistoryRecord[]>(endpoint);
    return response.data;
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

    const response = await apiService.get<LotRecommendation[]>(endpoint);
    return response.data;
  }

  /**
   * Convert UI lot format to API format for backward compatibility
   */
  convertToUIFormat(apiLot: ParkingLotResponse): import('../../types/ui').ParkingLotUI {
    return {
      id: apiLot.lot_id,
      name: apiLot.display_name || apiLot.lot_name,
      occupancy: Math.round(apiLot.occupancy_rate * 100),
      category: apiLot.lot_type.toLowerCase() as 'general' | 'employee',
      // Note: position will need to be mapped from coordinates or maintained separately
      position: { x: 0, y: 0 }, // TODO: Map from lat/lng to UI coordinates
    };
  }

  /**
   * Generate forecast data for short-term predictions.
   * TODO: Replace with real ML predictions from the backend.
   * Currently uses a hardcoded campus occupancy curve for development.
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
  async recordOccupancyEvent(event: {
    lotId: string;
    eventType: 'ENTER' | 'EXIT';
    source: 'GEOFENCE' | 'MANUAL';
    timestamp?: string;
  }): Promise<{ event_id: string; deduplicated: boolean }> {
    const deviceId = await this.getAnonymousDeviceId();

    const payload = {
      lot_id: event.lotId,
      event_type: event.eventType,
      device_id: deviceId,
      timestamp: event.timestamp || new Date().toISOString(),
    };

    const response = await apiService.post<{ event_id: string; deduplicated: boolean }>(
      API_CONFIG.ENDPOINTS.OCCUPANCY_EVENTS, 
      payload
    );
    return response.data;
  }

  /** Get or create anonymous device ID for deduplication (hashed server-side) */
  private async getAnonymousDeviceId(): Promise<string> {
    try {
      // Try to get existing ID from AsyncStorage
      const existingId = await AsyncStorage.getItem('@sharkpark_anonymous_device_id');

      if (existingId) {
        return existingId;
      }

      // Generate a new random UUID
      const newId = this.generateUUID();
      await AsyncStorage.setItem('@sharkpark_anonymous_device_id', newId);
      return newId;
    } catch {
      // Fallback: generate a session-only ID if AsyncStorage fails
      console.warn('[LotsApi] Failed to access AsyncStorage, using session-only ID');
      return this.sessionDeviceId || (this.sessionDeviceId = this.generateUUID());
    }
  }

  /**
   * Generate a random UUID v4
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Fallback session-only device ID
  private sessionDeviceId?: string;

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
