/**
 * Represents an anonymous occupancy event from geofencing detection.
 * Used to track ENTER/EXIT events for parking lots without storing PII.
 */
export interface OccupancyEvent {
  PK: string;                    // "LOT#<lot_id>"
  SK: string;                    // "EVENT#<timestamp>#<event_id>"
  EntityType: 'OccupancyEvent';
  lot_id: string;
  event_type: 'ENTER' | 'EXIT';
  device_hash: string;           // SHA-256 hash of device_id + salt
  timestamp: string;             // ISO8601 when event occurred
  created_at: string;            // ISO8601 when record was created
  ttl: number;                   // Unix timestamp for DynamoDB TTL (90 days)
}

/**
 * Point-in-time snapshot of lot occupancy for ML training.
 * Captured every 15 minutes by the snapshot job.
 */
export interface OccupancySnapshot {
  PK: string;                    // "LOT#<lot_id>#<date>"
  SK: string;                    // "SNAPSHOT#<timestamp>"
  EntityType: 'OccupancySnapshot';
  lot_id: string;
  timestamp: string;             // ISO8601
  occupancy: number;             // Current vehicle count
  available: number;             // capacity - occupancy
  occupancy_rate: number;        // 0.0 to 1.0
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reliability_score?: number;    // 0-100 score from multi-factor algorithm
  is_cold_start?: boolean;       // True if insufficient data for reliable estimates
  ttl: number;                   // Unix timestamp for DynamoDB TTL (90 days)
}

/**
 * Response from creating an occupancy event.
 */
export interface CreateEventResponse {
  event_id: string;
  lot_id: string;
  event_type: 'ENTER' | 'EXIT';
  recorded_at: string;
  deduplicated: boolean;         // True if event was ignored due to deduplication
}

/**
 * Statistics for a lot's events over a time period.
 */
export interface EventStats {
  lot_id: string;
  start_date: string;
  end_date: string;
  total_enters: number;
  total_exits: number;
  net_change: number;
}
