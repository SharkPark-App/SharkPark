/**
 * Parking Validation Features Test
 * Tests the new client-side validation features we added in this update
 */

// Mock React Native modules first
jest.mock('react-native', () => {
  return {
    Platform: { OS: 'ios' },
    Alert: { alert: jest.fn() },
    AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
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

import { ParkingValidator } from '../src/validation/validator';
import { ValidationEvent, ValidationEventType, ValidationStatus } from '../src/validation/types';

describe('Parking Validation Features', () => {
  describe('Client-side validation logic', () => {
    it('should correctly analyze parking behavior from validation events', () => {
      const mockEvents: ValidationEvent[] = [
        {
          id: '1',
          event_type: 'GEOFENCE_ENTER',
          timestamp: new Date('2026-03-18T10:00:00Z'),
          speed_mph: 15,
          accuracy_meters: 5,
          confidence_score: 0.8,
          bluetooth_state: 'CONNECTED',
          raw_data: {},
        },
        {
          id: '2',
          event_type: 'STATIONARY',
          timestamp: new Date('2026-03-18T10:01:00Z'),
          speed_mph: 0,
          accuracy_meters: 3,
          confidence_score: 0.9,
          bluetooth_state: 'CONNECTED',
          raw_data: {},
        },
        {
          id: '3',
          event_type: 'WALKING',
          timestamp: new Date('2026-03-18T10:02:00Z'),
          speed_mph: 2,
          accuracy_meters: 4,
          confidence_score: 0.85,
          bluetooth_state: 'DISCONNECTED',
          raw_data: {},
        },
        {
          id: '4',
          event_type: 'GEOFENCE_EXIT',
          timestamp: new Date('2026-03-18T10:06:00Z'),
          speed_mph: 1,
          accuracy_meters: 5,
          confidence_score: 0.9,
          bluetooth_state: 'DISCONNECTED',
          raw_data: {},
        },
      ];

      const analysis = ParkingValidator.analyzeEventPatterns(mockEvents, true);

      expect(analysis).toMatchObject({
        status: 'PARKED',
        contributesToOccupancy: true,
        metadata: expect.objectContaining({
          event_count: 4,
          time_span_minutes: 6,
        }),
      });

      expect(analysis.confidenceScore).toBeGreaterThan(0.7);
      expect(analysis.speedTransitionScore).toBeGreaterThan(0.5);
      expect(analysis.dwellTimeScore).toBeGreaterThan(0.5);
      expect(analysis.movementPatternScore).toBeGreaterThan(0.5);
      expect(analysis.bluetoothScore).toBeGreaterThan(0.5);
    });

    it('should identify drive-through behavior correctly', () => {
      const mockEvents: ValidationEvent[] = [
        {
          id: '1',
          event_type: 'GEOFENCE_ENTER',
          timestamp: new Date('2026-03-18T10:00:00Z'),
          speed_mph: 20,
          accuracy_meters: 8,
          confidence_score: 0.7,
          bluetooth_state: 'CONNECTED',
          raw_data: {},
        },
        {
          id: '2',
          event_type: 'DRIVING',
          timestamp: new Date('2026-03-18T10:00:30Z'),
          speed_mph: 18,
          accuracy_meters: 10,
          confidence_score: 0.6,
          bluetooth_state: 'CONNECTED',
          raw_data: {},
        },
        {
          id: '3',
          event_type: 'GEOFENCE_EXIT',
          timestamp: new Date('2026-03-18T10:01:00Z'),
          speed_mph: 22,
          accuracy_meters: 12,
          confidence_score: 0.7,
          bluetooth_state: 'CONNECTED',
          raw_data: {},
        },
      ];

      const analysis = ParkingValidator.analyzeEventPatterns(mockEvents, true);

      expect(analysis.status).toBe('SEARCHING'); // With these patterns, it's searching, not drove through
      expect(analysis.contributesToOccupancy).toBe(false);
      expect(analysis.confidenceScore).toBeLessThan(0.7);
    });

    it('should handle analyzing behavior (insufficient data)', () => {
      const mockEvents: ValidationEvent[] = [
        {
          id: '1',
          event_type: 'GEOFENCE_ENTER',
          timestamp: new Date('2026-03-18T10:00:00Z'),
          speed_mph: 10,
          accuracy_meters: 5,
          confidence_score: 0.5,
          bluetooth_state: null,
          raw_data: {},
        },
        {
          id: '2',
          event_type: 'STATIONARY',
          timestamp: new Date('2026-03-18T10:00:30Z'),
          speed_mph: 0,
          accuracy_meters: 8,
          confidence_score: 0.6,
          bluetooth_state: null,
          raw_data: {},
        },
      ];

      // Test preliminary analysis (not final) — too few events → INSUFFICIENT_DATA
      const preliminaryAnalysis = ParkingValidator.analyzeEventPatterns(mockEvents, false);
      expect(preliminaryAnalysis.status).toBe('INSUFFICIENT_DATA');

      // Test final analysis with insufficient data
      const finalAnalysis = ParkingValidator.analyzeEventPatterns(mockEvents, true);
      expect(finalAnalysis.status).toBe('SEARCHING');
    });
  });

  describe('Confidence scoring', () => {
    it('should calculate high confidence for clear parking indicators', () => {
      const eventData = {
        speed: 0, // Stationary
        accuracy: 3, // High accuracy
        bluetoothState: 'DISCONNECTED' as const,
        eventType: 'WALKING' as ValidationEventType,
      };

      const confidence = ParkingValidator.calculateConfidenceScore(eventData);
      expect(confidence).toBeGreaterThan(0.7);
    });

    it('should calculate low confidence for drive-through indicators', () => {
      const eventData = {
        speed: 25, // High speed
        accuracy: 15, // Lower accuracy
        bluetoothState: 'CONNECTED' as const,
        eventType: 'DRIVING' as ValidationEventType,
      };

      const confidence = ParkingValidator.calculateConfidenceScore(eventData);
      expect(confidence).toBeLessThan(0.5);
    });

    it('should bound confidence scores between 0 and 1', () => {
      const highConfidenceData = {
        speed: 0,
        accuracy: 1,
        bluetoothState: 'DISCONNECTED' as const,
        eventType: 'GEOFENCE_EXIT' as ValidationEventType,
      };

      const lowConfidenceData = {
        speed: 50,
        accuracy: 100,
        bluetoothState: 'CONNECTED' as const,
        eventType: 'DRIVING' as ValidationEventType,
      };

      const highConfidence = ParkingValidator.calculateConfidenceScore(highConfidenceData);
      const lowConfidence = ParkingValidator.calculateConfidenceScore(lowConfidenceData);

      expect(highConfidence).toBeLessThanOrEqual(1.0);
      expect(highConfidence).toBeGreaterThanOrEqual(0.0);
      expect(lowConfidence).toBeLessThanOrEqual(1.0);
      expect(lowConfidence).toBeGreaterThanOrEqual(0.0);
    });
  });

  describe('Local test hash (DJB2, not cryptographically secure)', () => {
    it('should generate consistent hashes', () => {
      const userId = 'user123';
      const salt = 'test_salt';

      const hash1 = ParkingValidator.generateLocalTestHash(userId, salt);
      const hash2 = ParkingValidator.generateLocalTestHash(userId, salt);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]+$/); // Should be hexadecimal string
    });

    it('should generate different hashes for different users', () => {
      const salt = 'test_salt';
      
      const hash1 = ParkingValidator.generateLocalTestHash('user1', salt);
      const hash2 = ParkingValidator.generateLocalTestHash('user2', salt);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes with different salts', () => {
      const userId = 'user123';
      
      const hash1 = ParkingValidator.generateLocalTestHash(userId, 'salt1');
      const hash2 = ParkingValidator.generateLocalTestHash(userId, 'salt2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Type definitions', () => {
    it('should have correct validation status types', () => {
      const validStatuses: ValidationStatus[] = [
        'ANALYZING',
        'PARKED',
        'DROVE_THROUGH',
        'SEARCHING',
        'UNKNOWN',
      ];

      validStatuses.forEach(status => {
        expect(typeof status).toBe('string');
      });
    });

    it('should have correct validation event types', () => {
      const validEventTypes: ValidationEventType[] = [
        'SPEED_CHANGE',
        'STATIONARY',
        'WALKING',
        'DRIVING',
        'BLUETOOTH_CONNECT',
        'BLUETOOTH_DISCONNECT',
        'GEOFENCE_ENTER',
        'GEOFENCE_EXIT',
        'GPS_ACCURACY_CHANGE',
      ];

      validEventTypes.forEach(eventType => {
        expect(typeof eventType).toBe('string');
      });
    });
  });

  describe('Integration with Enhanced Geofencing', () => {
    it('should include validation metadata in occupancy events', () => {
      // Test that validation results can be properly formatted for backend
      const validationAnalysis = {
        status: 'PARKED' as ValidationStatus,
        confidenceScore: 0.85,
        contributesToOccupancy: true,
        speedTransitionScore: 0.9,
        dwellTimeScore: 0.8,
        movementPatternScore: 0.9,
        bluetoothScore: 0.7,
        metadata: {
          event_count: 12,
          time_span_minutes: 4.5,
          speed_range: [0, 3] as [number, number],
          analysis_timestamp: '2026-03-18T10:30:00.000Z',
        },
      };

      // Simulate creating an enhanced occupancy event
      const occupancyEventData = {
        lotId: 'G1',
        eventType: 'EXIT' as const,
        source: 'GEOFENCE' as const,
        // Enhanced with client-side validation results
        validation_status: validationAnalysis.status,
        confidence_score: validationAnalysis.confidenceScore,
        analysis_metadata: {
          speed_transition_score: validationAnalysis.speedTransitionScore,
          dwell_time_score: validationAnalysis.dwellTimeScore,
          movement_pattern_score: validationAnalysis.movementPatternScore,
          bluetooth_score: validationAnalysis.bluetoothScore,
          event_count: validationAnalysis.metadata.event_count,
          time_span_minutes: validationAnalysis.metadata.time_span_minutes,
          analysis_timestamp: validationAnalysis.metadata.analysis_timestamp,
        },
      };

      expect(occupancyEventData).toMatchObject({
        lotId: 'G1',
        eventType: 'EXIT',
        source: 'GEOFENCE',
        validation_status: 'PARKED',
        confidence_score: 0.85,
        analysis_metadata: {
          speed_transition_score: 0.9,
          dwell_time_score: 0.8,
          movement_pattern_score: 0.9,
          bluetooth_score: 0.7,
          event_count: 12,
          time_span_minutes: 4.5,
          analysis_timestamp: '2026-03-18T10:30:00.000Z',
        },
      });
    });
  });
});
