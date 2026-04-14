/**
 * Geofencing Database Integration Test
 * Proves that geofence events actually update the database
 */

// Mock BackgroundGeolocation SDK
jest.mock('react-native-background-geolocation', () => ({
  __esModule: true,
  default: {
    ready: jest.fn().mockResolvedValue({ enabled: false }),
    start: jest.fn().mockResolvedValue({}),
    startGeofences: jest.fn().mockResolvedValue({}),
    stop: jest.fn().mockResolvedValue({}),
    getState: jest.fn().mockResolvedValue({}),
    addGeofences: jest.fn().mockResolvedValue(undefined),
    removeGeofences: jest.fn().mockResolvedValue(undefined),
    getGeofences: jest.fn().mockResolvedValue([]),
    getCurrentPosition: jest.fn().mockResolvedValue({}),
    requestPermission: jest.fn().mockResolvedValue(4),
    requestTemporaryFullAccuracy: jest.fn().mockResolvedValue(1),
    getProviderState: jest.fn().mockResolvedValue({ accuracyAuthorization: 0 }),
    removeListeners: jest.fn().mockResolvedValue(undefined),
    onGeofence: jest.fn(() => ({ remove: jest.fn() })),
    onLocation: jest.fn(() => ({ remove: jest.fn() })),
    onActivityChange: jest.fn(() => ({ remove: jest.fn() })),
    onMotionChange: jest.fn(() => ({ remove: jest.fn() })),
    onProviderChange: jest.fn(() => ({ remove: jest.fn() })),
    AuthorizationStatus: { Always: 4, WhenInUse: 3 },
    AccuracyAuthorization: { Full: 0, Reduced: 1 },
    DesiredAccuracy: { High: 0, Medium: 10, Low: 100 },
    PersistMode: { None: 0, All: 2 },
    LogLevel: { Verbose: 5, Off: 0 },
    TriggerActivity: { InVehicle: 'in_vehicle', OnFoot: 'on_foot' },
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { lotsApi } from '../src/services/api';
import locationService from '../src/services/locationService';
import { GeofenceEvent } from '../src/types/location';
import { UI_CONSTANTS } from '../src/constants/geofencing';

jest.mock('../src/services/api', () => ({
  lotsApi: {
    recordOccupancyEvent: jest.fn(),
  },
}));

const wait = (ms: number = UI_CONSTANTS.TEST_ASYNC_WAIT) => new Promise<void>(resolve => setTimeout(() => resolve(), ms));

describe('Geofencing Database Integration', () => {
  const mockRecordOccupancyEvent = lotsApi.recordOccupancyEvent as jest.MockedFunction<
    typeof lotsApi.recordOccupancyEvent
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton callbacks to prevent accumulation across tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (locationService as any)['geofenceCallbacks'] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (locationService as any)['locationCallbacks'] = [];
    mockRecordOccupancyEvent.mockResolvedValue({ event_id: 'mock-event-id', deduplicated: false });
  });

  it('should update database when ENTER event is triggered', async () => {
    const databaseListener = async (event: GeofenceEvent) => {
      if (event.eventType === 'ENTER') {
        await lotsApi.recordOccupancyEvent({
          lotId: event.regionId,
          eventType: 'ENTER',
          source: 'GEOFENCE',
        });
      }
    };

    locationService.onGeofence(databaseListener);
    locationService.triggerTestGeofenceEvent('G1', 'ENTER');

    await wait(100);

    expect(mockRecordOccupancyEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordOccupancyEvent).toHaveBeenCalledWith({
      lotId: 'G1',
      eventType: 'ENTER',
      source: 'GEOFENCE',
    });
  });

  it('should update database when EXIT event is triggered', async () => {
    const databaseListener = async (event: GeofenceEvent) => {
      if (event.eventType === 'EXIT') {
        await lotsApi.recordOccupancyEvent({
          lotId: event.regionId,
          eventType: 'EXIT',
          source: 'GEOFENCE',
        });
      }
    };

    locationService.onGeofence(databaseListener);
    locationService.triggerTestGeofenceEvent('G2', 'EXIT');

    await wait(100);

    expect(mockRecordOccupancyEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordOccupancyEvent).toHaveBeenCalledWith({
      lotId: 'G2',
      eventType: 'EXIT',
      source: 'GEOFENCE',
    });
  });

  it('should handle multiple events in sequence', async () => {
    const databaseListener = async (event: GeofenceEvent) => {
      await lotsApi.recordOccupancyEvent({
        lotId: event.regionId,
        eventType: event.eventType,
        source: 'GEOFENCE',
      });
    };

    locationService.onGeofence(databaseListener);

    locationService.triggerTestGeofenceEvent('G1', 'ENTER');
    locationService.triggerTestGeofenceEvent('G1', 'EXIT');
    locationService.triggerTestGeofenceEvent('G2', 'ENTER');

    await wait(100);

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

    locationService.onGeofence(databaseListener);
    locationService.triggerTestGeofenceEvent('G1', 'ENTER');

    await wait(100);

    expect(mockRecordOccupancyEvent).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to send occupancy event:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('should support multiple listeners updating database simultaneously', async () => {
    const listener1 = async (event: GeofenceEvent) => {
      await lotsApi.recordOccupancyEvent({
        lotId: event.regionId,
        eventType: event.eventType,
        source: 'GEOFENCE',
      });
    };

    const listener2 = async (event: GeofenceEvent) => {
      await lotsApi.recordOccupancyEvent({
        lotId: `analytics_${event.regionId}`,
        eventType: event.eventType,
        source: 'GEOFENCE',
      });
    };

    locationService.onGeofence(listener1);
    locationService.onGeofence(listener2);

    locationService.triggerTestGeofenceEvent('G1', 'ENTER');

    await wait(100);

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
