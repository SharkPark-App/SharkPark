/**
 * API Services Index
 * Exports all API services for easy importing
 */

// Configuration
export { default as API_CONFIG } from './config';

// Base service
export { apiService, ApiError, BackgroundLocationRequiredError } from './base';
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
  LotRecommendation,
} from './lots';

// Events service
export { eventsApi } from './events';
export type { CampusEvent } from '../../types/events';

// Reports service
export { reportsApi, ReportUnauthorizedError, ReportThrottledError } from './reports';
export type { CreateReportPayload, CreateReportResponse, ReportType } from './reports';

// Notifications service
export { registerPushToken } from './notifications';

// Users service
export { deleteMyAccount, updateNotificationPreferences } from './users';
export type { NotificationPreferences } from './users';

// Import for default export
import API_CONFIG from './config';
import { apiService } from './base';
import { lotsApi } from './lots';
import { eventsApi } from './events';
import { reportsApi } from './reports';

// Re-export everything as default object
export default {
  config: API_CONFIG,
  base: apiService,
  lots: lotsApi,
  events: eventsApi,
  reports: reportsApi,
};
