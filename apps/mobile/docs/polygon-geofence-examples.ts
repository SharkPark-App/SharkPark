/**
 * Polygon Geofence Usage Examples
 * Shows how to implement polygon-based parking lot detection
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { GeofenceRegion } from '../src/types/location';
import { createPolygonGeofenceFromLot, isPointInPolygon, calculatePolygonCenter } from '../src/utils/geofenceUtils';
import locationService from '../src/services/locationService';

// Example 1: Create a rectangular parking lot geofence
export function createRectangularLotExample(): GeofenceRegion {
  return {
    id: 'north_campus_lot',
    name: 'North Campus Parking Structure',
    geometry: {
      type: 'polygon',
      coordinates: [
        { latitude: 33.7830, longitude: -118.1120 }, // Southwest corner
        { latitude: 33.7840, longitude: -118.1120 }, // Northwest corner  
        { latitude: 33.7840, longitude: -118.1110 }, // Northeast corner
        { latitude: 33.7830, longitude: -118.1110 }, // Southeast corner
      ],
    },
    notifyOnEntry: true,
    notifyOnExit: true,
  };
}

// Example 2: Create an L-shaped parking lot
export function createLShapedLotExample(): GeofenceRegion {
  return {
    id: 'student_center_lot',
    name: 'Student Center L-Shaped Lot',
    geometry: {
      type: 'polygon',
      coordinates: [
        { latitude: 33.7845, longitude: -118.1130 },
        { latitude: 33.7855, longitude: -118.1130 },
        { latitude: 33.7855, longitude: -118.1120 },
        { latitude: 33.7850, longitude: -118.1120 }, // Inner corner
        { latitude: 33.7850, longitude: -118.1110 },
        { latitude: 33.7845, longitude: -118.1110 },
      ],
    },
    notifyOnEntry: true,
    notifyOnExit: true,
  };
}

// Example 3: Convert API data to polygon geofence
export function createPolygonFromAPIData() {
  // Simulate API data with boundary coordinates
  const apiLotData = {
    lot_id: 'api_polygon_lot',
    lot_name: 'Engineering Building Lot',
    display_name: 'Engineering Parking',
    boundary_coordinates: [
      { latitude: 33.7860, longitude: -118.1140 },
      { latitude: 33.7868, longitude: -118.1135 },
      { latitude: 33.7870, longitude: -118.1125 },
      { latitude: 33.7865, longitude: -118.1120 },
      { latitude: 33.7860, longitude: -118.1130 },
    ],
    // ... other API fields
  };

  // TODO: Fix type compatibility with createPolygonGeofenceFromLot
  // return createPolygonGeofenceFromLot(apiLotData);
  
  // Return a mock region for now
  return {
    id: apiLotData.lot_id,
    name: apiLotData.lot_name,
    geometry: {
      type: 'polygon',
      coordinates: apiLotData.boundary_coordinates,
    },
    notifyOnEntry: true,
    notifyOnExit: true,
  } as GeofenceRegion;
}

// Example 4: Set up multiple polygon geofences
export async function setupPolygonGeofencingSystem() {
  const polygonLots = [
    createRectangularLotExample(),
    createLShapedLotExample(),
    createPolygonFromAPIData(),
  ];

  // Set up event listener for polygon geofence events
  locationService.setOnGeofenceEvent((event) => {
    // Handle the event (send to API, show notification, etc.)
    switch (event.eventType) {
      case 'ENTER':
        // User entered polygon parking lot
        // Send anonymous occupancy data
        break;
      case 'EXIT':
        // User exited polygon parking lot
        // Send anonymous departure data
        break;
    }
  });

  // Add the polygon geofences to the location service
  locationService.addGeofenceRegions(polygonLots);
  
  // Start location tracking
  return await locationService.startLocationTracking();
}

// Example 5: Test if a point is inside a parking lot
export function testPointInLot() {
  const lot = createRectangularLotExample();
  const coordinates = lot.geometry.coordinates!;

  // Test various points
  const testPoints = [
    { name: 'Center of lot', point: { latitude: 33.7835, longitude: -118.1115 } },
    { name: 'Outside lot', point: { latitude: 33.7845, longitude: -118.1135 } },
    { name: 'Near edge', point: { latitude: 33.7830, longitude: -118.1110 } },
  ];

  testPoints.forEach(({ name, point }) => {
    const isInside = isPointInPolygon(point, coordinates);
    // Test results: return { name, point, isInside } for production use
  });
}

// Example 6: Create geofences that match real parking lot layouts
export function createRealisticParkingLots(): GeofenceRegion[] {
  return [
    // Standard rectangular lot (most common)
    {
      id: 'lot_rectangular_main',
      name: 'Main Campus Rectangular Lot',
      geometry: {
        type: 'polygon',
        coordinates: [
          { latitude: 33.7820, longitude: -118.1140 },
          { latitude: 33.7830, longitude: -118.1140 },
          { latitude: 33.7830, longitude: -118.1130 },
          { latitude: 33.7820, longitude: -118.1130 },
        ],
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    },

    // Parking lot that wraps around a building (L-shaped)
    {
      id: 'lot_wrap_around',
      name: 'Library Wrap-Around Lot',
      geometry: {
        type: 'polygon',
        coordinates: [
          { latitude: 33.7840, longitude: -118.1150 },
          { latitude: 33.7850, longitude: -118.1150 },
          { latitude: 33.7850, longitude: -118.1140 },
          { latitude: 33.7845, longitude: -118.1140 }, // Building cutout
          { latitude: 33.7845, longitude: -118.1135 },
          { latitude: 33.7840, longitude: -118.1135 },
        ],
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    },

    // Irregularly shaped lot following natural boundaries
    {
      id: 'lot_irregular_natural',
      name: 'Athletic Complex Natural Boundary Lot',
      geometry: {
        type: 'polygon',
        coordinates: [
          { latitude: 33.7860, longitude: -118.1160 },
          { latitude: 33.7870, longitude: -118.1155 }, // Curved boundary
          { latitude: 33.7875, longitude: -118.1145 },
          { latitude: 33.7870, longitude: -118.1135 },
          { latitude: 33.7860, longitude: -118.1140 },
          { latitude: 33.7855, longitude: -118.1150 },
        ],
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    },
  ];
}

// Example 7: Compare polygon vs circular coverage
export function compareCoverageExample() {
  const polygonLot = createRectangularLotExample();
  const polygonCoords = polygonLot.geometry.coordinates!;
  const polygonCenter = calculatePolygonCenter(polygonCoords);

  // Equivalent circular geofence (traditional approach)
  const circularLot = {
    id: 'same_lot_circular',
    name: 'Same Lot (Circular)',
    geometry: {
      type: 'circle' as const,
      center: polygonCenter,
      radius: 50, // 50 meter radius
    },
    notifyOnEntry: true,
    notifyOnExit: true,
  };

  // Comparison between polygon and circular geofences:
  // Polygon Lot: Exact boundaries match physical lot, no false triggers from adjacent areas
  // Circular Lot: 50m radius covers area beyond parking lot, may trigger from sidewalks/roads

  // Test points to show difference
  const testPoints = [
    { latitude: 33.7835, longitude: -118.1115 }, // Center - both should detect
    { latitude: 33.7830, longitude: -118.1135 }, // Outside polygon, inside circle
    { latitude: 33.7845, longitude: -118.1115 }, // Outside polygon, inside circle
  ];

  testPoints.forEach((point, index) => {
    const inPolygon = isPointInPolygon(point, polygonCoords);
    // Simulate circular check (distance from center <= radius)
    const distance = calculateDistance(
      point.latitude,
      point.longitude,
      polygonCenter.latitude,
      polygonCenter.longitude
    );
    const inCircle = distance <= 50;

    // Test results can be returned as data structure instead of console output
    // For production use, return: { inPolygon, inCircle, distance }
  });
}

// Helper function for distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_METERS = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
