/**
 * Centralized mock for react-native-background-geolocation SDK
 * Jest auto-resolves this file for all `import ... from 'react-native-background-geolocation'`
 */

const mockBackgroundGeolocation = {
  // Lifecycle
  ready: jest.fn().mockResolvedValue({ enabled: false, trackingMode: 0 }),
  start: jest.fn().mockResolvedValue({ enabled: true, trackingMode: 1 }),
  startGeofences: jest.fn().mockResolvedValue({ enabled: true, trackingMode: 0 }),
  stop: jest.fn().mockResolvedValue({ enabled: false }),

  // Geofence management
  addGeofence: jest.fn().mockResolvedValue(true),
  addGeofences: jest.fn().mockResolvedValue(true),
  removeGeofences: jest.fn().mockResolvedValue(true),
  getGeofences: jest.fn().mockResolvedValue([]),

  // Event subscriptions (return removable subscription)
  onGeofence: jest.fn().mockReturnValue({ remove: jest.fn() }),
  onLocation: jest.fn().mockReturnValue({ remove: jest.fn() }),
  onActivityChange: jest.fn().mockReturnValue({ remove: jest.fn() }),
  onMotionChange: jest.fn().mockReturnValue({ remove: jest.fn() }),
  onProviderChange: jest.fn().mockReturnValue({ remove: jest.fn() }),
  onGeofencesChange: jest.fn().mockReturnValue({ remove: jest.fn() }),
  onPowerSaveChange: jest.fn().mockReturnValue({ remove: jest.fn() }),

  // One-shot queries
  getCurrentPosition: jest.fn().mockResolvedValue({
    coords: { latitude: 33.7838, longitude: -118.1089, speed: 0, accuracy: 10 },
  }),
  getState: jest.fn().mockResolvedValue({ enabled: false }),
  // getProviderState defaults to the contributor-eligible state (Always +
  // FullAccuracy) so tests don't have to opt into it. Override per-test
  // via mockResolvedValueOnce when exercising denied/reduced paths.
  getProviderState: jest.fn().mockResolvedValue({
    status: 4, // Always
    accuracyAuthorization: 0, // Full
    enabled: true,
    network: true,
    gps: true,
  }),

  // Permissions
  requestPermission: jest.fn().mockResolvedValue(4), // Always
  requestTemporaryFullAccuracy: jest.fn().mockResolvedValue(0), // Full

  // Configuration
  setConfig: jest.fn().mockResolvedValue({ enabled: true }),
  removeListeners: jest.fn().mockResolvedValue(undefined),
  registerHeadlessTask: jest.fn(),

  // Enums
  DesiredAccuracy: { High: 0, Medium: 10, Low: 100 },
  PersistMode: { None: 0, All: 2, Locations: 1, Geofences: -1 },
  LogLevel: { Off: 0, Error: 1, Warning: 2, Info: 3, Debug: 4, Verbose: 5 },
  TriggerActivity: { InVehicle: 'in_vehicle', OnFoot: 'on_foot' },
  ActivityType: { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4 },
  AuthorizationStatus: { NotDetermined: 0, Denied: 1, Always: 4, WhenInUse: 3 },
  AccuracyAuthorization: { Full: 0, Reduced: 1 },
};

export default mockBackgroundGeolocation;
