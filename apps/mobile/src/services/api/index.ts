/**
 * API Services Index
 * Exports all API services for easy importing
 */

// Configuration
export { default as API_CONFIG } from './config';

// Base service
export { apiService, ApiError } from './base';
export type { ApiResponse } from './base';

// Lots service
export { lotsApi } from './lots';
export type { 
  ParkingLot,
  ParkingLotResponse,
  OccupancySummary,
  OccupancyHistoryRecord,
  GetLotsParams,
  GetHistoryParams,
} from './lots';

// Import for default export
import API_CONFIG from './config';
import { apiService } from './base';
import { lotsApi } from './lots';

// Re-export everything as default object
export default {
  config: API_CONFIG,
  base: apiService,
  lots: lotsApi,
};
