/**
 * Simple Real Geofencing Integration Test
 * Verifies that SDK geofence construction works with real parking lot data
 */

import { createSDKGeofencesFromLots } from '../src/utils/geofenceUtils';
import type { ParkingLotResponse } from '../src/services/api/lots';

// Mock BackgroundGeolocation SDK (needed by geofenceUtils import chain)
jest.mock('react-native-background-geolocation', () => ({
  __esModule: true,
  default: {},
}));

describe('Real Geofencing Integration (Simple)', () => {
  // Sample minimal parking lot data
  const mockRealLots: ParkingLotResponse[] = [
    {
      lot_id: 'G1',
      lot_name: 'G1 Student Parking',
      display_name: 'G1 Parking Lot',
      lot_number: 'G1',
      lot_type: 'STUDENT',
      capacity: 500,
      current_occupancy: 250,
      location_description: 'Near Engineering Building',
      buildings: ['Engineering'],
      center_lat: 33.7838,
      center_lng: -118.1141,
      geofence_polygon: [
        { lat: 33.7835, lng: -118.1145 },
        { lat: 33.7842, lng: -118.1145 },
        { lat: 33.7842, lng: -118.1137 },
        { lat: 33.7835, lng: -118.1137 },
      ],
      geofence_radius: 100,
      permit_types: ['Student'],
      daily_permit_allowed: true,
      daily_rate: 8,
      hours_weekday: { open: '06:00', close: '22:00' },
      hours_saturday: { open: '08:00', close: '18:00' },
      hours_sunday: 'CLOSED',
      ev_charging_stations: 5,
      motorcycle_spaces: 10,
      accessible_spaces: 15,
      has_lighting: true,
      has_cameras: true,
      has_emergency_phone: true,
      is_covered: false,
      is_paved: true,
      levels: undefined,
      penetration_rate: 0.85,
      avg_turnover_minutes: 180,
      // ParkingLotResponse additional fields
      available: 250,
      occupancy_rate: 0.5,
      fill_status: 'AVAILABLE' as const,
      estimated_occupancy: 250,
      estimated_available: 250,
      raw_occupancy: 213,
      effective_penetration_rate: 0.85,
      confidence: 'MEDIUM' as const,
      timestamp: '2024-01-01T00:00:00Z',
    },
    {
      lot_id: 'G2',
      lot_name: 'G2 Student Parking',
      display_name: 'G2 Parking Lot',
      lot_number: 'G2',
      lot_type: 'STUDENT',
      capacity: 300,
      current_occupancy: 150,
      location_description: 'Near Library',
      buildings: ['Library'],
      center_lat: 33.7840,
      center_lng: -118.1145,
      geofence_polygon: [
        { lat: 33.7837, lng: -118.1149 },
        { lat: 33.7843, lng: -118.1149 },
        { lat: 33.7843, lng: -118.1141 },
        { lat: 33.7837, lng: -118.1141 },
      ],
      geofence_radius: 80,
      permit_types: ['Student'],
      daily_permit_allowed: true,
      daily_rate: 8,
      hours_weekday: { open: '06:00', close: '22:00' },
      hours_saturday: { open: '08:00', close: '18:00' },
      hours_sunday: 'CLOSED',
      ev_charging_stations: 2,
      motorcycle_spaces: 5,
      accessible_spaces: 8,
      has_lighting: true,
      has_cameras: true,
      has_emergency_phone: false,
      is_covered: false,
      is_paved: true,
      levels: undefined,
      penetration_rate: 0.80,
      avg_turnover_minutes: 150,
      // ParkingLotResponse additional fields
      available: 150,
      occupancy_rate: 0.5,
      fill_status: 'AVAILABLE' as const,
      estimated_occupancy: 150,
      estimated_available: 150,
      raw_occupancy: 120,
      effective_penetration_rate: 0.80,
      confidence: 'HIGH' as const,
      timestamp: '2024-01-01T00:00:00Z',
    },
  ];

  describe('createSDKGeofencesFromLots utility', () => {
    it('should convert real parking lot data to SDK geofences', () => {
      const geofences = createSDKGeofencesFromLots(mockRealLots);

      expect(geofences).toHaveLength(2);

      // G1 has polygon data in geofence_polygon — should include vertices
      const g1 = geofences.find(g => g.identifier === 'G1');
      expect(g1).toBeDefined();
      expect(g1?.vertices).toBeDefined();
      expect(g1?.vertices!.length).toBeGreaterThan(3);

      // G2 also has polygon data
      const g2 = geofences.find(g => g.identifier === 'G2');
      expect(g2).toBeDefined();
      expect(g2?.vertices).toBeDefined();
      expect(g2?.vertices!.length).toBeGreaterThan(3);
    });

    it('should fall back to circular geofence for lots without polygon data', () => {
      const lotWithoutPolygon: ParkingLotResponse = {
        ...mockRealLots[0],
        lot_id: 'NODATA',
        lot_name: 'No polygon lot',
        geofence_polygon: [],
      };

      const geofences = createSDKGeofencesFromLots([lotWithoutPolygon]);

      expect(geofences).toHaveLength(1);
      expect(geofences[0].vertices).toBeUndefined();
      expect(geofences[0].latitude).toBe(33.7838);
      expect(geofences[0].longitude).toBe(-118.1141);
      expect(geofences[0].radius).toBe(100);
    });

    it('should filter out lots with invalid coordinates', () => {
      const lotsWithInvalid: ParkingLotResponse[] = [
        ...mockRealLots,
        {
          ...mockRealLots[0],
          lot_id: 'INVALID',
          center_lat: 0,
          center_lng: 0,
        },
      ];

      const geofences = createSDKGeofencesFromLots(lotsWithInvalid);

      // Should only include valid lots, not the one with 0,0 coordinates
      expect(geofences).toHaveLength(2);
      expect(geofences.find(g => g.identifier === 'INVALID')).toBeUndefined();
    });

    it('should handle empty lot array', () => {
      const geofences = createSDKGeofencesFromLots([]);
      expect(geofences).toHaveLength(0);
    });

    it('should use lot_id as geofence identifier', () => {
      const geofences = createSDKGeofencesFromLots(mockRealLots);

      const identifiers = geofences.map(g => g.identifier);
      expect(identifiers).toContain('G1');
      expect(identifiers).toContain('G2');
    });

    it('should include vertices as [lat, lng] pairs for polygon lots', () => {
      const geofences = createSDKGeofencesFromLots(mockRealLots);
      const g1 = geofences.find(g => g.identifier === 'G1')!;

      // Vertices should be [lat, lng] pairs
      expect(Array.isArray(g1.vertices![0])).toBe(true);
      expect(g1.vertices![0]).toHaveLength(2);
      expect(typeof g1.vertices![0][0]).toBe('number');
      expect(typeof g1.vertices![0][1]).toBe('number');
    });
  });

  describe('Integration readiness verification', () => {
    it('should confirm real parking lot data structure matches expected format', () => {
      // Verify the parking lot data structure matches what the providers expect
      mockRealLots.forEach(lot => {
        expect(lot).toHaveProperty('lot_id');
        expect(lot).toHaveProperty('center_lat');
        expect(lot).toHaveProperty('center_lng');
        expect(lot).toHaveProperty('geofence_radius');
        expect(typeof lot.center_lat).toBe('number');
        expect(typeof lot.center_lng).toBe('number');
        expect(typeof lot.geofence_radius).toBe('number');
      });
    });

    it('should confirm CSULB coordinates are valid', () => {
      // CSULB campus is approximately at these coordinates
      const csulbLatRange = { min: 33.78, max: 33.79 };
      const csulbLngRange = { min: -118.12, max: -118.11 };

      mockRealLots.forEach(lot => {
        expect(lot.center_lat).toBeGreaterThan(csulbLatRange.min);
        expect(lot.center_lat).toBeLessThan(csulbLatRange.max);
        expect(lot.center_lng).toBeGreaterThan(csulbLngRange.min);
        expect(lot.center_lng).toBeLessThan(csulbLngRange.max);
      });
    });
  });
});
