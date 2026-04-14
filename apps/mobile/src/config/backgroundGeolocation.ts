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
      stationaryRadius: 25, // Parking lot size — prevents false motion triggers
      stopTimeout: 5, // 5 min motionless → stationary state
    },
    activity: {
      triggerActivities: [
        BackgroundGeolocation.TriggerActivity.InVehicle,
        BackgroundGeolocation.TriggerActivity.OnFoot,
      ],
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
