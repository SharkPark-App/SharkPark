/**
 * Mode Switch Tests
 * Verifies startGeofences() ↔ start() transitions in locationService
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('react-native-background-geolocation', () => ({
  __esModule: true,
  default: {
    ready: jest.fn().mockResolvedValue({ enabled: false, trackingMode: 0 }),
    start: jest.fn().mockResolvedValue({ enabled: true, trackingMode: 1 }),
    startGeofences: jest.fn().mockResolvedValue({ enabled: true, trackingMode: 0 }),
    stop: jest.fn().mockResolvedValue({ enabled: false }),
    getState: jest.fn().mockResolvedValue({ enabled: false }),
    addGeofences: jest.fn().mockResolvedValue(undefined),
    removeGeofences: jest.fn().mockResolvedValue(undefined),
    getGeofences: jest.fn().mockResolvedValue([]),
    setConfig: jest.fn().mockResolvedValue({ enabled: true }),
    requestPermission: jest.fn().mockResolvedValue(4),
    requestTemporaryFullAccuracy: jest.fn().mockResolvedValue(0),
    getProviderState: jest.fn().mockResolvedValue({ accuracyAuthorization: 0 }),
    removeListeners: jest.fn().mockResolvedValue(undefined),
    onGeofence: jest.fn(() => ({ remove: jest.fn() })),
    onLocation: jest.fn(() => ({ remove: jest.fn() })),
    onActivityChange: jest.fn(() => ({ remove: jest.fn() })),
    onMotionChange: jest.fn(() => ({ remove: jest.fn() })),
    onProviderChange: jest.fn(() => ({ remove: jest.fn() })),
    onPowerSaveChange: jest.fn(() => ({ remove: jest.fn() })),
    AuthorizationStatus: { Always: 4, WhenInUse: 3, Denied: 1, NotDetermined: 0 },
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

import locationService from '../src/services/locationService';

const mockBG = jest.requireMock('react-native-background-geolocation').default;

describe('Mode Switching (geofence-only ↔ full tracking)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (locationService as any)['isInitialized'] = false;
    (locationService as any)['trackingMode'] = 'off';
    (locationService as any)['geofenceCallbacks'] = [];
    (locationService as any)['locationCallbacks'] = [];
    (locationService as any)['activityCallbacks'] = [];
    (locationService as any)['motionCallbacks'] = [];
    (locationService as any)['providerCallbacks'] = [];
    (locationService as any)['errorCallbacks'] = [];
    (locationService as any)['subscriptions'] = [];
  });

  it('should start in geofence-only mode (low power)', async () => {
    await locationService.initialize();
    const state = await locationService.startGeofenceMonitoring();
    expect(mockBG.startGeofences).toHaveBeenCalledTimes(1);
    expect(locationService.getTrackingMode()).toBe('geofences');
    expect(state).toEqual({ enabled: true, trackingMode: 0 });
  });

  it('should upgrade to full tracking on lot ENTER', async () => {
    await locationService.initialize();
    await locationService.startGeofenceMonitoring();
    expect(locationService.getTrackingMode()).toBe('geofences');

    const state = await locationService.upgradeToFullTracking();
    expect(mockBG.start).toHaveBeenCalledTimes(1);
    expect(locationService.getTrackingMode()).toBe('full');
    expect(state).toEqual({ enabled: true, trackingMode: 1 });
  });

  it('should downgrade to geofence-only on lot EXIT', async () => {
    await locationService.initialize();
    await locationService.upgradeToFullTracking();
    expect(locationService.getTrackingMode()).toBe('full');

    await locationService.downgradeToGeofenceOnly();
    expect(mockBG.startGeofences).toHaveBeenCalled();
    expect(locationService.getTrackingMode()).toBe('geofences');
  });

  it('should handle rapid upgrade → downgrade → upgrade cycle', async () => {
    await locationService.initialize();
    await locationService.startGeofenceMonitoring();

    await locationService.upgradeToFullTracking();
    expect(locationService.getTrackingMode()).toBe('full');

    await locationService.downgradeToGeofenceOnly();
    expect(locationService.getTrackingMode()).toBe('geofences');

    await locationService.upgradeToFullTracking();
    expect(locationService.getTrackingMode()).toBe('full');

    expect(mockBG.start).toHaveBeenCalledTimes(2);
    expect(mockBG.startGeofences).toHaveBeenCalledTimes(2);
  });

  it('should stop all tracking and reset mode to off', async () => {
    await locationService.initialize();
    await locationService.upgradeToFullTracking();
    await locationService.stop();
    expect(mockBG.stop).toHaveBeenCalledTimes(1);
    expect(locationService.getTrackingMode()).toBe('off');
  });

  it('should track mode state correctly through full lifecycle', async () => {
    expect(locationService.getTrackingMode()).toBe('off');
    expect(locationService.isLocationTracking()).toBe(false);

    await locationService.initialize();
    await locationService.startGeofenceMonitoring();
    expect(locationService.getTrackingMode()).toBe('geofences');
    expect(locationService.isLocationTracking()).toBe(true);

    await locationService.upgradeToFullTracking();
    expect(locationService.getTrackingMode()).toBe('full');
    expect(locationService.isLocationTracking()).toBe(true);

    await locationService.downgradeToGeofenceOnly();
    expect(locationService.getTrackingMode()).toBe('geofences');
    expect(locationService.isLocationTracking()).toBe(true);

    await locationService.stop();
    expect(locationService.getTrackingMode()).toBe('off');
    expect(locationService.isLocationTracking()).toBe(false);
  });

  describe('dynamic proximity radius', () => {
    it('should set tight radius when on campus', async () => {
      await locationService.setGeofenceProximityRadius(true);
      expect(mockBG.setConfig).toHaveBeenCalledWith({
        geolocation: { geofenceProximityRadius: 1000 },
      });
    });

    it('should set wide radius when off campus', async () => {
      await locationService.setGeofenceProximityRadius(false);
      expect(mockBG.setConfig).toHaveBeenCalledWith({
        geolocation: { geofenceProximityRadius: 3000 },
      });
    });
  });
});
