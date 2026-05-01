/**
 * Native Background Geolocation Service
 *
 * Wraps the Transistor BackgroundGeolocation SDK to provide:
 * - Native OS-level geofence monitoring (works backgrounded/terminated)
 * - Two-mode operation: geofence-only (low power) vs full tracking (inside lot)
 * - Activity recognition (still/on_foot/in_vehicle)
 * - Privacy-first: PersistMode.None, no HTTP sync, no coordinates stored
 *
 * Replaces the previous JS-based Geolocation.watchPosition + setInterval approach
 * which died when the JS thread suspended in the background.
 */

import BackgroundGeolocation, {
  Subscription,
  Geofence,
  State,
} from 'react-native-background-geolocation';
import type {
  GeofenceEvent as SDKGeofenceEvent,
  Location,
  MotionActivityEvent,
  MotionChangeEvent,
  ProviderChangeEvent,
} from 'react-native-background-geolocation';
import { createSDKConfig } from '../config/backgroundGeolocation';
import type { GeofenceEvent, LocationError } from '../types/location';

type GeofenceCallback = (event: GeofenceEvent) => void;
type LocationCallback = (location: Location) => void;
type ActivityCallback = (event: MotionActivityEvent) => void;
type MotionCallback = (event: MotionChangeEvent) => void;
type ProviderCallback = (event: ProviderChangeEvent) => void;
type ErrorCallback = (error: LocationError) => void;

class LocationService {
  private subscriptions: Subscription[] = [];
  private isInitialized = false;
  private trackingMode: 'off' | 'geofences' | 'full' = 'off';

  // True once we've reported a denied-class status (Denied OR NotDetermined)
  // since the last authorized observation. iOS commonly fires *multiple*
  // ProviderChange events per user toggle (sometimes mixing Denied and
  // NotDetermined), so we must dedup on the class — not the exact status —
  // or the second event re-fires PERMISSION_DENIED. Flips back to false when
  // we see an authorized status, arming the next revoke transition.
  private hasReportedDenied = false;

  // Event callbacks
  private geofenceCallbacks: GeofenceCallback[] = [];
  private locationCallbacks: LocationCallback[] = [];
  private activityCallbacks: ActivityCallback[] = [];
  private motionCallbacks: MotionCallback[] = [];
  private providerCallbacks: ProviderCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];

  /**
   * Initialize the SDK. Call once on app launch before any other methods.
   * Registers all event subscriptions and applies configuration.
   */
  async initialize(): Promise<State> {
    if (this.isInitialized) {
      return BackgroundGeolocation.getState();
    }

    // Register event listeners BEFORE ready() per SDK lifecycle requirements
    this.subscriptions.push(
      BackgroundGeolocation.onGeofence(this.handleGeofenceEvent),
      BackgroundGeolocation.onLocation(this.handleLocationEvent),
      BackgroundGeolocation.onActivityChange(this.handleActivityChange),
      BackgroundGeolocation.onMotionChange(this.handleMotionChange),
      BackgroundGeolocation.onProviderChange(this.handleProviderChange),
      BackgroundGeolocation.onPowerSaveChange(this.handlePowerSaveChange),
      BackgroundGeolocation.onGeofencesChange(this.handleGeofencesChange),
    );

    const config = createSDKConfig();
    const state = await BackgroundGeolocation.ready(config);

    this.isInitialized = true;

    if (__DEV__) {
      console.log('[LocationService] SDK initialized:', {
        enabled: state.enabled,
        trackingMode: state.trackingMode,
      });
    }

    return state;
  }

  /**
   * Register lot geofences with the SDK.
   * Accepts SDK Geofence objects (with Vertices for polygons or lat/lng for circles).
   * The SDK handles platform limits (iOS 20 / Android 100) via geofenceProximityRadius.
   */
  async registerGeofences(geofences: Geofence[]): Promise<void> {
    // Clear existing geofences before registering new set
    await BackgroundGeolocation.removeGeofences();
    await BackgroundGeolocation.addGeofences(geofences);

    if (__DEV__) {
      console.log(`[LocationService] Registered ${geofences.length} geofences`);
    }
  }

  /**
   * Start geofence-only monitoring (low-power default mode).
   * No active GPS tracking — only OS-level geofence ENTER/EXIT/DWELL events fire.
   */
  async startGeofenceMonitoring(): Promise<State> {
    const state = await BackgroundGeolocation.startGeofences();
    this.trackingMode = 'geofences';

    if (__DEV__) {
      console.log('[LocationService] Started geofence-only mode');
    }

    return state;
  }

  /**
   * Upgrade to full tracking mode (used when user enters a parking lot).
   * GPS + motion detection + activity recognition all active.
   */
  async upgradeToFullTracking(): Promise<State> {
    const state = await BackgroundGeolocation.start();
    this.trackingMode = 'full';

    if (__DEV__) {
      console.log('[LocationService] Upgraded to full tracking mode');
    }

    return state;
  }

  /**
   * Downgrade back to geofence-only mode (used when user exits a parking lot).
   * GPS turns off, only OS geofence monitoring continues.
   */
  async downgradeToGeofenceOnly(): Promise<State> {
    const state = await BackgroundGeolocation.startGeofences();
    this.trackingMode = 'geofences';

    if (__DEV__) {
      console.log('[LocationService] Downgraded to geofence-only mode');
    }

    return state;
  }

  /**
   * Dynamically adjust geofenceProximityRadius based on campus proximity.
   *
   * When the user is on campus, a tight 1km radius keeps the SDK focused on
   * nearby lots. When approaching from far away, a wider 3km radius ensures
   * geofences activate early enough.
   */
  async setGeofenceProximityRadius(isOnCampus: boolean): Promise<void> {
    const radius = isOnCampus ? 1000 : 3000;
    await BackgroundGeolocation.setConfig({
      geolocation: { geofenceProximityRadius: radius },
    });
    if (__DEV__) {
      console.log(`[LocationService] geofenceProximityRadius → ${radius}m (${isOnCampus ? 'on' : 'off'} campus)`);
    }
  }

  /**
   * Returns true if the OS currently grants us at least "When In Use"
   * background-location authorization. Used by the AppState foreground
   * hook to detect that the user has revoked permission while we were
   * backgrounded so we can immediately notify the backend.
   */
  async isAuthorized(): Promise<boolean> {
    try {
      const provider = await BackgroundGeolocation.getProviderState();
      return (
        provider.status === BackgroundGeolocation.AuthorizationStatus.Always ||
        provider.status === BackgroundGeolocation.AuthorizationStatus.WhenInUse
      );
    } catch {
      // If we can't read the state, don't claim revocation — the next
      // gated read will reveal the truth via the 403 path.
      return true;
    }
  }

  /**
   * Read the OS-level authorization status as a normalized string. This
   * is the source of truth for the soft-ask screen — do NOT rely on
   * `requestPermission()`'s return value alone, because on iOS calling
   * it a second time silently returns the existing status without
   * showing a dialog (the OS only allows one prompt for Always).
   *
   * Returning a string keeps callers free of the SDK enum import.
   */
  async getAuthorizationStatus(): Promise<
    'always' | 'whenInUse' | 'denied' | 'restricted' | 'notDetermined'
  > {
    try {
      const provider = await BackgroundGeolocation.getProviderState();
      switch (provider.status) {
        case BackgroundGeolocation.AuthorizationStatus.Always:
          return 'always';
        case BackgroundGeolocation.AuthorizationStatus.WhenInUse:
          return 'whenInUse';
        case BackgroundGeolocation.AuthorizationStatus.Denied:
          return 'denied';
        case BackgroundGeolocation.AuthorizationStatus.Restricted:
          return 'restricted';
        default:
          return 'notDetermined';
      }
    } catch {
      return 'notDetermined';
    }
  }

  /**
   * Request location permissions. The SDK auto-requests on start/startGeofences,
   * but this allows explicit control for permission UI flows.
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const status = await BackgroundGeolocation.requestPermission();
      const granted =
        status === BackgroundGeolocation.AuthorizationStatus.Always ||
        status === BackgroundGeolocation.AuthorizationStatus.WhenInUse;

      // Request full accuracy on iOS 14+ if needed
      if (granted) {
        const provider = await BackgroundGeolocation.getProviderState();
        if (
          provider.accuracyAuthorization ===
          BackgroundGeolocation.AccuracyAuthorization.Reduced
        ) {
          await BackgroundGeolocation.requestTemporaryFullAccuracy(
            'ParkingDetection',
          );
        }
      }

      return granted;
    } catch {
      return false;
    }
  }

  /**
   * Get a single current position (for one-time use, e.g. debug screens).
   */
  async getCurrentPosition(): Promise<Location> {
    return BackgroundGeolocation.getCurrentPosition({
      timeout: 30,
      maximumAge: 5000,
      desiredAccuracy: 10,
      samples: 3,
    });
  }

  /**
   * Stop all tracking and geofence monitoring.
   */
  async stop(): Promise<State> {
    const state = await BackgroundGeolocation.stop();
    this.trackingMode = 'off';
    return state;
  }

  // --- Event listener registration ---

  onGeofence(callback: GeofenceCallback): () => void {
    this.geofenceCallbacks.push(callback);
    return () => {
      const idx = this.geofenceCallbacks.indexOf(callback);
      if (idx > -1) this.geofenceCallbacks.splice(idx, 1);
    };
  }

  onLocation(callback: LocationCallback): () => void {
    this.locationCallbacks.push(callback);
    return () => {
      const idx = this.locationCallbacks.indexOf(callback);
      if (idx > -1) this.locationCallbacks.splice(idx, 1);
    };
  }

  onActivityChange(callback: ActivityCallback): () => void {
    this.activityCallbacks.push(callback);
    return () => {
      const idx = this.activityCallbacks.indexOf(callback);
      if (idx > -1) this.activityCallbacks.splice(idx, 1);
    };
  }

  onMotionChange(callback: MotionCallback): () => void {
    this.motionCallbacks.push(callback);
    return () => {
      const idx = this.motionCallbacks.indexOf(callback);
      if (idx > -1) this.motionCallbacks.splice(idx, 1);
    };
  }

  onProviderChange(callback: ProviderCallback): () => void {
    this.providerCallbacks.push(callback);
    return () => {
      const idx = this.providerCallbacks.indexOf(callback);
      if (idx > -1) this.providerCallbacks.splice(idx, 1);
    };
  }

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const idx = this.errorCallbacks.indexOf(callback);
      if (idx > -1) this.errorCallbacks.splice(idx, 1);
    };
  }

  // --- State queries ---

  getTrackingMode(): 'off' | 'geofences' | 'full' {
    return this.trackingMode;
  }

  isLocationTracking(): boolean {
    return this.trackingMode !== 'off';
  }

  async getMonitoredRegionsCount(): Promise<number> {
    const geofences = await BackgroundGeolocation.getGeofences();
    return geofences.length;
  }

  async getState(): Promise<State> {
    return BackgroundGeolocation.getState();
  }

  /**
   * Trigger a test geofence event (development only).
   */
  triggerTestGeofenceEvent(regionId: string, eventType: 'ENTER' | 'EXIT', activity?: { type: string; confidence: number }, speed?: number) {
    if (!__DEV__) return;

    const event: GeofenceEvent = {
      regionId,
      eventType,
      timestamp: new Date().toISOString(),
      activity,
      speed,
    };
    this.geofenceCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.error('[LocationService] Error in geofence callback:', e);
      }
    });
  }

  /**
   * Cleanup all subscriptions and stop tracking.
   */
  async destroy(): Promise<void> {
    this.subscriptions.forEach((sub) => sub.remove());
    this.subscriptions = [];
    this.geofenceCallbacks = [];
    this.locationCallbacks = [];
    this.activityCallbacks = [];
    this.motionCallbacks = [];
    this.providerCallbacks = [];
    this.errorCallbacks = [];
    await BackgroundGeolocation.removeListeners();
    await BackgroundGeolocation.stop();
    this.trackingMode = 'off';
    this.isInitialized = false;
  }

  // --- Internal SDK event handlers ---

  private handleGeofenceEvent = (event: SDKGeofenceEvent) => {
    const actionMap: Record<string, 'ENTER' | 'EXIT' | 'DWELL'> = {
      ENTER: 'ENTER',
      EXIT: 'EXIT',
      DWELL: 'DWELL',
    };
    const eventType = actionMap[event.action];
    if (!eventType) {
      console.warn(`[LocationService] Unknown geofence action "${event.action}" for region ${event.identifier}, skipping`);
      return;
    }
    const geofenceEvent: GeofenceEvent = {
      regionId: event.identifier,
      eventType,
      timestamp: String(event.location?.timestamp ?? new Date().toISOString()),
      // Preserve activity + speed for parking detection heuristics
      // (drive vs walk distinction). No coordinates stored — privacy first.
      activity: event.location?.activity
        ? { type: event.location.activity.type, confidence: event.location.activity.confidence }
        : undefined,
      speed: event.location?.coords?.speed ?? undefined,
    };

    this.geofenceCallbacks.forEach((cb) => {
      try {
        cb(geofenceEvent);
      } catch (e) {
        console.error('[LocationService] Error in geofence callback:', e);
      }
    });
  };

  private handleLocationEvent = (location: Location) => {
    // Filter out sample locations (intermediate GPS fixes)
    if (location.sample) return;

    // GPS drift suppression: ignore low-quality fixes
    const accuracy = location.coords.accuracy;
    if (accuracy != null && accuracy > 50) {
      if (__DEV__) console.log(`[LocationService] Dropping inaccurate fix (${accuracy}m > 50m)`);
      return;
    }

    this.locationCallbacks.forEach((cb) => {
      try {
        cb(location);
      } catch (e) {
        console.error('[LocationService] Error in location callback:', e);
      }
    });
  };

  private handleActivityChange = (event: MotionActivityEvent) => {
    this.activityCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.error('[LocationService] Error in activity callback:', e);
      }
    });
  };

  private handleMotionChange = (event: MotionChangeEvent) => {
    this.motionCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.error('[LocationService] Error in motion callback:', e);
      }
    });
  };

  private handleProviderChange = (event: ProviderChangeEvent) => {
    if (__DEV__) {
      console.log('[LocationService] Provider changed:', {
        enabled: event.enabled,
        status: event.status,
        accuracyAuthorization: event.accuracyAuthorization,
      });
    }

    const isDenied =
      event.status === BackgroundGeolocation.AuthorizationStatus.Denied ||
      event.status === BackgroundGeolocation.AuthorizationStatus.NotDetermined;

    if (isDenied) {
      // Only surface PERMISSION_DENIED once per authorized→denied transition.
      // iOS may emit Denied and NotDetermined in quick succession for the
      // same toggle, so keying on a boolean (not the exact status) is what
      // actually suppresses the duplicate alert.
      if (!this.hasReportedDenied) {
        this.hasReportedDenied = true;
        this.errorCallbacks.forEach((cb) => {
          try {
            cb({
              code: 'PERMISSION_DENIED',
              message: 'Location permissions were revoked. Geofencing requires at least "When In Use" permission.',
            });
          } catch (e) {
            console.error('[LocationService] Error in error callback:', e);
          }
        });
      }
    } else {
      // Authorized again — arm the dedup so a future revoke fires once.
      this.hasReportedDenied = false;
    }

    this.providerCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.error('[LocationService] Error in provider callback:', e);
      }
    });
  };

  private handlePowerSaveChange = (isPowerSaveMode: boolean) => {
    if (isPowerSaveMode) {
      if (__DEV__) {
        console.warn(
          '[LocationService] Device entered power-save mode. ' +
          'Reducing accuracy to preserve battery.',
        );
      }
      // Dynamically reduce accuracy to conserve battery in power-save mode
      BackgroundGeolocation.setConfig({
        geolocation: {
          desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.Medium,
          distanceFilter: 50,
        },
      }).catch(e => {
        if (__DEV__) console.error('[LocationService] Failed to apply power-save config:', e);
      });
    } else {
      if (__DEV__) {
        console.log('[LocationService] Power-save mode disabled, restoring high accuracy.');
      }
      // Restore high accuracy when power-save is off
      BackgroundGeolocation.setConfig({
        geolocation: {
          desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
          distanceFilter: 20,
        },
      }).catch(e => {
        if (__DEV__) console.error('[LocationService] Failed to restore accuracy config:', e);
      });
    }
  };

  private handleGeofencesChange = (event: { on: Geofence[]; off: string[] }) => {
    if (__DEV__) {
      console.log(
        `[LocationService] Geofences activated: ${event.on.map(g => g.identifier).join(', ') || '(none)'}`,
      );
      console.log(
        `[LocationService] Geofences deactivated: ${event.off.join(', ') || '(none)'}`,
      );
    }
  };
}

// Export singleton instance
export const locationService = new LocationService();
export default locationService;

