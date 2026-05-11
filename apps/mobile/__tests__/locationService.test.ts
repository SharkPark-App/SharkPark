/**
 * Location Service Tests
 * Tests the native BackgroundGeolocation SDK wrapper
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock BackgroundGeolocation SDK — all mocks inline to avoid Jest hoisting issues
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
    getCurrentPosition: jest.fn().mockResolvedValue({ coords: { latitude: 33.78, longitude: -118.11 } }),
    setConfig: jest.fn().mockResolvedValue({ enabled: true }),
    requestPermission: jest.fn().mockResolvedValue(4),
    requestTemporaryFullAccuracy: jest.fn().mockResolvedValue(1),
    getProviderState: jest.fn().mockResolvedValue({ accuracyAuthorization: 0 }),
    removeListeners: jest.fn().mockResolvedValue(undefined),
    onGeofence: jest.fn(() => ({ remove: jest.fn() })),
    onLocation: jest.fn(() => ({ remove: jest.fn() })),
    onActivityChange: jest.fn(() => ({ remove: jest.fn() })),
    onMotionChange: jest.fn(() => ({ remove: jest.fn() })),
    onProviderChange: jest.fn(() => ({ remove: jest.fn() })),
    onPowerSaveChange: jest.fn(() => ({ remove: jest.fn() })),
    onGeofencesChange: jest.fn(() => ({ remove: jest.fn() })),
    AuthorizationStatus: { Always: 4, WhenInUse: 3, Denied: 1, NotDetermined: 0 },
    AccuracyAuthorization: { Full: 0, Reduced: 1 },
    DesiredAccuracy: { High: 0, Medium: 10, Low: 100 },
    PersistMode: { None: 0, All: 2 },
    LogLevel: { Verbose: 5, Off: 0 },
    TriggerActivity: { InVehicle: 'in_vehicle', OnFoot: 'on_foot' },
    ActivityType: { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4 },
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import locationService from '../src/services/locationService';

// Access mock functions from the mocked module
const mockBG = jest.requireMock('react-native-background-geolocation').default;

describe('LocationService (SDK Wrapper)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton state between tests
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

  describe('initialize', () => {
    it('should call SDK ready with config', async () => {
      const state = await locationService.initialize();
      expect(mockBG.ready).toHaveBeenCalledTimes(1);
      expect(mockBG.onGeofence).toHaveBeenCalled();
      expect(mockBG.onLocation).toHaveBeenCalled();
      expect(state).toEqual({ enabled: false, trackingMode: 0 });
    });

    it('should not re-initialize if already initialized', async () => {
      await locationService.initialize();
      jest.clearAllMocks();
      await locationService.initialize();
      expect(mockBG.ready).not.toHaveBeenCalled();
    });
  });

  describe('registerGeofences', () => {
    it('should clear existing and add new geofences', async () => {
      const geofences = [
        { identifier: 'G1', latitude: 33.78, longitude: -118.11, radius: 50, notifyOnEntry: true, notifyOnExit: true },
      ];
      await locationService.registerGeofences(geofences);
      expect(mockBG.removeGeofences).toHaveBeenCalled();
      expect(mockBG.addGeofences).toHaveBeenCalledWith(geofences);
    });
  });

  describe('mode switching', () => {
    it('should start geofence-only monitoring', async () => {
      await locationService.startGeofenceMonitoring();
      expect(mockBG.startGeofences).toHaveBeenCalled();
      expect(locationService.getTrackingMode()).toBe('geofences');
    });

    it('should upgrade to full tracking', async () => {
      await locationService.upgradeToFullTracking();
      expect(mockBG.start).toHaveBeenCalled();
      expect(locationService.getTrackingMode()).toBe('full');
    });

    it('should downgrade to geofence-only', async () => {
      await locationService.upgradeToFullTracking();
      await locationService.downgradeToGeofenceOnly();
      expect(locationService.getTrackingMode()).toBe('geofences');
    });

    it('should stop tracking', async () => {
      await locationService.startGeofenceMonitoring();
      await locationService.stop();
      expect(mockBG.stop).toHaveBeenCalled();
      expect(locationService.getTrackingMode()).toBe('off');
    });
  });

  describe('requestPermissions', () => {
    it('should return true when always permission granted with full accuracy', async () => {
      mockBG.requestPermission.mockResolvedValue(4);
      mockBG.getProviderState.mockResolvedValue({ status: 4, accuracyAuthorization: 0 });
      const result = await locationService.requestPermissions();
      expect(result).toBe(true);
    });

    it('should return false when denied', async () => {
      mockBG.requestPermission.mockResolvedValue(1);
      mockBG.getProviderState.mockResolvedValue({ status: 1, accuracyAuthorization: 0 });
      const result = await locationService.requestPermissions();
      expect(result).toBe(false);
    });

    it('should return false when always granted but accuracy is reduced', async () => {
      // Contributor tier requires both Always + FullAccuracy. Reduced
      // accuracy fuzzes coords to ~hectares which breaks lot detection,
      // so we refuse the contributor grant under it.
      mockBG.requestPermission.mockResolvedValue(4);
      mockBG.getProviderState.mockResolvedValue({ status: 4, accuracyAuthorization: 1 });
      // Simulate the user dismissing the temp-full-accuracy prompt:
      // accuracy stays Reduced after the request.
      mockBG.requestTemporaryFullAccuracy.mockResolvedValue(1);
      const result = await locationService.requestPermissions();
      expect(result).toBe(false);
    });

    it('should request full accuracy when reduced on iOS 14+', async () => {
      mockBG.requestPermission.mockResolvedValue(4);
      mockBG.getProviderState.mockResolvedValue({ status: 4, accuracyAuthorization: 1 });
      await locationService.requestPermissions();
      expect(mockBG.requestTemporaryFullAccuracy).toHaveBeenCalledWith('ParkingDetection');
    });
  });

  describe('event forwarding', () => {
    it('should forward geofence events to registered callbacks', () => {
      const callback = jest.fn();
      locationService.onGeofence(callback);
      locationService.triggerTestGeofenceEvent('G1', 'ENTER');
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        regionId: 'G1',
        eventType: 'ENTER',
      }));
    });

    it('should unsubscribe callbacks when cleanup is called', () => {
      const callback = jest.fn();
      const unsub = locationService.onGeofence(callback);
      unsub();
      locationService.triggerTestGeofenceEvent('G1', 'ENTER');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should not emit events outside __DEV__', () => {
      const g = globalThis as Record<string, unknown>;
      const originalDev = g.__DEV__;
      g.__DEV__ = false;
      const callback = jest.fn();
      locationService.onGeofence(callback);
      locationService.triggerTestGeofenceEvent('G1', 'ENTER');
      expect(callback).not.toHaveBeenCalled();
      g.__DEV__ = originalDev;
    });
  });

  describe('privacy', () => {
    it('should never expose coordinates in geofence events', () => {
      const callback = jest.fn();
      locationService.onGeofence(callback);
      locationService.triggerTestGeofenceEvent('G1', 'ENTER');

      if (callback.mock.calls.length > 0) {
        const event = callback.mock.calls[0][0];
        expect(event).toEqual(expect.objectContaining({
          regionId: expect.any(String),
          eventType: expect.stringMatching(/^(ENTER|EXIT)$/),
          timestamp: expect.any(String),
        }));
        expect(event).not.toHaveProperty('latitude');
        expect(event).not.toHaveProperty('longitude');
      }
    });
  });

  describe('getMonitoredRegionsCount', () => {
    it('should return SDK geofence count', async () => {
      mockBG.getGeofences.mockResolvedValue([{ identifier: 'G1' }, { identifier: 'G2' }]);
      const count = await locationService.getMonitoredRegionsCount();
      expect(count).toBe(2);
    });
  });

  describe('destroy', () => {
    it('should cleanup subscriptions and stop tracking', async () => {
      await locationService.destroy();
      expect(mockBG.removeListeners).toHaveBeenCalled();
      expect(mockBG.stop).toHaveBeenCalled();
      expect(locationService.getTrackingMode()).toBe('off');
    });
  });
});
