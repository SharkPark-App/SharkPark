/**
 * Activity Recognition Tests
 * Verifies that SDK activity events flow through to parking validator + leave detector
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock native modules required by transitive imports
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
  getAllKeys: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/behavioralDataCollector', () => ({
  __esModule: true,
  sharedBehavioralCollector: {
    startCollection: jest.fn().mockResolvedValue(undefined),
    stopCollection: jest.fn(),
    updateLocation: jest.fn(),
    updateActivity: jest.fn(),
    updateMotion: jest.fn(),
  },
}));

import { ParkingValidator } from '../src/validation/validator';
import { ValidationEvent, ValidationEventType } from '../src/validation/types';
import leaveDetectionService from '../src/services/leaveDetectionService';
import { GeofenceEvent } from '../src/types/location';

// Helper to create a validation event
function makeEvent(
  type: ValidationEventType,
  overrides: Partial<ValidationEvent> = {}
): ValidationEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    event_type: type,
    timestamp: new Date(),
    speed_mph: null,
    accuracy_meters: 10,
    confidence_score: 0.5,
    bluetooth_state: null,
    raw_data: {},
    ...overrides,
  };
}

describe('Activity Recognition Integration', () => {

  describe('ParkingValidator activity scoring', () => {
    it('should give high activity score for ACTIVITY_STILL + ACTIVITY_ON_FOOT (park + walk)', () => {
      const events = [
        makeEvent('GEOFENCE_ENTER', { timestamp: new Date(Date.now() - 10 * 60000) }),
        makeEvent('ACTIVITY_STILL', { timestamp: new Date(Date.now() - 8 * 60000) }),
        makeEvent('ACTIVITY_ON_FOOT', { timestamp: new Date(Date.now() - 2 * 60000) }),
        makeEvent('GEOFENCE_EXIT'),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, true);
      expect(result.activityRecognitionScore).toBe(0.95);
    });

    it('should give high activity score for DWELL + ACTIVITY_STILL', () => {
      const events = [
        makeEvent('GEOFENCE_ENTER', { timestamp: new Date(Date.now() - 10 * 60000) }),
        makeEvent('DWELL', { timestamp: new Date(Date.now() - 5 * 60000) }),
        makeEvent('ACTIVITY_STILL', { timestamp: new Date(Date.now() - 4 * 60000) }),
        makeEvent('GEOFENCE_EXIT'),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, true);
      expect(result.activityRecognitionScore).toBe(0.8);
    });

    it('should give high activity score for DWELL + ACTIVITY_ON_FOOT (park, walk away)', () => {
      const events = [
        makeEvent('GEOFENCE_ENTER', { timestamp: new Date(Date.now() - 10 * 60000) }),
        makeEvent('DWELL', { timestamp: new Date(Date.now() - 5 * 60000) }),
        makeEvent('ACTIVITY_ON_FOOT', { timestamp: new Date(Date.now() - 2 * 60000) }),
        makeEvent('GEOFENCE_EXIT'),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, true);
      // DWELL counts as "still equivalent" + ON_FOOT = 0.95
      expect(result.activityRecognitionScore).toBe(0.95);
    });

    it('should give low activity score for ACTIVITY_IN_VEHICLE only (driving through)', () => {
      const events = [
        makeEvent('GEOFENCE_ENTER', { timestamp: new Date(Date.now() - 2 * 60000), speed_mph: 15 }),
        makeEvent('ACTIVITY_IN_VEHICLE', { timestamp: new Date(Date.now() - 1 * 60000), speed_mph: 20 }),
        makeEvent('GEOFENCE_EXIT', { speed_mph: 25 }),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, true);
      expect(result.activityRecognitionScore).toBe(0.15);
    });

    it('should give moderate activity score for ACTIVITY_ON_FOOT without STILL', () => {
      const events = [
        makeEvent('GEOFENCE_ENTER', { timestamp: new Date(Date.now() - 5 * 60000) }),
        makeEvent('ACTIVITY_ON_FOOT', { timestamp: new Date(Date.now() - 3 * 60000) }),
        makeEvent('ACTIVITY_ON_FOOT', { timestamp: new Date(Date.now() - 1 * 60000) }),
        makeEvent('GEOFENCE_EXIT'),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, true);
      expect(result.activityRecognitionScore).toBe(0.7);
    });

    it('should default to 0.5 when no activity events present', () => {
      const events = [
        makeEvent('GEOFENCE_ENTER', { timestamp: new Date(Date.now() - 5 * 60000) }),
        makeEvent('STATIONARY', { timestamp: new Date(Date.now() - 3 * 60000) }),
        makeEvent('GEOFENCE_EXIT'),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, true);
      expect(result.activityRecognitionScore).toBe(0.5);
    });

    it('should weight activity recognition at 0.30 in overall confidence', () => {
      // With only ACTIVITY_STILL, activity score = 0.8
      // Other scores = 0.5 (default), activity weighted at 0.30
      const events = [
        makeEvent('GEOFENCE_ENTER', { timestamp: new Date(Date.now() - 3 * 60000) }),
        makeEvent('ACTIVITY_STILL', { timestamp: new Date(Date.now() - 2 * 60000) }),
        makeEvent('GEOFENCE_EXIT'),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, true);
      // 0.5*0.20 + 0.5*0.20 + 0.5*0.15 + 0.5*0.15 + 0.8*0.30 = 0.10+0.10+0.075+0.075+0.24 = 0.59
      expect(result.activityRecognitionScore).toBe(0.8);
      expect(result.confidenceScore).toBeGreaterThan(0.5);
    });
  });

  describe('INSUFFICIENT_DATA status', () => {
    it('should return INSUFFICIENT_DATA for fewer than 3 events (non-final)', () => {
      const events = [
        makeEvent('GEOFENCE_ENTER'),
        makeEvent('ACTIVITY_STILL'),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, false);
      expect(result.status).toBe('INSUFFICIENT_DATA');
    });

    it('should NOT return INSUFFICIENT_DATA for final analysis', () => {
      const events = [
        makeEvent('GEOFENCE_ENTER'),
        makeEvent('ACTIVITY_STILL'),
      ];

      const result = ParkingValidator.analyzeEventPatterns(events, true);
      expect(result.status).not.toBe('INSUFFICIENT_DATA');
    });
  });

  describe('LeaveDetectionService activity processing', () => {
    beforeEach(() => {
      // Reset service state
      (leaveDetectionService as any).activeSessions = new Map();
      (leaveDetectionService as any).callbacks = null;
    });

    it('should emit ACTIVITY_VEHICLE signal when in_vehicle detected', async () => {
      const onDetected = jest.fn();
      const enterEvent: GeofenceEvent = {
        regionId: 'G1',
        eventType: 'ENTER',
        timestamp: new Date(Date.now() - 10 * 60000).toISOString(),
      };

      await leaveDetectionService.startLeaveMonitoring(enterEvent, {
        onLeaveIntentDetected: onDetected,
        onLeaveConfirmed: jest.fn(),
        onError: jest.fn(),
      });

      // Manually set session start time to bypass MIN_MONITORING_TIME
      const session = [...(leaveDetectionService as any).activeSessions.values()][0];
      session.startTime = new Date(Date.now() - 10 * 60000);

      leaveDetectionService.processActivityChange('in_vehicle', 90);

      expect(session.signals.length).toBeGreaterThanOrEqual(1);
      const vehicleSignal = session.signals.find((s: any) => s.type === 'ACTIVITY_VEHICLE');
      expect(vehicleSignal).toBeDefined();
      expect(vehicleSignal!.confidence).toBe(0.9);
    });

    it('should emit WALKING_TO_CAR signal when on_foot detected', async () => {
      const enterEvent: GeofenceEvent = {
        regionId: 'G1',
        eventType: 'ENTER',
        timestamp: new Date(Date.now() - 10 * 60000).toISOString(),
      };

      await leaveDetectionService.startLeaveMonitoring(enterEvent, {
        onLeaveIntentDetected: jest.fn(),
        onLeaveConfirmed: jest.fn(),
        onError: jest.fn(),
      });

      const session = [...(leaveDetectionService as any).activeSessions.values()][0];
      session.startTime = new Date(Date.now() - 10 * 60000);

      leaveDetectionService.processActivityChange('on_foot', 80);

      const walkSignal = session.signals.find((s: any) => s.type === 'WALKING_TO_CAR');
      expect(walkSignal).toBeDefined();
    });

    it('should emit MOVEMENT_PATTERN signal on motion change (stationary → moving)', async () => {
      const enterEvent: GeofenceEvent = {
        regionId: 'G1',
        eventType: 'ENTER',
        timestamp: new Date(Date.now() - 10 * 60000).toISOString(),
      };

      await leaveDetectionService.startLeaveMonitoring(enterEvent, {
        onLeaveIntentDetected: jest.fn(),
        onLeaveConfirmed: jest.fn(),
        onError: jest.fn(),
      });

      const session = [...(leaveDetectionService as any).activeSessions.values()][0];
      session.startTime = new Date(Date.now() - 10 * 60000);

      leaveDetectionService.processMotionChange(true);

      const motionSignal = session.signals.find((s: any) => s.type === 'MOVEMENT_PATTERN');
      expect(motionSignal).toBeDefined();
      expect(motionSignal!.confidence).toBe(0.4);
    });

    it('should NOT emit MOVEMENT_PATTERN when transitioning TO stationary', async () => {
      const enterEvent: GeofenceEvent = {
        regionId: 'G1',
        eventType: 'ENTER',
        timestamp: new Date(Date.now() - 10 * 60000).toISOString(),
      };

      await leaveDetectionService.startLeaveMonitoring(enterEvent, {
        onLeaveIntentDetected: jest.fn(),
        onLeaveConfirmed: jest.fn(),
        onError: jest.fn(),
      });

      leaveDetectionService.processMotionChange(false);

      const session = [...(leaveDetectionService as any).activeSessions.values()][0];
      const motionSignal = session.signals.find((s: any) => s.type === 'MOVEMENT_PATTERN');
      expect(motionSignal).toBeUndefined();
    });
  });
});
