export interface ParkingLotUI {
  id: string;
  name: string;
  occupancy: number;
  category: 'general' | 'employee';
  position: { x: number; y: number };
}

export interface Event {
  id: string;
  name: string;
  date: Date;
  location: string;
  affectedLots: string[];
  description: string;
  impact: 'high' | 'medium' | 'low';
}

export interface LongTermForecastScreenProps {
  onBack: () => void; // currently useless back arrow
}

export interface ShortTermForecastScreenProps {
  lot: ParkingLotUI,
  onBack: () => void; // currently useless back arrow
}