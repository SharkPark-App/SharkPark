/**
 * Geofence Setup Utilities
 * Convert parking lot data to privacy-focused geofence regions
 */

import { GeofenceRegion } from '../types/location';
import type { Geofence } from 'react-native-background-geolocation';
import { ParkingLotResponse } from '../services/api/lots';

/**
 * Convert parking lot API data to SDK Geofence objects for BackgroundGeolocation.
 *
 * Uses polygon vertices from the API response (satellite-traced perimeters
 * stored in the database); falls back to circular geofence when the polygon
 * has fewer than 3 vertices.
 */
export function createSDKGeofencesFromLots(lots: ParkingLotResponse[]): Geofence[] {
  return lots
    .filter(lot => lot.center_lat && lot.center_lng && lot.geofence_radius)
    .map(lot => {
      const polygon = lot.geofence_polygon;
      const hasPolygon = Array.isArray(polygon) && polygon.length >= 3;

      const base: Geofence = {
        identifier: lot.lot_id,
        latitude: lot.center_lat,
        longitude: lot.center_lng,
        radius: lot.geofence_radius,
        notifyOnEntry: true,
        notifyOnExit: true,
        notifyOnDwell: true,
        loiteringDelay: 300000, // 5 minutes — native DWELL = parking confirmation signal
        extras: {
          lot_name: lot.display_name || lot.lot_name,
          lot_type: lot.lot_type,
          capacity: lot.capacity,
        },
      };

      if (hasPolygon) {
        // SDK polygon: vertices as [lat, lng] pairs.
        // When vertices are set, the SDK uses polygon detection natively.
        base.vertices = polygon.map(p => [p.lat, p.lng]);
      }

      return base;
    });
}

/**
 * Validate geofence region configuration
 */
export function validateGeofenceRegion(region: GeofenceRegion): boolean {
  if (!region.id || !region.name) {
    console.warn('[GeofenceUtils] Region missing required fields:', region);
    return false;
  }

  if (!region.geometry) {
    console.warn('[GeofenceUtils] Region missing geometry:', region);
    return false;
  }

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

  return true;
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
  const toRad = (deg: number) => deg * (Math.PI / 180);
  let area = 0;

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const lat1 = toRad(polygon[i].latitude);
    const lat2 = toRad(polygon[j].latitude);
    const deltaLon = toRad(polygon[j].longitude - polygon[i].longitude);

    area += deltaLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  return Math.abs(area) * EARTH_RADIUS * EARTH_RADIUS / 2;
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
