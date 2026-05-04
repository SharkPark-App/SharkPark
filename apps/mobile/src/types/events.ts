/** Campus event as returned by GET /events/for-lot/:lotId */
export interface CampusEvent {
  id: string;
  external_id: string;
  event_name: string;
  location: string;
  description: string | null;
  event_url: string | null;
  start_time: string; // ISO 8601
  end_time: string;   // ISO 8601
  created_at: string; // ISO 8601
}

/** Compact upcoming-event slice for a single lot, used by the map badge. */
export interface NearbyEvent {
  id: string;
  event_name: string;
  location: string;
  start_time: string; // ISO 8601
  end_time: string;   // ISO 8601
}

/** One row per lot for the bulk events-summary endpoint. */
export interface LotEventsSummary {
  lot_id: string;
  count: number;
  next_event: NearbyEvent | null;
}
