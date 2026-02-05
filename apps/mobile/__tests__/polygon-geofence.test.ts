/**
 * Polygon Geofence Test Suite
 * Validates polygon-based geofence detection and point-in-polygon algorithms
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock React Native modules first
jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
  stopObserving: jest.fn(),
  setRNConfiguration: jest.fn(),
  requestAuthorization: jest.fn(),
}));

jest.mock('react-native', () => {
  return {
    Platform: { OS: 'ios' },
    Alert: { alert: jest.fn() },
    AppState: { currentState: 'active', addEventListener: jest.fn() },
    NativeEventEmitter: class MockEventEmitter {
      addListener = jest.fn();
      removeListener = jest.fn();
    },
    NativeModules: {},
    TurboModuleRegistry: {
      getEnforcing: jest.fn(),
      get: jest.fn(),
    },
  };
});

import locationService from '../src/services/locationService';
import { 
  isPointInPolygon, 
  calculatePolygonCenter, 
  calculatePolygonArea,
  createTestPolygonGeofences,
  validatePolygonGeofence
} from '../src/utils/geofenceUtils';
import { GeofenceRegion } from '../src/types/location';

describe('Polygon Geofence System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up listeners
    locationService['onGeofenceEventListeners'] = [];
    locationService['currentRegions'] = new Set();
  });

  describe('Point-in-Polygon Algorithm', () => {
    const rectangleVertices = [
      { latitude: 26.3732, longitude: -80.1006 }, // SW corner
      { latitude: 26.3740, longitude: -80.1006 }, // NW corner
      { latitude: 26.3740, longitude: -80.0998 }, // NE corner
      { latitude: 26.3732, longitude: -80.0998 }, // SE corner
    ];

    it('should correctly identify point inside rectangular polygon', () => {
      const insidePoint = { latitude: 26.3736, longitude: -80.1002 }; // Center
      const result = isPointInPolygon(insidePoint, rectangleVertices);
      expect(result).toBe(true);
    });

    it('should correctly identify point outside rectangular polygon', () => {
      const outsidePoint = { latitude: 26.3745, longitude: -80.1015 }; // North of rectangle
      const result = isPointInPolygon(outsidePoint, rectangleVertices);
      expect(result).toBe(false);
    });

    it('should handle edge cases for polygon detection', () => {
      // Point on the edge (should be handled consistently)
      const edgePoint = { latitude: 26.3732, longitude: -80.1002 }; // On south edge
      const result = isPointInPolygon(edgePoint, rectangleVertices);
      expect(typeof result).toBe('boolean'); // Should return a boolean result
    });

    it('should reject invalid polygons with less than 3 vertices', () => {
      const invalidPolygon = [
        { latitude: 26.3732, longitude: -80.1006 },
        { latitude: 26.3740, longitude: -80.1006 },
      ];
      const point = { latitude: 26.3736, longitude: -80.1002 };
      const result = isPointInPolygon(point, invalidPolygon);
      expect(result).toBe(false);
    });
  });

  describe('Polygon Utility Functions', () => {
    const lShapedVertices = [
      { latitude: 26.3745, longitude: -80.1010 },
      { latitude: 26.3755, longitude: -80.1010 },
      { latitude: 26.3755, longitude: -80.1005 },
      { latitude: 26.3750, longitude: -80.1005 },
      { latitude: 26.3750, longitude: -80.1000 },
      { latitude: 26.3745, longitude: -80.1000 },
    ];

    it('should calculate polygon center correctly', () => {
      const center = calculatePolygonCenter(lShapedVertices);
      
      expect(center.latitude).toBeCloseTo(26.375, 3); // Approximate center latitude
      expect(center.longitude).toBeCloseTo(-80.1004, 3); // Approximate center longitude
    });

    it('should calculate polygon area', () => {
      const area = calculatePolygonArea(lShapedVertices);
      
      expect(area).toBeGreaterThan(0); // Should have positive area
      expect(area).toBeLessThan(100000); // Should be reasonable for parking lot
    });

    it('should validate polygon geofence correctly', () => {
      const validPolygon: GeofenceRegion = {
        id: 'test_polygon',
        name: 'Test Polygon',
        geometry: {
          type: 'polygon',
          coordinates: lShapedVertices,
        },
        notifyOnEntry: true,
        notifyOnExit: true,
      };

      const isValid = validatePolygonGeofence(validPolygon);
      expect(isValid).toBe(true);
    });
  });

  describe('Polygon Geofence Detection', () => {
    let testPolygons: GeofenceRegion[];
    let mockGeofenceEvents: any[];

    beforeEach(() => {
      testPolygons = createTestPolygonGeofences();
      mockGeofenceEvents = [];

      // Set up event listener to capture geofence events
      const eventListener = (event: any) => {
        mockGeofenceEvents.push(event);
      };
      locationService.setOnGeofenceEvent(eventListener);
    });

    it('should create test polygon geofences with correct structure', () => {
      expect(testPolygons).toHaveLength(3);
      
      testPolygons.forEach(polygon => {
        expect(polygon.geometry.type).toBe('polygon');
        expect(polygon.geometry.coordinates).toBeDefined();
        expect(polygon.geometry.coordinates!.length).toBeGreaterThanOrEqual(3);
        expect(polygon.notifyOnEntry).toBe(true);
        expect(polygon.notifyOnExit).toBe(true);
      });
    });

    it('should detect entry into rectangular polygon parking lot', async () => {
      // Add polygon geofences to location service
      locationService.addGeofenceRegions(testPolygons);

      // Simulate GPS position inside rectangular lot
      const insidePosition = {
        latitude: 26.3736, // Inside rectangular lot
        longitude: -80.1002,
        timestamp: Date.now()
      };

      // Trigger location update (simulate GPS)
      locationService['checkGeofences'](insidePosition);

      // Wait for async processing
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));

      // Should trigger ENTER event for rectangular lot
      const enterEvents = mockGeofenceEvents.filter(e => 
        e.eventType === 'ENTER' && e.regionId === 'lot_poly_1'
      );
      expect(enterEvents.length).toBe(1);
    });

    it('should detect exit from polygon parking lot', async () => {
      // Add polygon geofences
      locationService.addGeofenceRegions(testPolygons);

      // First simulate being inside
      const insidePosition = {
        latitude: 26.3736,
        longitude: -80.1002,
        timestamp: Date.now()
      };
      locationService['checkGeofences'](insidePosition);

      // Clear events and simulate moving outside
      mockGeofenceEvents.length = 0;
      const outsidePosition = {
        latitude: 26.3720, // Outside all polygons
        longitude: -80.1020,
        timestamp: Date.now() + 1000
      };
      locationService['checkGeofences'](outsidePosition);

      // Wait for async processing
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));

      // Should trigger EXIT event
      const exitEvents = mockGeofenceEvents.filter(e => 
        e.eventType === 'EXIT' && e.regionId === 'lot_poly_1'
      );
      expect(exitEvents.length).toBe(1);
    });

    it('should handle L-shaped polygon correctly', async () => {
      locationService.addGeofenceRegions(testPolygons);

      // Position inside the L-shaped area
      const lShapeInsidePosition = {
        latitude: 26.3750, // Inside L-shaped lot
        longitude: -80.1008,
        timestamp: Date.now()
      };

      locationService['checkGeofences'](lShapeInsidePosition);
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));

      // Should trigger ENTER event for L-shaped lot
      const enterEvents = mockGeofenceEvents.filter(e => 
        e.eventType === 'ENTER' && e.regionId === 'lot_poly_2'
      );
      expect(enterEvents.length).toBe(1);
    });

    it('should handle multiple polygon overlaps correctly', async () => {
      locationService.addGeofenceRegions(testPolygons);

      // Position that might be near multiple polygons
      const testPosition = {
        latitude: 26.3760,
        longitude: -80.1010,
        timestamp: Date.now()
      };

      locationService['checkGeofences'](testPosition);
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));

      // Should only trigger events for polygons that actually contain the point
      const enterEvents = mockGeofenceEvents.filter(e => e.eventType === 'ENTER');
      
      // Verify events are only for polygons that actually contain the point
      enterEvents.forEach(event => {
        const polygon = testPolygons.find(p => p.id === event.regionId);
        expect(polygon).toBeDefined();
        if (polygon?.geometry.coordinates) {
          const isInside = isPointInPolygon(testPosition, polygon.geometry.coordinates);
          expect(isInside).toBe(true);
        }
      });
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle complex irregular polygons', () => {
      const complexPolygon = [
        { latitude: 26.3760, longitude: -80.1015 },
        { latitude: 26.3768, longitude: -80.1012 },
        { latitude: 26.3770, longitude: -80.1005 },
        { latitude: 26.3765, longitude: -80.1000 },
        { latitude: 26.3760, longitude: -80.1008 },
      ];

      const insidePoint = { latitude: 26.3765, longitude: -80.1008 };
      const result = isPointInPolygon(insidePoint, complexPolygon);
      expect(typeof result).toBe('boolean');
    });

    it('should handle very small polygons', () => {
      const smallPolygon = [
        { latitude: 26.3736000, longitude: -80.1002000 },
        { latitude: 26.3736001, longitude: -80.1002000 },
        { latitude: 26.3736001, longitude: -80.1002001 },
        { latitude: 26.3736000, longitude: -80.1002001 },
      ];

      const area = calculatePolygonArea(smallPolygon);
      expect(area).toBeGreaterThan(0);
      expect(area).toBeLessThan(1); // Very small area
    });

    it('should validate polygon size limits', () => {
      // Create oversized polygon
      const oversizedPolygon: GeofenceRegion = {
        id: 'oversized',
        name: 'Oversized Polygon',
        geometry: {
          type: 'polygon',
          coordinates: [
            { latitude: 26.0000, longitude: -80.5000 },
            { latitude: 26.5000, longitude: -80.5000 },
            { latitude: 26.5000, longitude: -79.5000 },
            { latitude: 26.0000, longitude: -79.5000 },
          ],
        },
        notifyOnEntry: true,
        notifyOnExit: true,
      };

      const isValid = validatePolygonGeofence(oversizedPolygon);
      expect(isValid).toBe(false); // Should be invalid due to size
    });
  });
});
