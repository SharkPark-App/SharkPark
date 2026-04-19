import {
  isPointInPolygon,
  calculatePolygonCenter,
  calculatePolygonArea,
  validateGeofenceRegion,
  validatePolygonGeofence,
  estimateBatteryImpact,
  createSDKGeofencesFromLots,
} from '../src/utils/geofenceUtils';
import { GeofenceRegion } from '../src/types/location';

// Simple square polygon (approx 100m x 100m near equator)
const squarePolygon = [
  { latitude: 0.0, longitude: 0.0 },
  { latitude: 0.001, longitude: 0.0 },
  { latitude: 0.001, longitude: 0.001 },
  { latitude: 0.0, longitude: 0.001 },
];

// CSULB-area polygon (realistic parking lot)
const csulbLot = [
  { latitude: 33.7830, longitude: -118.1140 },
  { latitude: 33.7840, longitude: -118.1140 },
  { latitude: 33.7840, longitude: -118.1130 },
  { latitude: 33.7830, longitude: -118.1130 },
];

describe('isPointInPolygon', () => {
  it('should return true for point inside polygon', () => {
    const inside = { latitude: 0.0005, longitude: 0.0005 };
    expect(isPointInPolygon(inside, squarePolygon)).toBe(true);
  });

  it('should return false for point outside polygon', () => {
    const outside = { latitude: 0.01, longitude: 0.01 };
    expect(isPointInPolygon(outside, squarePolygon)).toBe(false);
  });

  it('should return false for point far outside polygon', () => {
    const farAway = { latitude: 45.0, longitude: 90.0 };
    expect(isPointInPolygon(farAway, squarePolygon)).toBe(false);
  });

  it('should return false for less than 3 vertices', () => {
    const point = { latitude: 0, longitude: 0 };
    const line = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }];
    expect(isPointInPolygon(point, line)).toBe(false);
  });

  it('should work with complex polygon shapes', () => {
    // L-shaped polygon
    const lShape = [
      { latitude: 0.0, longitude: 0.0 },
      { latitude: 0.002, longitude: 0.0 },
      { latitude: 0.002, longitude: 0.001 },
      { latitude: 0.001, longitude: 0.001 },
      { latitude: 0.001, longitude: 0.002 },
      { latitude: 0.0, longitude: 0.002 },
    ];
    // Point in the lower-left part of the L
    expect(isPointInPolygon({ latitude: 0.0005, longitude: 0.0005 }, lShape)).toBe(true);
    // Point in the upper-right "cutout" of the L
    expect(isPointInPolygon({ latitude: 0.0015, longitude: 0.0015 }, lShape)).toBe(false);
  });
});

describe('calculatePolygonCenter', () => {
  it('should calculate centroid of a square', () => {
    const center = calculatePolygonCenter(squarePolygon);
    expect(center.latitude).toBeCloseTo(0.0005, 4);
    expect(center.longitude).toBeCloseTo(0.0005, 4);
  });

  it('should calculate center of CSULB lot', () => {
    const center = calculatePolygonCenter(csulbLot);
    expect(center.latitude).toBeCloseTo(33.7835, 3);
    expect(center.longitude).toBeCloseTo(-118.1135, 3);
  });

  it('should throw for empty polygon', () => {
    expect(() => calculatePolygonCenter([])).toThrow('Cannot calculate center of empty polygon');
  });
});

describe('calculatePolygonArea', () => {
  it('should return area in square meters for a realistic lot', () => {
    const area = calculatePolygonArea(csulbLot);
    // ~110m x ~85m ≈ 9,350 sq meters (rough, depends on projection)
    expect(area).toBeGreaterThan(5000);
    expect(area).toBeLessThan(20000);
  });

  it('should return 0 for less than 3 vertices', () => {
    expect(calculatePolygonArea([])).toBe(0);
    expect(calculatePolygonArea([{ latitude: 0, longitude: 0 }])).toBe(0);
  });

  it('should return positive area regardless of vertex winding order', () => {
    const reversed = [...csulbLot].reverse();
    const area1 = calculatePolygonArea(csulbLot);
    const area2 = calculatePolygonArea(reversed);
    expect(area1).toBeCloseTo(area2, 0);
  });
});

describe('estimateBatteryImpact', () => {
  it('should return LOW for no regions', () => {
    const result = estimateBatteryImpact(0, false);
    expect(result.level).toBe('LOW');
  });

  it('should return LOW for few regions without background', () => {
    const result = estimateBatteryImpact(5, false);
    expect(result.level).toBe('LOW');
  });

  it('should return MEDIUM for background with few regions', () => {
    const result = estimateBatteryImpact(5, true);
    expect(result.level).toBe('MEDIUM');
  });

  it('should return HIGH for many regions with background', () => {
    const result = estimateBatteryImpact(20, true);
    expect(result.level).toBe('HIGH');
  });

  it('should return HIGH for many regions without background', () => {
    const result = estimateBatteryImpact(20, false);
    expect(result.level).toBe('HIGH');
  });
});

describe('validateGeofenceRegion', () => {
  const validCircle: GeofenceRegion = {
    id: 'lot-1',
    name: 'Test Lot',
    geometry: {
      type: 'circle',
      center: { latitude: 33.78, longitude: -118.11 },
      radius: 100,
    },
    notifyOnEntry: true,
    notifyOnExit: true,
  };

  it('should validate a correct circle region', () => {
    expect(validateGeofenceRegion(validCircle)).toBe(true);
  });

  it('should reject missing id', () => {
    expect(validateGeofenceRegion({ ...validCircle, id: '' })).toBe(false);
  });

  it('should reject missing name', () => {
    expect(validateGeofenceRegion({ ...validCircle, name: '' })).toBe(false);
  });

  it('should reject missing geometry', () => {
    expect(validateGeofenceRegion({ ...validCircle, geometry: undefined as never })).toBe(false);
  });

  it('should reject invalid latitude', () => {
    const bad = {
      ...validCircle,
      geometry: { ...validCircle.geometry, center: { latitude: 91, longitude: 0 } },
    };
    expect(validateGeofenceRegion(bad)).toBe(false);
  });

  it('should reject radius too small', () => {
    const bad = { ...validCircle, geometry: { ...validCircle.geometry, radius: 5 } };
    expect(validateGeofenceRegion(bad)).toBe(false);
  });

  it('should reject radius too large', () => {
    const bad = { ...validCircle, geometry: { ...validCircle.geometry, radius: 600 } };
    expect(validateGeofenceRegion(bad)).toBe(false);
  });

  it('should reject circle missing center', () => {
    const bad = { ...validCircle, geometry: { type: 'circle' as const, radius: 100 } };
    expect(validateGeofenceRegion(bad)).toBe(false);
  });
});

describe('validatePolygonGeofence', () => {
  it('should validate a correct polygon region', () => {
    // Use the test polygon geofences from the utility itself
    const region: GeofenceRegion = {
      id: 'lot-poly',
      name: 'Test Polygon',
      geometry: {
        type: 'polygon',
        coordinates: csulbLot,
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    };
    expect(validatePolygonGeofence(region)).toBe(true);
  });

  it('should reject polygon with fewer than 3 vertices', () => {
    const region: GeofenceRegion = {
      id: 'lot-bad',
      name: 'Bad',
      geometry: {
        type: 'polygon',
        coordinates: [csulbLot[0], csulbLot[1]],
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    };
    expect(validatePolygonGeofence(region)).toBe(false);
  });

  it('should reject polygon with invalid coordinates', () => {
    const region: GeofenceRegion = {
      id: 'lot-bad',
      name: 'Bad',
      geometry: {
        type: 'polygon',
        coordinates: [
          { latitude: 91, longitude: 0 }, // invalid
          { latitude: 0, longitude: 0 },
          { latitude: 0, longitude: 1 },
        ],
      },
      notifyOnEntry: true,
      notifyOnExit: true,
    };
    expect(validatePolygonGeofence(region)).toBe(false);
  });

  it('should reject non-polygon type', () => {
    const region: GeofenceRegion = {
      id: 'lot',
      name: 'Circle',
      geometry: { type: 'circle', center: { latitude: 0, longitude: 0 }, radius: 100 },
      notifyOnEntry: true,
      notifyOnExit: true,
    };
    expect(validatePolygonGeofence(region)).toBe(false);
  });
});

describe('createSDKGeofencesFromLots', () => {
  it('should convert lots to SDK geofences', () => {
    const lots = [
      {
        lot_id: 'G1',
        lot_name: 'Lot G1',
        display_name: 'Garage 1',
        lot_type: 'STRUCTURE',
        center_lat: 33.78,
        center_lng: -118.11,
        geofence_radius: 100,
        capacity: 500,
        geofence_polygon: null,
      },
    ];

    const geofences = createSDKGeofencesFromLots(lots as never[]);

    expect(geofences).toHaveLength(1);
    expect(geofences[0].identifier).toBe('G1');
    expect(geofences[0].latitude).toBe(33.78);
    expect(geofences[0].longitude).toBe(-118.11);
    expect(geofences[0].radius).toBe(100);
    expect(geofences[0].notifyOnEntry).toBe(true);
    expect(geofences[0].notifyOnExit).toBe(true);
    expect(geofences[0].notifyOnDwell).toBe(true);
    expect(geofences[0].extras?.lot_name).toBe('Garage 1');
  });

  it('should use polygon vertices when available', () => {
    const lots = [
      {
        lot_id: 'G1',
        lot_name: 'Lot G1',
        display_name: 'Garage 1',
        lot_type: 'STRUCTURE',
        center_lat: 33.78,
        center_lng: -118.11,
        geofence_radius: 100,
        capacity: 500,
        geofence_polygon: [
          { lat: 33.783, lng: -118.114 },
          { lat: 33.784, lng: -118.114 },
          { lat: 33.784, lng: -118.113 },
          { lat: 33.783, lng: -118.113 },
        ],
      },
    ];

    const geofences = createSDKGeofencesFromLots(lots as never[]);

    expect(geofences[0].vertices).toEqual([
      [33.783, -118.114],
      [33.784, -118.114],
      [33.784, -118.113],
      [33.783, -118.113],
    ]);
  });

  it('should skip lots missing required fields', () => {
    const lots = [
      { lot_id: 'G1', lot_name: 'G1', center_lat: null, center_lng: -118.11, geofence_radius: 100 },
      { lot_id: 'G2', lot_name: 'G2', center_lat: 33.78, center_lng: -118.11, geofence_radius: null },
    ];

    const geofences = createSDKGeofencesFromLots(lots as never[]);
    expect(geofences).toHaveLength(0);
  });

  it('should not include vertices for polygon with fewer than 3 points', () => {
    const lots = [
      {
        lot_id: 'G1',
        lot_name: 'Lot G1',
        display_name: 'Garage 1',
        lot_type: 'STRUCTURE',
        center_lat: 33.78,
        center_lng: -118.11,
        geofence_radius: 100,
        capacity: 500,
        geofence_polygon: [{ lat: 33.783, lng: -118.114 }],
      },
    ];

    const geofences = createSDKGeofencesFromLots(lots as never[]);
    expect(geofences[0].vertices).toBeUndefined();
  });
});
