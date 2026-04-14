/**
 * Geofence Setup Utilities
 * Convert parking lot data to privacy-focused geofence regions
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { GeofenceRegion } from '../types/location';
import type { Geofence } from 'react-native-background-geolocation';
import { ParkingLotResponse } from '../services/api/lots';
import { GEOFENCE_CONSTANTS } from '../constants/geofencing';
import { getLotPolygon } from '../data/lotPolygons';

/**
 * Convert parking lot API data to SDK Geofence objects for BackgroundGeolocation.
 *
 * Uses polygon Vertices when available (satellite-traced perimeters);
 * falls back to circular geofence from the API.
 */
export function createSDKGeofencesFromLots(lots: ParkingLotResponse[]): Geofence[] {
  return lots
    .filter(lot => lot.center_lat && lot.center_lng && lot.geofence_radius)
    .map(lot => {
      const polygon = getLotPolygon(lot.lot_id);

      const base: Geofence = {
        identifier: lot.lot_id,
        latitude: lot.center_lat,
        longitude: lot.center_lng,
        radius: lot.geofence_radius,
        notifyOnEntry: true,
        notifyOnExit: true,
        notifyOnDwell: false,
        extras: {
          name: lot.display_name || lot.lot_name,
          lotType: lot.lot_type,
        },
      };

      if (polygon) {
        // SDK polygon: vertices as [lat, lng] pairs.
        // When vertices are set, the SDK uses polygon detection natively.
        base.vertices = polygon.map(p => [p.lat, p.lng]);
      }

      return base;
    });
}

/**
 * Convert parking lot API data to geofence regions.
 *
 * Prefers polygon geometry from lotPolygons.ts (real satellite-traced
 * perimeters) when available; falls back to the circular geofence from the
 * API if no polygon is defined for that lot.
 */
export function createGeofenceRegionsFromLots(lots: ParkingLotResponse[]): GeofenceRegion[] {
  return lots
    .filter(lot => {
      // Only create geofences for lots with valid coordinates
      return lot.center_lat && lot.center_lng && lot.geofence_radius;
    })
    .map(lot => {
      const polygon = getLotPolygon(lot.lot_id);

      if (polygon) {
        // Use the real satellite-traced polygon perimeter
        return {
          id: lot.lot_id,
          name: lot.display_name || lot.lot_name,
          geometry: {
            type: 'polygon' as const,
            coordinates: polygon.map(p => ({ latitude: p.lat, longitude: p.lng })),
          },
          notifyOnEntry: true,
          notifyOnExit: true,
        };
      }

      // Fallback: circular geofence from the API
      return {
        id: lot.lot_id,
        name: lot.display_name || lot.lot_name,
        geometry: {
          type: 'circle' as const,
          center: {
            latitude: lot.center_lat,
            longitude: lot.center_lng,
          },
          radius: lot.geofence_radius,
        },
        notifyOnEntry: true,
        notifyOnExit: true,
      };
    });
}

/**
 * Get center coordinates from a geofence region (handles both legacy and modern formats)
 */
function getGeofenceCenter(region: GeofenceRegion): { latitude: number; longitude: number } | null {
  if (region.geometry) {
    // Modern format
    if (region.geometry.type === 'circle' && region.geometry.center) {
      return region.geometry.center;
    } else if (region.geometry.type === 'polygon' && region.geometry.coordinates) {
      return calculatePolygonCenter(region.geometry.coordinates);
    }
  } else {
    // Legacy format
    const legacyRegion = region as any;
    if (legacyRegion.latitude && legacyRegion.longitude) {
      return {
        latitude: legacyRegion.latitude,
        longitude: legacyRegion.longitude,
      };
    }
  }
  return null;
}

/**
 * Prioritize geofence regions for better performance
 * Limits to platform constraints and prioritizes by importance
 */
export function prioritizeGeofenceRegions(
  regions: GeofenceRegion[],
  maxRegions: number = GEOFENCE_CONSTANTS.MAX_REGIONS_IOS, // iOS limit
  userPreferences?: {
    preferredLotTypes?: ('STUDENT' | 'EMPLOYEE')[];
    nearbyOnly?: boolean;
    userLocation?: { latitude: number; longitude: number };
  }
): GeofenceRegion[] {
  let prioritized = [...regions];

  // If user location is available, sort by distance
  if (userPreferences?.nearbyOnly && userPreferences?.userLocation) {
    prioritized = prioritized.sort((a, b) => {
      const centerA = getGeofenceCenter(a);
      const centerB = getGeofenceCenter(b);
      
      if (!centerA || !centerB) return 0;
      
      const distanceA = calculateDistance(
        userPreferences.userLocation!.latitude,
        userPreferences.userLocation!.longitude,
        centerA.latitude,
        centerA.longitude
      );
      const distanceB = calculateDistance(
        userPreferences.userLocation!.latitude,
        userPreferences.userLocation!.longitude,
        centerB.latitude,
        centerB.longitude
      );
      return distanceA - distanceB;
    });
  }

  // Take only the top regions within platform limits
  return prioritized.slice(0, maxRegions);
}

/**
 * Calculate distance between two points (Haversine formula)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_METERS = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c; // Distance in meters
}

function toRadians(degrees: number): number {
  const RADIANS_PER_DEGREE = Math.PI / 180;
  return degrees * RADIANS_PER_DEGREE;
}

/**
 * Validate geofence region configuration (supports both legacy and modern formats)
 */
export function validateGeofenceRegion(region: GeofenceRegion): boolean {
  // Check required fields
  if (!region.id || !region.name) {
    console.warn('[GeofenceUtils] Region missing required fields:', region);
    return false;
  }

  if (region.geometry) {
    // Modern format validation
    if (region.geometry.type === 'circle') {
      if (!region.geometry.center || !region.geometry.radius) {
        console.warn('[GeofenceUtils] Circle geofence missing center or radius:', region);
        return false;
      }
      
      const { latitude, longitude } = region.geometry.center;
      const radius = region.geometry.radius;
      
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        console.warn('[GeofenceUtils] Invalid coordinates:', region.geometry.center);
        return false;
      }
      
      if (radius < 10 || radius > 500) {
        console.warn('[GeofenceUtils] Invalid radius (should be 10-500m):', radius);
        return false;
      }
      
    } else if (region.geometry.type === 'polygon') {
      return validatePolygonGeofence(region);
    }
  } else {
    // Legacy format validation
    const legacyRegion = region as any;
    if (!legacyRegion.latitude || !legacyRegion.longitude || !legacyRegion.radius) {
      console.warn('[GeofenceUtils] Legacy region missing required fields:', region);
      return false;
    }
    
    if (
      legacyRegion.latitude < -90 || legacyRegion.latitude > 90 ||
      legacyRegion.longitude < -180 || legacyRegion.longitude > 180
    ) {
      console.warn('[GeofenceUtils] Invalid legacy coordinates:', legacyRegion);
      return false;
    }

    if (legacyRegion.radius < 10 || legacyRegion.radius > 500) {
      console.warn('[GeofenceUtils] Invalid legacy radius (should be 10-500m):', legacyRegion);
      return false;
    }
  }

  return true;
}

/**
 * Privacy-focused geofence configuration
 * Ensures optimal settings for anonymous tracking
 */
export function getOptimalGeofenceConfig() {
  return {
    // Performance optimizations
    distanceFilter: 50, // Only update every 50 meters
    desiredAccuracy: 100, // 100m accuracy sufficient for parking lots
    timeout: 15000, // 15 second timeout
    maximumAge: 300000, // Cache location for 5 minutes
    
    // Privacy settings
    anonymousMode: true, // Never store coordinates
    backgroundTracking: false, // Require explicit consent
    
    // Battery optimization
    useSignificantChanges: true, // iOS power saving
    enableHighAccuracy: false, // Lower accuracy saves battery
  };
}

/**
 * Estimate battery impact based on configuration
 */
export function estimateBatteryImpact(regionsCount: number, backgroundEnabled: boolean): {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
} {
  if (regionsCount === 0) {
    return {
      level: 'LOW',
      description: 'No geofencing active'
    };
  }

  if (!backgroundEnabled && regionsCount <= 10) {
    return {
      level: 'LOW',
      description: 'Minimal battery usage during app use'
    };
  }

  if (backgroundEnabled && regionsCount <= 10) {
    return {
      level: 'MEDIUM',
      description: 'Moderate battery usage with background tracking'
    };
  }

  return {
    level: 'HIGH',
    description: 'Higher battery usage with many regions monitored'
  };
}

/**
 * POLYGON GEOFENCE UTILITIES
 * Advanced geometric functions for polygon-based parking lot boundaries
 */

/**
 * Point-in-polygon detection using ray casting algorithm
 * Determines if a GPS coordinate is inside a polygon geofence
 * 
 * @param point - GPS coordinate to test
 * @param polygon - Array of polygon vertices (lat/lng coordinates)
 * @returns true if point is inside polygon, false otherwise
 */
export function isPointInPolygon(
  point: { latitude: number; longitude: number },
  polygon: Array<{ latitude: number; longitude: number }>
): boolean {
  if (polygon.length < 3) {
    console.warn('[GeofenceUtils] Polygon must have at least 3 vertices');
    return false;
  }

  const { latitude: x, longitude: y } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { latitude: xi, longitude: yi } = polygon[i];
    const { latitude: xj, longitude: yj } = polygon[j];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Calculate the centroid (center point) of a polygon
 * Useful for display purposes and distance calculations
 */
export function calculatePolygonCenter(
  polygon: Array<{ latitude: number; longitude: number }>
): { latitude: number; longitude: number } {
  if (polygon.length === 0) {
    throw new Error('Cannot calculate center of empty polygon');
  }

  const sum = polygon.reduce(
    (acc, point) => ({
      latitude: acc.latitude + point.latitude,
      longitude: acc.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 }
  );

  return {
    latitude: sum.latitude / polygon.length,
    longitude: sum.longitude / polygon.length,
  };
}

/**
 * Calculate approximate area of a polygon in square meters
 * Uses spherical excess formula for better accuracy on Earth's surface
 */
export function calculatePolygonArea(
  polygon: Array<{ latitude: number; longitude: number }>
): number {
  if (polygon.length < 3) return 0;

  const EARTH_RADIUS = 6371000; // Earth's radius in meters
  let area = 0;

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const lat1 = toRadians(polygon[i].latitude);
    const lat2 = toRadians(polygon[j].latitude);
    const deltaLon = toRadians(polygon[j].longitude - polygon[i].longitude);

    area += deltaLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  return Math.abs(area) * EARTH_RADIUS * EARTH_RADIUS / 2;
}

/**
 * Convert parking lot with boundary coordinates to polygon geofence
 * @param lot - Parking lot data with boundary coordinates
 * @returns GeofenceRegion with polygon geometry
 */
export function createPolygonGeofenceFromLot(
  lot: ParkingLotResponse & {
    boundary_coordinates?: Array<{ latitude: number; longitude: number }>;
  }
): GeofenceRegion {
  if (!lot.boundary_coordinates || lot.boundary_coordinates.length < 3) {
    throw new Error(`Invalid boundary coordinates for lot ${lot.lot_id}`);
  }

  return {
    id: lot.lot_id,
    name: lot.display_name || lot.lot_name,
    geometry: {
      type: 'polygon',
      coordinates: lot.boundary_coordinates,
    },
    notifyOnEntry: true,
    notifyOnExit: true,
  };
}

/**
 * Convert legacy circular geofence to new format
 * @param legacyRegion - Old circular geofence region
 * @returns GeofenceRegion with circle geometry
 */
export function legacyToModernGeofence(
  legacyRegion: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radius: number;
    notifyOnEntry: boolean;
    notifyOnExit: boolean;
  }
): GeofenceRegion {
  return {
    id: legacyRegion.id,
    name: legacyRegion.name,
    geometry: {
      type: 'circle',
      center: {
        latitude: legacyRegion.latitude,
        longitude: legacyRegion.longitude,
      },
      radius: legacyRegion.radius,
    },
    notifyOnEntry: legacyRegion.notifyOnEntry,
    notifyOnExit: legacyRegion.notifyOnExit,
  };
}

/**
 * Validate polygon geofence region
 * Checks for valid coordinates, reasonable size, etc.
 */
export function validatePolygonGeofence(region: GeofenceRegion): boolean {
  if (region.geometry.type !== 'polygon' || !region.geometry.coordinates) {
    return false;
  }

  const coordinates = region.geometry.coordinates;

  // Must have at least 3 vertices
  if (coordinates.length < 3) {
    console.warn('[GeofenceUtils] Polygon must have at least 3 vertices:', region);
    return false;
  }

  // Check for valid latitude/longitude ranges
  for (const point of coordinates) {
    if (
      point.latitude < -90 || point.latitude > 90 ||
      point.longitude < -180 || point.longitude > 180
    ) {
      console.warn('[GeofenceUtils] Invalid coordinates:', point);
      return false;
    }
  }

  // Check for reasonable polygon size (not too big or too small)
  const area = calculatePolygonArea(coordinates);
  const MAX_PARKING_LOT_AREA = 100000; // 100,000 sq meters (about 25 acres)
  const MIN_PARKING_LOT_AREA = 100; // 100 sq meters (about 1,000 sq feet)

  if (area > MAX_PARKING_LOT_AREA || area < MIN_PARKING_LOT_AREA) {
    console.warn('[GeofenceUtils] Polygon area seems unreasonable:', area, 'sq meters');
    return false;
  }

  return true;
}

/**
 * Create example polygon geofences for testing
 * Defines realistic parking lot shapes around university areas
 */
export function createTestPolygonGeofences(): GeofenceRegion[] {
  return [
    {
      id: 'lot_poly_1',
      name: 'Rectangular Parking Lot',
      geometry: {
        type: 'polygon',
        coordinates: [
          { latitude: 26.3732, longitude: -80.1006 }, // Southwest corner
          { latitude: 26.3740, longitude: -80.1006 }, // Northwest corner
          { latitude: 26.3740, longitude: -80.0998 }, // Northeast corner
          { latitude: 26.3732, longitude: -80.0998 }, // Southeast corner
        ],
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    },
    {
      id: 'lot_poly_2',
      name: 'L-Shaped Parking Area',
      geometry: {
        type: 'polygon',
        coordinates: [
          { latitude: 26.3745, longitude: -80.1010 },
          { latitude: 26.3755, longitude: -80.1010 },
          { latitude: 26.3755, longitude: -80.1005 },
          { latitude: 26.3750, longitude: -80.1005 },
          { latitude: 26.3750, longitude: -80.1000 },
          { latitude: 26.3745, longitude: -80.1000 },
        ],
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    },
    {
      id: 'lot_poly_3',
      name: 'Irregular Parking Lot',
      geometry: {
        type: 'polygon',
        coordinates: [
          { latitude: 26.3760, longitude: -80.1015 },
          { latitude: 26.3768, longitude: -80.1012 },
          { latitude: 26.3770, longitude: -80.1005 },
          { latitude: 26.3765, longitude: -80.1000 },
          { latitude: 26.3760, longitude: -80.1008 },
        ],
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    },
  ];
}
