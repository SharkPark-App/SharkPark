import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GeofenceEvent } from '../src/types/location';

const listeners: {
  geofence?: (event: GeofenceEvent) => void;
} = {};

const mockLotsApi = {
  getAllLots: jest.fn(),
  getLotDetails: jest.fn(),
  recordOccupancyEvent: jest.fn(),
};

jest.mock('../src/services/api', () => ({
  lotsApi: mockLotsApi,
}));

jest.mock('../src/utils/geofenceUtils', () => ({
  createSDKGeofencesFromLots: jest.fn(() => [
    {
      identifier: 'G1',
      latitude: 33.783,
      longitude: -118.114,
      radius: 60,
      notifyOnEntry: true,
      notifyOnExit: true,
    },
  ]),
}));

jest.mock('../src/services/api/contributor', () => ({
  registerContributorGrant: jest.fn(),
  revokeContributorGrant: jest.fn(),
  refreshLotsForPermissionChange: jest.fn(),
}));

jest.mock('../src/services/parkingValidationService', () => ({
  __esModule: true,
  default: {
    startParkingSession: jest.fn().mockResolvedValue(undefined),
    completeParkingSession: jest.fn().mockResolvedValue({
      status: 'CONFIRMED',
      confidenceScore: 0.95,
    }),
    onValidationComplete: jest.fn(),
    removeValidationListener: jest.fn(),
    getCurrentValidationStatus: jest.fn().mockResolvedValue(null),
    getDebugInfo: jest.fn(() => ({ activeSessions: 0, isCollectingData: false })),
    recordBehavioralEvent: jest.fn(),
  },
}));

jest.mock('../src/services/leaveDetectionService', () => ({
  __esModule: true,
  default: {
    startLeaveMonitoring: jest.fn().mockResolvedValue(undefined),
    completeLeaveMonitoring: jest.fn().mockResolvedValue(null),
    getDebugInfo: jest.fn(() => ({ activeSessions: 0, isMonitoring: false })),
    updateLocation: jest.fn(),
    processActivityChange: jest.fn(),
    processMotionChange: jest.fn(),
    reattachCallbacks: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/services/carpoolDetectionService', () => ({
  __esModule: true,
  default: {
    startDetectionSession: jest.fn().mockResolvedValue('session-1'),
    analyzeCarpool: jest.fn().mockResolvedValue(null),
    endDetectionSession: jest.fn(),
    recordBluetoothDevice: jest.fn(),
    recordMotionBurst: jest.fn(),
    recordWifiClientJoin: jest.fn(),
  },
}));

jest.mock('../src/services/behavioralDataCollector', () => ({
  sharedBehavioralCollector: {
    updateLocation: jest.fn(),
    updateActivity: jest.fn(),
    updateMotion: jest.fn(),
    updateCarBluetoothState: jest.fn(),
  },
}));

jest.mock('../src/services/carBluetooth', () => ({
  __esModule: true,
  default: {
    getKnownDeviceIds: jest.fn(() => []),
    onConnect: jest.fn(() => ({ remove: jest.fn() })),
    onDisconnect: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('../src/services/locationService', () => ({
  __esModule: true,
  default: {
    onGeofence: jest.fn((cb: (event: GeofenceEvent) => void) => {
      listeners.geofence = cb;
      return jest.fn();
    }),
    onLocation: jest.fn(() => jest.fn()),
    onActivityChange: jest.fn(() => jest.fn()),
    onMotionChange: jest.fn(() => jest.fn()),
    onProviderChange: jest.fn(() => jest.fn()),
    onError: jest.fn(() => jest.fn()),
    initialize: jest.fn().mockResolvedValue(undefined),
    requestPermissions: jest.fn().mockResolvedValue(true),
    isContributorAuthorized: jest.fn().mockResolvedValue(true),
    registerGeofences: jest.fn().mockResolvedValue(undefined),
    startGeofenceMonitoring: jest.fn().mockResolvedValue(undefined),
    upgradeToFullTracking: jest.fn().mockResolvedValue(undefined),
    downgradeToGeofenceOnly: jest.fn().mockResolvedValue(undefined),
    getCurrentPosition: jest.fn().mockResolvedValue({
      coords: {
        latitude: 33.783,
        longitude: -118.114,
        accuracy: 5,
      },
    }),
    setGeofenceProximityRadius: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/utils/geoHelpers', () => ({
  isOnCampus: jest.fn(() => true),
}));

jest.mock('../src/data/lotPolygons', () => ({
  LOT_POLYGONS: {
    G1: [
      { lat: 33.7825, lng: -118.1145 },
      { lat: 33.7825, lng: -118.1135 },
      { lat: 33.7835, lng: -118.1135 },
      { lat: 33.7835, lng: -118.1145 },
    ],
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  default: EnhancedGeofencingProvider,
  useEnhancedGeofencing,
} = require('../src/context/EnhancedGeofencingProvider');
/* eslint-enable @typescript-eslint/no-require-imports */

const mockAsyncStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  multiGet: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

let latestCtx: {
  setCarpoolPassengerMode: (enabled: boolean) => Promise<void>;
  currentLotId: string | null;
  parkedLotId: string | null;
  carpoolPassengerMode: boolean;
} | null = null;
let mountedRoot: ReactTestRenderer.ReactTestRenderer | null = null;

function Probe() {
  const ctx = useEnhancedGeofencing();
  latestCtx = ctx;
  return null;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitForProviderReady(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await flushEffects();
    if (mockLotsApi.getAllLots.mock.calls.length > 0) return;
  }
  throw new Error('waitForProviderReady: provider did not complete initialization');
}

async function emitGeofence(event: GeofenceEvent): Promise<void> {
  expect(listeners.geofence).toBeDefined();
  await act(async () => {
    listeners.geofence!(event);
    await Promise.resolve();
  });
  await flushEffects();
}

describe('EnhancedGeofencingProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    listeners.geofence = undefined;
    latestCtx = null;
    mountedRoot = null;

    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.multiGet.mockResolvedValue([
      ['@SharkPark:carpoolPassengerMode', null],
      ['@SharkPark:carpoolPassengerCount', null],
    ]);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);

    mockLotsApi.getAllLots.mockResolvedValue([
      {
        lot_id: 'G1',
        lot_name: 'Lot G1',
        center_lat: 33.783,
        center_lng: -118.114,
      },
    ]);
    mockLotsApi.getLotDetails.mockResolvedValue({
      estimated_occupancy: 50,
      current_occupancy: 50,
    });
    mockLotsApi.recordOccupancyEvent.mockResolvedValue({});
  });

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
      mountedRoot = null;
    }
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('returns safe defaults when used outside provider', () => {
    act(() => {
      ReactTestRenderer.create(<Probe />);
    });

    const text = latestCtx?.parkedLotId ?? 'none';
    expect(text).toBe('none');
  });

  it('confirms parked state and sends ENTER occupancy for still vehicle entry', async () => {
    await act(async () => {
      mountedRoot = ReactTestRenderer.create(
        <EnhancedGeofencingProvider>
          <Probe />
        </EnhancedGeofencingProvider>,
      );
    });
    await waitForProviderReady();

    await act(async () => {
      await latestCtx!.setCarpoolPassengerMode(false);
    });

    await emitGeofence({
      regionId: 'G1',
      eventType: 'ENTER',
      timestamp: new Date().toISOString(),
      activity: { type: 'still', confidence: 100 },
      speed: 0,
    });

    expect(latestCtx!.currentLotId).toBe('G1');
    expect(latestCtx!.parkedLotId).toBe('G1');
    expect(latestCtx!.carpoolPassengerMode).toBe(false);
    expect(mockLotsApi.recordOccupancyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ lotId: 'G1', eventType: 'ENTER', source: 'GEOFENCE' }),
    );
  });

  it('suppresses occupancy writes in carpool passenger mode', async () => {
    await act(async () => {
      mountedRoot = ReactTestRenderer.create(
        <EnhancedGeofencingProvider>
          <Probe />
        </EnhancedGeofencingProvider>,
      );
    });
    await waitForProviderReady();

    expect(latestCtx).not.toBeNull();
    await act(async () => {
      await latestCtx!.setCarpoolPassengerMode(true);
    });

    await emitGeofence({
      regionId: 'G1',
      eventType: 'ENTER',
      timestamp: new Date().toISOString(),
      activity: { type: 'still', confidence: 100 },
      speed: 0,
    });

    expect(mockLotsApi.recordOccupancyEvent).not.toHaveBeenCalled();
  });

  it('sends EXIT occupancy when leaving confirmed parked lot in vehicle', async () => {
    await act(async () => {
      mountedRoot = ReactTestRenderer.create(
        <EnhancedGeofencingProvider>
          <Probe />
        </EnhancedGeofencingProvider>,
      );
    });
    await waitForProviderReady();

    await act(async () => {
      await latestCtx!.setCarpoolPassengerMode(false);
    });

    await emitGeofence({
      regionId: 'G1',
      eventType: 'ENTER',
      timestamp: new Date().toISOString(),
      activity: { type: 'still', confidence: 100 },
      speed: 0,
    });

    await emitGeofence({
      regionId: 'G1',
      eventType: 'EXIT',
      timestamp: new Date().toISOString(),
      activity: { type: 'in_vehicle', confidence: 90 },
      speed: 7,
    });

    const eventTypes = mockLotsApi.recordOccupancyEvent.mock.calls.map((call: unknown[]) => {
      const payload = call[0] as { eventType?: string };
      return payload.eventType;
    });

    expect(eventTypes).toEqual(['ENTER', 'EXIT']);
    expect(latestCtx!.parkedLotId).toBeNull();
  });
});
