/**
 * Location Service Types
 * Privacy-focused geofencing types for anonymous parking lot tracking
 */

import { LOCATION_CONSTANTS } from '../constants/geofencing';

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

// Legacy support - keep old interface for backward compatibility
export interface CircularGeofenceRegion {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number; // meters
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

export interface LocationServiceConfig {
  // Performance settings
  distanceFilter: number; // meters - minimum distance for location updates
  desiredAccuracy: number; // meters
  timeout: number; // milliseconds
  maximumAge: number; // milliseconds - cache location data
  
  // Privacy settings
  anonymousMode: boolean; // never store actual coordinates
  backgroundTracking: boolean;
  
}

export interface LocationError {
  code: 'PERMISSION_DENIED' | 'LOCATION_UNAVAILABLE' | 'TIMEOUT' | 'GEOFENCE_ERROR';
  message: string;
}

// Default privacy-first configuration
export const DEFAULT_LOCATION_CONFIG: LocationServiceConfig = {
  distanceFilter: LOCATION_CONSTANTS.DISTANCE_FILTER_NORMAL, // Only update every 50 meters for battery efficiency
  desiredAccuracy: LOCATION_CONSTANTS.ACCURACY_NORMAL, // 100m accuracy is sufficient for parking lots
  timeout: LOCATION_CONSTANTS.TIMEOUT_NORMAL, // 15 second timeout
  maximumAge: LOCATION_CONSTANTS.CACHE_NORMAL, // Cache for 5 minutes to reduce GPS usage
  anonymousMode: true, // Always anonymous
  backgroundTracking: false, // User must opt-in
};
