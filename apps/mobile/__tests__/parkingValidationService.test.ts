import parkingValidationService from '../src/services/parkingValidationService';
import { ParkingValidator } from '../src/validation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GeofenceEvent } from '../src/types/location';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  getAllKeys: jest.fn(),
}));

// Mock the parking validation package
jest.mock('../src/validation', () => ({
  ParkingValidator: {
    analyzeEventPatterns: jest.fn(),
    calculateConfidenceScore: jest.fn(),
    generateLocalTestHash: jest.fn(),
  },
}));

// Mock the behavioral data collector
jest.mock('../src/services/behavioralDataCollector', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    startCollection: jest.fn(),
    stopCollection: jest.fn(),
    getCurrentMetrics: jest.fn(),
  })),
  sharedBehavioralCollector: {
    startCollection: jest.fn(),
    stopCollection: jest.fn(),
    getCurrentMetrics: jest.fn(),
    updateLocation: jest.fn(),
  },
}));

describe('ParkingValidationService', () => {
  const mockGeofenceEvent: GeofenceEvent = {
    eventType: 'ENTER',
    regionId: 'test-lot-1',
    timestamp: '2026-03-09T12:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset service state — clear timers first to prevent "log after tests" errors
    for (const timer of parkingValidationService['sessionTimers'].values()) {
      clearTimeout(timer);
    }
    parkingValidationService['sessionTimers'].clear();
    parkingValidationService['activeSessions'].clear();
    parkingValidationService['eventBuffer'] = [];
    parkingValidationService['validationCompleteListeners'] = [];
  });

  afterAll(() => {
    // Final cleanup of any session timers created in the last test
    for (const timer of parkingValidationService['sessionTimers'].values()) {
      clearTimeout(timer);
    }
    parkingValidationService['sessionTimers'].clear();
  });

  describe('Session Management', () => {
    it('should start a parking session when user enters geofence', async () => {
      const sessionId = await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^parking-\d+-[a-z0-9]+$/);
      
      // Should have created an active session
      const sessions = parkingValidationService['activeSessions'];
      expect(sessions.size).toBe(1);
      
      const session = sessions.values().next().value;
      expect(session).toBeDefined();
      if (session) {
        expect(session.lotId).toBe('test-lot-1');
        expect(session.status).toBe('ACTIVE');
        expect(session.events).toHaveLength(1);
        expect(session.events[0].event_type).toBe('GEOFENCE_ENTER');
      }
    });

    it('should not start session for EXIT events', async () => {
      const exitEvent = { ...mockGeofenceEvent, eventType: 'EXIT' as const };
      
      const sessionId = await parkingValidationService.startParkingSession(exitEvent);
      
      expect(sessionId).toBe('');
      expect(parkingValidationService['activeSessions'].size).toBe(0);
    });

    it('should complete session and analyze patterns on geofence exit', async () => {
      // Start session
      await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      // Mock analysis result
      const mockAnalysis = {
        status: 'PARKED' as const,
        confidenceScore: 0.85,
        contributesToOccupancy: true,
        speedTransitionScore: 0.9,
        dwellTimeScore: 0.8,
        movementPatternScore: 0.85,
        bluetoothScore: 0.7,
        metadata: {
          event_count: 5,
          time_span_minutes: 3.5,
          speed_range: [0, 2] as [number, number],
          analysis_timestamp: '2026-03-09T12:00:00.000Z'
        }
      };
      
      (ParkingValidator.analyzeEventPatterns as jest.Mock).mockReturnValue(mockAnalysis);
      
      // Complete session
      const exitEvent = { ...mockGeofenceEvent, eventType: 'EXIT' as const };
      const result = await parkingValidationService.completeParkingSession(exitEvent);
      
      expect(result).toEqual(mockAnalysis);
      expect(ParkingValidator.analyzeEventPatterns).toHaveBeenCalledWith(
        expect.any(Array),
        true 
      );
      
      // Session should be cleaned up
      expect(parkingValidationService['activeSessions'].size).toBe(0);
    });

    it('should return null when completing session for non-existent lot', async () => {
      const exitEvent = { ...mockGeofenceEvent, eventType: 'EXIT' as const, regionId: 'non-existent' };
      
      const result = await parkingValidationService.completeParkingSession(exitEvent);
      
      expect(result).toBeNull();
    });
  });

  describe('Behavioral Event Recording', () => {
    it('should record behavioral events during active session', async () => {
      // Start session
      const sessionId = await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      // Record behavioral event
      parkingValidationService.recordBehavioralEvent(
        'STATIONARY',
        { speed_mph: undefined, accuracy_meters: 5 }
      );
      
      const session = parkingValidationService['activeSessions'].get(sessionId);
      expect(session?.events).toHaveLength(2); // ENTER + STATIONARY
      
      const stationaryEvent = session?.events[1];
      expect(stationaryEvent?.event_type).toBe('STATIONARY');
      expect(stationaryEvent?.speed_mph).toBeNull();
      expect(stationaryEvent?.accuracy_meters).toBe(5);
    });

    it('should not record events for inactive sessions', () => {
      parkingValidationService.recordBehavioralEvent(
        'STATIONARY',
        { speed_mph: undefined }
      );
      
      expect(parkingValidationService['activeSessions'].size).toBe(0);
    });

    it('should calculate confidence scores for events', async () => {
      (ParkingValidator.calculateConfidenceScore as jest.Mock).mockReturnValue(0.75);
      
      await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      parkingValidationService.recordBehavioralEvent(
        'DRIVING',
        { speed_mph: 15, accuracy_meters: 8 }
      );
      
      expect(ParkingValidator.calculateConfidenceScore).toHaveBeenCalledWith({
        speed: 15,
        accuracy: 8,
        bluetoothState: undefined,
        eventType: 'DRIVING',
      });
    });
  });

  describe('Session Persistence', () => {
    it('should persist sessions to AsyncStorage', async () => {
      const sessionId = await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        `parking_session_${sessionId}`,
        expect.stringContaining('"status":"ACTIVE"')
      );
    });

    it('should load persisted sessions on initialization', async () => {
      const mockKeys = ['parking_session_test-123', 'other_key'];
      const mockSession = {
        sessionId: 'test-123',
        lotId: 'test-lot-1',
        startTime: '2026-03-09T12:00:00.000Z',
        events: [],
        status: 'ACTIVE'
      };

      (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue(mockKeys);
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'parking_session_test-123') {
          return Promise.resolve(JSON.stringify(mockSession));
        }
        return Promise.resolve(null);
      });

      await parkingValidationService['loadPersistedSessions']();
      
      expect(AsyncStorage.getAllKeys).toHaveBeenCalled();
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('parking_session_test-123');
    });

    it('should clean up persisted sessions after completion', async () => {
      const sessionId = await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      // Mock analysis
      (ParkingValidator.analyzeEventPatterns as jest.Mock).mockReturnValue({
        status: 'PARKED',
        confidenceScore: 0.8,
        contributesToOccupancy: true,
        speedTransitionScore: 0.9,
        dwellTimeScore: 0.8,
        movementPatternScore: 0.85,
        bluetoothScore: 0.7,
        metadata: {
          event_count: 3,
          time_span_minutes: 2.5,
          speed_range: [0, 1],
          analysis_timestamp: '2026-03-09T12:00:00.000Z'
        }
      });
      
      const exitEvent = { ...mockGeofenceEvent, eventType: 'EXIT' as const };
      await parkingValidationService.completeParkingSession(exitEvent);
      
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(`parking_session_${sessionId}`);
    });
  });

  describe('Validation Analysis', () => {
    it('should get current validation status during active session', async () => {
      await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      // Add some behavioral events
      parkingValidationService.recordBehavioralEvent('STATIONARY', { speed_mph: 0 });
      parkingValidationService.recordBehavioralEvent('WALKING', { speed_mph: 2 });
      parkingValidationService.recordBehavioralEvent('STATIONARY', { speed_mph: 0 });
      
      const mockPreliminaryAnalysis = {
        status: 'ANALYZING' as const,
        confidenceScore: 0.6,
        contributesToOccupancy: false,
        speedTransitionScore: 0.7,
        dwellTimeScore: 0.5,
        movementPatternScore: 0.6,
        bluetoothScore: 0.5,
        metadata: {
          event_count: 4,
          time_span_minutes: 1.5,
          speed_range: [0, 2] as [number, number],
          analysis_timestamp: '2026-03-09T12:00:00.000Z'
        }
      };
      
      (ParkingValidator.analyzeEventPatterns as jest.Mock).mockReturnValue(mockPreliminaryAnalysis);
      
      const status = await parkingValidationService.getCurrentValidationStatus('test-lot-1');
      
      expect(status).toEqual(mockPreliminaryAnalysis);
      expect(ParkingValidator.analyzeEventPatterns).toHaveBeenCalledWith(
        expect.any(Array),
        false 
      );
    });

    it('should return null for non-existent sessions', async () => {
      const status = await parkingValidationService.getCurrentValidationStatus('non-existent-lot');
      expect(status).toBeNull();
    });

    it('should return null for sessions with insufficient events', async () => {
      await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      // Only has GEOFENCE_ENTER event (1 event < 3 minimum)
      const status = await parkingValidationService.getCurrentValidationStatus('test-lot-1');
      
      expect(status).toBeNull();
    });
  });

  describe('Event Listeners', () => {
    it('should notify listeners when validation completes', async () => {
      const mockListener = jest.fn();
      parkingValidationService.onValidationComplete(mockListener);
      
      await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      const mockAnalysis = {
        status: 'PARKED' as const,
        confidenceScore: 0.9,
        contributesToOccupancy: true,
        speedTransitionScore: 0.95,
        dwellTimeScore: 0.9,
        movementPatternScore: 0.85,
        bluetoothScore: 0.8,
        metadata: {
          event_count: 6,
          time_span_minutes: 4.0,
          speed_range: [0, 3] as [number, number],
          analysis_timestamp: '2026-03-09T12:00:00.000Z'
        }
      };
      
      (ParkingValidator.analyzeEventPatterns as jest.Mock).mockReturnValue(mockAnalysis);
      
      const exitEvent = { ...mockGeofenceEvent, eventType: 'EXIT' as const };
      await parkingValidationService.completeParkingSession(exitEvent);
      
      expect(mockListener).toHaveBeenCalledWith(mockAnalysis, 'test-lot-1');
    });

    it('should remove listeners correctly', () => {
      const mockListener1 = jest.fn();
      const mockListener2 = jest.fn();
      
      parkingValidationService.onValidationComplete(mockListener1);
      parkingValidationService.onValidationComplete(mockListener2);
      
      parkingValidationService.removeValidationListener(mockListener1);
      
      // Verify only mockListener2 remains
      const listeners = parkingValidationService['validationCompleteListeners'];
      expect(listeners).toHaveLength(1);
      expect(listeners[0]).toBe(mockListener2);
    });
  });

  describe('Error Handling', () => {
    it('should handle AsyncStorage errors gracefully', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('Storage error'));
      
      // Should not throw, just log error
      await expect(
        parkingValidationService.startParkingSession(mockGeofenceEvent)
      ).resolves.toBeDefined();
    });

    it('should handle analysis errors gracefully', async () => {
      await parkingValidationService.startParkingSession(mockGeofenceEvent);
      
      (ParkingValidator.analyzeEventPatterns as jest.Mock).mockImplementation(() => {
        throw new Error('Analysis error');
      });
      
      const status = await parkingValidationService.getCurrentValidationStatus('test-lot-1');
      expect(status).toBeNull();
    });
  });
});
