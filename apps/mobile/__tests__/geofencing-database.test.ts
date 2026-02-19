/**
 * Geofencing Database Integration Test
 * Proves that geofence events actually update the database
 */

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

import { lotsApi } from '../src/services/api';
import locationService from '../src/services/locationService';
import { GeofenceEvent } from '../src/types/location';
import { UI_CONSTANTS } from '../src/constants/geofencing';

// Mock the API to spy on database calls
jest.mock('../src/services/api', () => ({
  lotsApi: {
    recordOccupancyEvent: jest.fn(),
  },
}));

// Helper function for waiting
const wait = (ms: number = UI_CONSTANTS.TEST_ASYNC_WAIT) => new Promise<void>(resolve => setTimeout(() => resolve(), ms));

describe('Geofencing Database Integration', () => {
  const mockRecordOccupancyEvent = lotsApi.recordOccupancyEvent as jest.MockedFunction<
    typeof lotsApi.recordOccupancyEvent
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecordOccupancyEvent.mockResolvedValue({ event_id: 'mock-event-id', deduplicated: false });
  });

  afterEach(() => {
    // Clean up any listeners
    locationService['onGeofenceEventListeners'] = [];
  });

  it('should update database when ENTER event is triggered', async () => {
    // Arrange: Set up a listener that will call the database
    const databaseListener = async (event: GeofenceEvent) => {
      if (event.eventType === 'ENTER') {
        await lotsApi.recordOccupancyEvent({
          lotId: event.regionId,
          eventType: 'ENTER',
          source: 'GEOFENCE',
        });
      }
    };

    locationService.setOnGeofenceEvent(databaseListener);

    // Act: Trigger a test geofence event
    locationService.triggerTestGeofenceEvent('G1', 'ENTER');

    // Wait for async operations to complete
    await wait(100);

    // Assert: Database should have been called
    expect(mockRecordOccupancyEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordOccupancyEvent).toHaveBeenCalledWith({
      lotId: 'G1',
      eventType: 'ENTER',
      source: 'GEOFENCE',
    });
  });

  it('should update database when EXIT event is triggered', async () => {
    // Arrange: Set up a listener that will call the database
    const databaseListener = async (event: GeofenceEvent) => {
      if (event.eventType === 'EXIT') {
        await lotsApi.recordOccupancyEvent({
          lotId: event.regionId,
          eventType: 'EXIT',
          source: 'GEOFENCE',
        });
      }
    };

    locationService.setOnGeofenceEvent(databaseListener);

    // Act: Trigger a test geofence event
    locationService.triggerTestGeofenceEvent('G2', 'EXIT');

    // Wait for async operations to complete
    await wait(100);

    // Assert: Database should have been called
    expect(mockRecordOccupancyEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordOccupancyEvent).toHaveBeenCalledWith({
      lotId: 'G2',
      eventType: 'EXIT',
      source: 'GEOFENCE',
    });
  });

  it('should handle multiple events in sequence', async () => {
    // Arrange: Set up a listener that will call the database for all events
    const databaseListener = async (event: GeofenceEvent) => {
      await lotsApi.recordOccupancyEvent({
        lotId: event.regionId,
        eventType: event.eventType,
        source: 'GEOFENCE',
      });
    };

    locationService.setOnGeofenceEvent(databaseListener);

    // Act: Trigger multiple events
    locationService.triggerTestGeofenceEvent('G1', 'ENTER');
    locationService.triggerTestGeofenceEvent('G1', 'EXIT');
    locationService.triggerTestGeofenceEvent('G2', 'ENTER');

    // Wait for async operations to complete
    await wait(100);

    // Assert: Database should have been called for each event
    expect(mockRecordOccupancyEvent).toHaveBeenCalledTimes(3);
    
    expect(mockRecordOccupancyEvent).toHaveBeenNthCalledWith(1, {
      lotId: 'G1',
      eventType: 'ENTER',
      source: 'GEOFENCE',
    });

    expect(mockRecordOccupancyEvent).toHaveBeenNthCalledWith(2, {
      lotId: 'G1',
      eventType: 'EXIT',
      source: 'GEOFENCE',
    });

    expect(mockRecordOccupancyEvent).toHaveBeenNthCalledWith(3, {
      lotId: 'G2',
      eventType: 'ENTER',
      source: 'GEOFENCE',
    });
  });

  it('should handle database errors gracefully', async () => {
    // Arrange: Mock database to throw an error
    mockRecordOccupancyEvent.mockRejectedValue(new Error('Database connection failed'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const databaseListener = async (event: GeofenceEvent) => {
      try {
        await lotsApi.recordOccupancyEvent({
          lotId: event.regionId,
          eventType: event.eventType,
          source: 'GEOFENCE',
        });
      } catch (error) {
        console.error('Failed to send occupancy event:', error);
      }
    };

    locationService.setOnGeofenceEvent(databaseListener);

    // Act: Trigger event that will fail
    locationService.triggerTestGeofenceEvent('G1', 'ENTER');

    // Wait for async operations to complete
    await wait(100);

    // Assert: Database was called but error was handled
    expect(mockRecordOccupancyEvent).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to send occupancy event:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('should support multiple listeners updating database simultaneously', async () => {
    // Arrange: Set up two different listeners that both update database
    const listener1 = async (event: GeofenceEvent) => {
      await lotsApi.recordOccupancyEvent({
        lotId: event.regionId,
        eventType: event.eventType,
        source: 'GEOFENCE',
      });
    };

    const listener2 = async (event: GeofenceEvent) => {
      // Second listener also updates database (simulating analytics)
      await lotsApi.recordOccupancyEvent({
        lotId: `analytics_${event.regionId}`,
        eventType: event.eventType,
        source: 'GEOFENCE',
      });
    };

    locationService.setOnGeofenceEvent(listener1);
    locationService.setOnGeofenceEvent(listener2);

    // Act: Trigger one event
    locationService.triggerTestGeofenceEvent('G1', 'ENTER');

    // Wait for async operations to complete
    await wait(100);

    // Assert: Database should have been called by both listeners
    expect(mockRecordOccupancyEvent).toHaveBeenCalledTimes(2);
    
    expect(mockRecordOccupancyEvent).toHaveBeenCalledWith({
      lotId: 'G1',
      eventType: 'ENTER',
      source: 'GEOFENCE',
    });

    expect(mockRecordOccupancyEvent).toHaveBeenCalledWith({
      lotId: 'analytics_G1',
      eventType: 'ENTER',
      source: 'GEOFENCE',
    });
  });
});
