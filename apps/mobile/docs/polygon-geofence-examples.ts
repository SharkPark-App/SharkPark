/**
 * Polygon Geofence Usage Examples
 * Shows how to implement polygon-based parking lot detection
 */

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
        { latitude: 26.3732, longitude: -80.1006 }, // Southwest corner
        { latitude: 26.3740, longitude: -80.1006 }, // Northwest corner  
        { latitude: 26.3740, longitude: -80.0998 }, // Northeast corner
        { latitude: 26.3732, longitude: -80.0998 }, // Southeast corner
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
        { latitude: 26.3745, longitude: -80.1010 },
        { latitude: 26.3755, longitude: -80.1010 },
        { latitude: 26.3755, longitude: -80.1005 },
        { latitude: 26.3750, longitude: -80.1005 }, // Inner corner
        { latitude: 26.3750, longitude: -80.1000 },
        { latitude: 26.3745, longitude: -80.1000 },
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
      { latitude: 26.3760, longitude: -80.1015 },
      { latitude: 26.3768, longitude: -80.1012 },
      { latitude: 26.3770, longitude: -80.1005 },
      { latitude: 26.3765, longitude: -80.1000 },
      { latitude: 26.3760, longitude: -80.1008 },
    ],
    // ... other API fields
  };

  return createPolygonGeofenceFromLot(apiLotData);
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
    console.log(`Polygon Geofence Event: ${event.eventType} - ${event.regionId}`);
    
    // Handle the event (send to API, show notification, etc.)
    switch (event.eventType) {
      case 'ENTER':
        console.log(`User entered polygon parking lot: ${event.regionId}`);
        // Send anonymous occupancy data
        break;
      case 'EXIT':
        console.log(`User exited polygon parking lot: ${event.regionId}`);
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
    { name: 'Center of lot', point: { latitude: 26.3736, longitude: -80.1002 } },
    { name: 'Outside lot', point: { latitude: 26.3745, longitude: -80.1015 } },
    { name: 'Near edge', point: { latitude: 26.3732, longitude: -80.1000 } },
  ];

  testPoints.forEach(({ name, point }) => {
    const isInside = isPointInPolygon(point, coordinates);
    console.log(`${name}: ${isInside ? 'INSIDE' : 'OUTSIDE'} parking lot`);
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
          { latitude: 26.3720, longitude: -80.1020 },
          { latitude: 26.3730, longitude: -80.1020 },
          { latitude: 26.3730, longitude: -80.1010 },
          { latitude: 26.3720, longitude: -80.1010 },
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
          { latitude: 26.3740, longitude: -80.1030 },
          { latitude: 26.3750, longitude: -80.1030 },
          { latitude: 26.3750, longitude: -80.1020 },
          { latitude: 26.3745, longitude: -80.1020 }, // Building cutout
          { latitude: 26.3745, longitude: -80.1015 },
          { latitude: 26.3740, longitude: -80.1015 },
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
          { latitude: 26.3760, longitude: -80.1040 },
          { latitude: 26.3770, longitude: -80.1035 }, // Curved boundary
          { latitude: 26.3775, longitude: -80.1025 },
          { latitude: 26.3770, longitude: -80.1015 },
          { latitude: 26.3760, longitude: -80.1020 },
          { latitude: 26.3755, longitude: -80.1030 },
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

  console.log('Polygon vs Circular Geofence Comparison:');
  console.log('=====================================');
  console.log('Polygon Lot:', polygonLot.name);
  console.log('- Exact boundaries match physical lot');
  console.log('- No false triggers from adjacent areas');
  console.log('- Handles rectangular shape precisely');
  console.log('');
  console.log('Circular Lot:', circularLot.name);
  console.log('- 50m radius covers area beyond parking lot');
  console.log('- May trigger from sidewalks, roads, other lots');
  console.log('- Cannot match rectangular layout');

  // Test points to show difference
  const testPoints = [
    { latitude: 26.3736, longitude: -80.1002 }, // Center - both should detect
    { latitude: 26.3732, longitude: -80.1015 }, // Outside polygon, inside circle
    { latitude: 26.3745, longitude: -80.1002 }, // Outside polygon, inside circle
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

    console.log(`Test Point ${index + 1}:`);
    console.log(`- Polygon detection: ${inPolygon ? 'INSIDE' : 'OUTSIDE'}`);
    console.log(`- Circular detection: ${inCircle ? 'INSIDE' : 'OUTSIDE'}`);
    console.log(`- Distance from center: ${distance.toFixed(1)}m`);
    console.log('');
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
