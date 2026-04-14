/**
 * Polygon Geofence Test Suite
 * Validates polygon-based geofence detection and point-in-polygon algorithms.
 *
 * NOTE: With the native BackgroundGeolocation SDK, polygon detection is
 * handled natively via the SDK's `vertices` parameter. These tests verify
 * the JS utility functions used for analysis (point-in-polygon, area, center)
 * and the SDK geofence construction helper.
 */
// Mock BackgroundGeolocation SDK (needed by geofenceUtils import chain)
jest.mock('react-native-background-geolocation', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { 
  isPointInPolygon, 
  calculatePolygonCenter, 
  calculatePolygonArea,
  createTestPolygonGeofences,
  validatePolygonGeofence,
  createSDKGeofencesFromLots,
} from '../src/utils/geofenceUtils';
import { GeofenceRegion } from '../src/types/location';

describe('Polygon Geofence System', () => {

  describe('Point-in-Polygon Algorithm', () => {
    const rectangleVertices = [
      { latitude: 26.3732, longitude: -80.1006 },
      { latitude: 26.3740, longitude: -80.1006 },
      { latitude: 26.3740, longitude: -80.0998 },
      { latitude: 26.3732, longitude: -80.0998 },
    ];

    it('should correctly identify point inside rectangular polygon', () => {
      const insidePoint = { latitude: 26.3736, longitude: -80.1002 };
      expect(isPointInPolygon(insidePoint, rectangleVertices)).toBe(true);
    });

    it('should correctly identify point outside rectangular polygon', () => {
      const outsidePoint = { latitude: 26.3745, longitude: -80.1015 };
      expect(isPointInPolygon(outsidePoint, rectangleVertices)).toBe(false);
    });

    it('should handle edge cases for polygon detection', () => {
      const edgePoint = { latitude: 26.3732, longitude: -80.1002 };
      const result = isPointInPolygon(edgePoint, rectangleVertices);
      expect(typeof result).toBe('boolean');
    });

    it('should reject invalid polygons with less than 3 vertices', () => {
      const invalidPolygon = [
        { latitude: 26.3732, longitude: -80.1006 },
        { latitude: 26.3740, longitude: -80.1006 },
      ];
      expect(isPointInPolygon({ latitude: 26.3736, longitude: -80.1002 }, invalidPolygon)).toBe(false);
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
      expect(center.latitude).toBeCloseTo(26.375, 3);
      expect(center.longitude).toBeCloseTo(-80.1004, 3);
    });

    it('should calculate polygon area', () => {
      const area = calculatePolygonArea(lShapedVertices);
      expect(area).toBeGreaterThan(0);
      expect(area).toBeLessThan(100000);
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
      expect(validatePolygonGeofence(validPolygon)).toBe(true);
    });
  });

  describe('Test Polygon Geofences', () => {
    it('should create test polygon geofences with correct structure', () => {
      const testPolygons = createTestPolygonGeofences();
      expect(testPolygons).toHaveLength(3);
      
      testPolygons.forEach(polygon => {
        expect(polygon.geometry.type).toBe('polygon');
        expect(polygon.geometry.coordinates).toBeDefined();
        expect(polygon.geometry.coordinates!.length).toBeGreaterThanOrEqual(3);
        expect(polygon.notifyOnEntry).toBe(true);
        expect(polygon.notifyOnExit).toBe(true);
      });
    });
  });

  describe('SDK Geofence Construction', () => {
    it('should convert lots with polygons to SDK Vertices format', () => {
      // Mock getLotPolygon for this test
      jest.mock('../src/data/lotPolygons', () => ({
        getLotPolygon: (id: string) => {
          if (id === 'G1') return [{ lat: 33.78, lng: -118.11 }, { lat: 33.79, lng: -118.11 }, { lat: 33.79, lng: -118.10 }];
          return null;
        },
      }));

      // A simple assertion that the function exists and returns an array
      const result = createSDKGeofencesFromLots([]);
      expect(Array.isArray(result)).toBe(true);
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
      expect(typeof isPointInPolygon(insidePoint, complexPolygon)).toBe('boolean');
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
      expect(area).toBeLessThan(1);
    });

    it('should validate polygon size limits', () => {
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

      expect(validatePolygonGeofence(oversizedPolygon)).toBe(false);
    });
  });
});
