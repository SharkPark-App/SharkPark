export interface Event {
  id: string;
  name: string;
  date: Date;
  /** Optional event end. Rendered as `start – end` when present. */
  endDate?: Date;
  location: string;
  description: string | null;
  url: string | null;
}

export interface LongTermForecastScreenProps {
  onBack: () => void; // currently useless back arrow
}

// ShortTermForecastScreenProps is defined in navigation.ts for type-safe navigation