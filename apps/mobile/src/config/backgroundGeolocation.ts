/**
 * Transistor Background Geolocation SDK Configuration
 *
 * Privacy-first configuration:
 * - PersistMode.None: SDK stores ZERO locations in its SQLite database
 * - No HttpConfig.url: SDK never syncs data to any external server
 * - Only anonymous ENTER/EXIT events leave the device via our own API
 */

import BackgroundGeolocation, { Config } from 'react-native-background-geolocation';

export function createSDKConfig(): Config {
  return {
    geolocation: {
      desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
      distanceFilter: 20,
      locationAuthorizationRequest: 'Always',
      geofenceProximityRadius: 2000, // 2km — covers CSULB campus + approach roads
      geofenceModeHighAccuracy: true, // Android: foreground service for near-instant geofence triggers
      geofenceInitialTriggerEntry: true, // Fire ENTER if already inside a lot when SDK starts
      stationaryRadius: 25, // Parking lot size — prevents false motion triggers
      stopTimeout: 5, // 5 min motionless → stationary state
      activityType: BackgroundGeolocation.ActivityType.AutomotiveNavigation, // iOS hint for driving stop-detection
    },
    activity: {
      triggerActivities: [
        BackgroundGeolocation.TriggerActivity.InVehicle,
        BackgroundGeolocation.TriggerActivity.OnFoot,
      ],
      stopDetectionDelay: 10000, // iOS: 10s grace period before engaging stop-detection (avoids false stops at traffic lights)
    },
    app: {
      stopOnTerminate: false,
      startOnBoot: true,
      enableHeadless: true,
      backgroundPermissionRationale: {
        title: 'Allow background location access',
        message:
          'SharkPark needs background location to detect when you enter and leave parking lots, even when the app is closed. This helps provide accurate real-time parking availability for all students.',
        positiveAction: 'Allow',
        negativeAction: 'Cancel',
      },
    },
    persistence: {
      persistMode: BackgroundGeolocation.PersistMode.None,
    },
    logger: {
      logLevel: __DEV__
        ? BackgroundGeolocation.LogLevel.Verbose
        : BackgroundGeolocation.LogLevel.Off,
    },
  };
}
