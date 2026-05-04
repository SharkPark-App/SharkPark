/**
 * Status of a sports event ingested from Sidearm. `null` for academic /
 * club events surfaced by the CampusLabs scraper.
 *
 * - SCHEDULED: pre-game, start_time in the future (or just past with no signal)
 * - LIVE: in progress \u2014 home_score / away_score are populated and updated by
 *   the every-2-minute live cron
 * - FINAL: completed, scores frozen, result_status (W/L/T) set
 * - POSTPONED: rescheduled \u2014 start_time may still update later
 * - CANCELLED: not happening
 */
export type SportsEventStatus =
  | 'SCHEDULED'
  | 'LIVE'
  | 'FINAL'
  | 'POSTPONED'
  | 'CANCELLED';

/** Win / Loss / Tie from the home team's perspective. Set only when status === 'FINAL'. */
export type SportsResultStatus = 'W' | 'L' | 'T';

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
  status?: SportsEventStatus | null;
  home_score?: number | null;
  away_score?: number | null;
  result_status?: SportsResultStatus | null;
}

/** Compact upcoming-event slice for a single lot, used by the map badge. */
export interface NearbyEvent {
  id: string;
  event_name: string;
  location: string;
  start_time: string; // ISO 8601
  end_time: string;   // ISO 8601
  status?: SportsEventStatus | null;
  home_score?: number | null;
  away_score?: number | null;
  result_status?: SportsResultStatus | null;
}

/** One row per lot for the bulk events-summary endpoint. */
export interface LotEventsSummary {
  lot_id: string;
  count: number;
  next_event: NearbyEvent | null;
}
