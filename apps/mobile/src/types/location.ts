/**
 * Location Service Types
 * Privacy-focused geofencing types for anonymous parking lot tracking
 */

export interface LocationPermissionStatus {
  granted: boolean;
  denied: boolean;
  restricted: boolean;
  never_ask_again?: boolean; // Android only
}

export interface GeofenceRegion {
  id: string;
  name: string;
  // Support both circular and polygon geofences
  geometry: {
    type: 'circle' | 'polygon';
    // For circular geofences
    center?: {
      latitude: number;
      longitude: number;
    };
    radius?: number; // meters
    // For polygon geofences
    coordinates?: Array<{
      latitude: number;
      longitude: number;
    }>;
  };
  notifyOnEntry: boolean;
  notifyOnExit: boolean;
}

export interface GeofenceEvent {
  regionId: string;
  eventType: 'ENTER' | 'EXIT' | 'DWELL';
  timestamp: string;
  // NO location coordinates — privacy first!
  // Activity + speed are included for parking detection heuristics:
  // they determine if the user drove in vs walked in (occupancy gating).
  activity?: {
    type: string;       // 'still' | 'on_foot' | 'walking' | 'in_vehicle' | 'automotive' | ...
    confidence: number; // 0-100
  };
  speed?: number; // m/s from SDK — fallback when activity recognition has lag
}

export interface LocationError {
  code: 'PERMISSION_DENIED' | 'LOCATION_UNAVAILABLE' | 'TIMEOUT' | 'GEOFENCE_ERROR';
  message: string;
}
