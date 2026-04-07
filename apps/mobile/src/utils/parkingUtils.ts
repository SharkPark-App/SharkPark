// Threshold percentages aligned with backend OCCUPANCY_THRESHOLDS in constants.ts
const FILLING_PCT = 50; // matches OCCUPANCY_THRESHOLDS.FILLING (0.50)
const NEARLY_FULL_PCT = 75; // matches OCCUPANCY_THRESHOLDS.NEARLY_FULL (0.75)

export const getOccupancyColor = (occupancy: number): string => {
  if (occupancy < FILLING_PCT) return '#4ade80';
  if (occupancy < NEARLY_FULL_PCT) return '#fbbf24';
  return '#ef4444';
};