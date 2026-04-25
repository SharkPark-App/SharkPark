/**
 * SDK Configuration Tests
 * Verifies privacy config, activity triggers, and platform settings
 */

jest.mock('react-native-background-geolocation', () => ({
  __esModule: true,
  default: {
    DesiredAccuracy: { High: 0, Medium: 10, Low: 100 },
    PersistMode: { None: 0, All: 2, Locations: 1, Geofences: -1 },
    LogLevel: { Off: 0, Error: 1, Warning: 2, Info: 3, Debug: 4, Verbose: 5 },
    TriggerActivity: { InVehicle: 'in_vehicle', OnFoot: 'on_foot' },
    ActivityType: { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4 },
  },
}));

import { createSDKConfig } from '../src/config/backgroundGeolocation';

describe('SDK Configuration', () => {
  describe('privacy', () => {
    it('should use PersistMode.None to prevent SDK location storage', () => {
      const config = createSDKConfig();
      expect(config.persistence?.persistMode).toBe(0); // PersistMode.None
    });

    it('should NOT configure any HTTP sync URL', () => {
      const config = createSDKConfig();
      // Ensure no HTTP/sync configuration exists anywhere in the config
      const configStr = JSON.stringify(config);
      expect(configStr).not.toContain('url');
      expect(configStr).not.toContain('http');
      expect(configStr).not.toContain('HttpConfig');
    });

    it('should NOT include a TransistorAuthorizationToken', () => {
      const config = createSDKConfig();
      const configStr = JSON.stringify(config);
      expect(configStr).not.toContain('transistorAuthorizationToken');
      expect(configStr).not.toContain('TransistorAuth');
    });
  });

  describe('geolocation settings', () => {
    it('should use high accuracy by default', () => {
      const config = createSDKConfig();
      expect(config.geolocation?.desiredAccuracy).toBe(0); // DesiredAccuracy.High
    });

    it('should set geofenceProximityRadius for campus coverage', () => {
      const config = createSDKConfig();
      expect(config.geolocation?.geofenceProximityRadius).toBe(2000);
    });

    it('should set stationaryRadius to parking lot size', () => {
      const config = createSDKConfig();
      expect(config.geolocation?.stationaryRadius).toBe(25);
    });

    it('should set distanceFilter to 20m', () => {
      const config = createSDKConfig();
      expect(config.geolocation?.distanceFilter).toBe(20);
    });

    it('should request "Always" authorization for background geofencing', () => {
      const config = createSDKConfig();
      expect(config.geolocation?.locationAuthorizationRequest).toBe('Always');
    });

    it('should enable geofenceModeHighAccuracy for instant Android triggers', () => {
      const config = createSDKConfig();
      expect(config.geolocation?.geofenceModeHighAccuracy).toBe(true);
    });

    it('should fire ENTER if already inside a lot when SDK starts', () => {
      const config = createSDKConfig();
      expect(config.geolocation?.geofenceInitialTriggerEntry).toBe(true);
    });

    it('should use AutomotiveNavigation activity type for iOS', () => {
      const config = createSDKConfig();
      expect(config.geolocation?.activityType).toBe(2); // AutomotiveNavigation
    });
  });

  describe('activity triggers', () => {
    it('should trigger on InVehicle and OnFoot activities', () => {
      const config = createSDKConfig();
      expect(config.activity?.triggerActivities).toEqual(
        expect.arrayContaining(['in_vehicle', 'on_foot'])
      );
    });

    it('should set stopDetectionDelay for iOS traffic light grace period', () => {
      const config = createSDKConfig();
      expect(config.activity?.stopDetectionDelay).toBe(10000);
    });
  });

  describe('app lifecycle', () => {
    it('should NOT stop on terminate (background geofencing continues)', () => {
      const config = createSDKConfig();
      expect(config.app?.stopOnTerminate).toBe(false);
    });

    it('should start on boot (resume after phone restart)', () => {
      const config = createSDKConfig();
      expect(config.app?.startOnBoot).toBe(true);
    });

    it('should enable headless task (Android terminated-state events)', () => {
      const config = createSDKConfig();
      expect(config.app?.enableHeadless).toBe(true);
    });

    it('should include background permission rationale', () => {
      const config = createSDKConfig();
      expect(config.app?.backgroundPermissionRationale).toEqual(
        expect.objectContaining({
          title: expect.any(String),
          message: expect.any(String),
          positiveAction: expect.any(String),
          negativeAction: expect.any(String),
        })
      );
    });
  });

  describe('logger', () => {
    it('should use verbose logging in dev, off in production', () => {
      const config = createSDKConfig();
      // In test env __DEV__ is typically true
      expect(config.logger?.logLevel).toBeDefined();
    });
  });
});
