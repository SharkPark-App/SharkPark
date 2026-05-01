export interface Event {
  id: string;
  name: string;
  date: Date;
  location: string;
  affectedLots: string[];
  description?: string;
  impact: 'high' | 'medium' | 'low';
}

export interface LongTermForecastScreenProps {
  onBack: () => void; // currently useless back arrow
}

// ShortTermForecastScreenProps is defined in navigation.ts for type-safe navigation