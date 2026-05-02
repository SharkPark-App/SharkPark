/**
 * Reports API Service
 * POST /reports — submit an incident report for a parking lot.
 *
 * Payload: { lotId: string (cuid), type: 'blockage'|'crash'|'other', message?: string }
 * Response: { id: string, created_at: string }
 * Throttled: 5 requests / minute / user
 * Auth: 401 for unauthenticated / guest callers
 */
import { apiService, ApiError } from './base';

export type ReportType = 'blockage' | 'crash' | 'other';

export interface CreateReportPayload {
  /** Lot.id (cuid) — NOT the human-readable lot_id like 'G2' */
  lotId: string;
  type: ReportType;
  message?: string;
}

export interface CreateReportResponse {
  id: string;
  created_at: string;
}

/** Thrown when a guest or unauthenticated user hits POST /reports. */
export class ReportUnauthorizedError extends ApiError {
  constructor() {
    super(401, 'You must be signed in to submit a report');
    this.name = 'ReportUnauthorizedError';
  }
}

/** Thrown when the user exceeds the 5/min throttle limit. */
export class ReportThrottledError extends ApiError {
  constructor() {
    super(429, 'You\'re submitting reports too quickly. Please wait a moment.');
    this.name = 'ReportThrottledError';
  }
}

const reportsApi = {
  async create(payload: CreateReportPayload): Promise<CreateReportResponse> {
    try {
      const response = await apiService.post<CreateReportResponse>(
        '/reports',
        payload,
      );
      return response.data ?? (response as unknown as CreateReportResponse);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) throw new ReportUnauthorizedError();
        if (error.status === 429) throw new ReportThrottledError();
      }
      throw error;
    }
  },
};

export { reportsApi };
