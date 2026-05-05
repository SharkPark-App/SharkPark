import type { SportsEventStatus, SportsResultStatus } from './events';

export interface Event {
  id: string;
  name: string;
  date: Date;
  /** Optional event end. Rendered as `start – end` when present. */
  endDate?: Date;
  location: string;
  description: string | null;
  url: string | null;
  /**
   * Live-sports fields (Sidearm-ingested events only). When `status` is
   * `'LIVE'` or `'FINAL'`, the EventBanner shows a status pill + scoreline.
   * `null` / undefined for academic and club events.
   */
  status?: SportsEventStatus | null;
  homeScore?: number | null;
  awayScore?: number | null;
  resultStatus?: SportsResultStatus | null;
}

export interface LongTermForecastScreenProps {
  onBack: () => void; // currently useless back arrow
}

// ShortTermForecastScreenProps is defined in navigation.ts for type-safe navigation