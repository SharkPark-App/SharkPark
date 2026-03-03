// Types for parking validation analysis
export interface ValidationEvent {
  id: string;
  event_type: ValidationEventType;
  timestamp: Date;
  speed_mph: number | null;
  accuracy_meters: number | null;
  confidence_score: number;
  bluetooth_state: BluetoothState | null;
  raw_data: any;
}

export type ValidationEventType = 
  | 'SPEED_CHANGE'
  | 'STATIONARY'
  | 'WALKING' 
  | 'DRIVING'
  | 'BLUETOOTH_CONNECT'
  | 'BLUETOOTH_DISCONNECT'
  | 'GEOFENCE_ENTER'
  | 'GEOFENCE_EXIT'
  | 'GPS_ACCURACY_CHANGE';

export type BluetoothState = 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';

export type ValidationStatus = 'ANALYZING' | 'PARKED' | 'DROVE_THROUGH' | 'SEARCHING' | 'UNKNOWN';

export interface ValidationAnalysis {
  status: ValidationStatus;
  confidenceScore: number;
  contributesToOccupancy: boolean;
  speedTransitionScore: number;
  dwellTimeScore: number;
  movementPatternScore: number;
  bluetoothScore: number;
  metadata: {
    event_count: number;
    time_span_minutes: number;
    speed_range: [number, number] | null;
    analysis_timestamp: string;
  };
}

export interface EventPatternAnalysis extends ValidationAnalysis {
  preliminaryStatus: ValidationStatus;
  confidence: number;
}
