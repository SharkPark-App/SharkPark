/**
 * Lots API Service
 * Handles all parking lot related API calls
 */
import { apiService } from './base';
import API_CONFIG from './config';

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
  date?: string; // YYYY-MM-DD format
  limit?: number; // Max 200
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
   * Generate forecast data for short-term predictions
   * This creates mock forecast data similar to what's in ShortTermForecastScreen
   */
  generateForecast(lot: ParkingLotResponse): Array<{
    time: string;
    occupancy: number;
    lowerBound: number;
    upperBound: number;
    accuracy: number;
  }> {
    const forecast = [];
    const currentOccupancyRate = lot.occupancy_rate;
    
    // Generate hourly forecast for next 20 hours
    for (let i = 0; i < 20; i++) {
      const hour = (new Date().getHours() + i) % 24;
      
      // Simple prediction model - adjust based on time of day
      let predictedRate = currentOccupancyRate;
      
      // Peak hours: 8-10 AM and 5-7 PM
      if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 19)) {
        predictedRate = Math.min(0.95, currentOccupancyRate * 1.2);
      }
      // Low hours: 10 PM - 6 AM
      else if (hour >= 22 || hour <= 6) {
        predictedRate = currentOccupancyRate * 0.3;
      }
      // Regular hours: moderate adjustments
      else {
        predictedRate = currentOccupancyRate * (0.8 + Math.random() * 0.4);
      }

      const occupancyPercent = Math.round(predictedRate * 100);
      const confidenceMargin = lot.confidence === 'HIGH' ? 3 : 
                              lot.confidence === 'MEDIUM' ? 5 : 8;
      
      forecast.push({
        time: hour.toString(),
        occupancy: occupancyPercent,
        lowerBound: Math.max(0, occupancyPercent - confidenceMargin),
        upperBound: Math.min(100, occupancyPercent + confidenceMargin),
        accuracy: lot.confidence === 'HIGH' ? 95 : 
                 lot.confidence === 'MEDIUM' ? 85 : 70,
      });
    }
    
    return forecast;
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
