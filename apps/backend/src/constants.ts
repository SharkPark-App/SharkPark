export const API_PREFIX = 'api/v1';
export const SERVICE_NAME = 'sharkpark-backend';

// ─── Occupancy Thresholds ─────────────────────────────────
// Single source of truth for fill-status breakpoints.
// Mobile mirrors these via the API's `fill_status` string.
export const OCCUPANCY_THRESHOLDS = {
  /** >= this rate → FULL (effectively no spots) */
  FULL: 0.95,
  /** >= this rate → NEARLY_FULL */
  NEARLY_FULL: 0.75,
  /** >= this rate → FILLING */
  FILLING: 0.50,
  /** Recommendation engine: exclude lots at or above this rate */
  RECOMMENDATION_CUTOFF: 0.75,
} as const;
