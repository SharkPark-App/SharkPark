/**
 * Ambient type declarations for react-native-background-geolocation.
 *
 * The package ships its own @types but uses TypeScript namespaces as types,
 * which trips TS2709 ("Cannot use namespace X as a type") under our strict
 * tsconfig.  We re-declare the same shapes as plain interfaces so every
 * consumer compiles without errors.
 */
declare module 'react-native-background-geolocation' {
  export interface Config {
    // Nested sub-objects used by createSDKConfig()
    geolocation?: {
      desiredAccuracy?: number;
      geofenceProximityRadius?: number;
      stationaryRadius?: number;
      distanceFilter?: number;
      locationAuthorizationRequest?: string;
      geofenceModeHighAccuracy?: boolean;
      geofenceInitialTriggerEntry?: boolean;
      activityType?: number;
      stopTimeout?: number;
      [key: string]: unknown;
    };
    activity?: {
      triggerActivities?: string[];
      stopDetectionDelay?: number;
      [key: string]: unknown;
    };
    app?: {
      stopOnTerminate?: boolean;
      startOnBoot?: boolean;
      enableHeadless?: boolean;
      backgroundPermissionRationale?: Record<string, string>;
      [key: string]: unknown;
    };
    persistence?: {
      persistMode?: number;
      [key: string]: unknown;
    };
    logger?: {
      logLevel?: number;
      [key: string]: unknown;
    };
    // Also allow top-level flat keys for setConfig() calls
    persistMode?: number;
    desiredAccuracy?: number;
    geofenceProximityRadius?: number;
    stationaryRadius?: number;
    distanceFilter?: number;
    locationAuthorizationRequest?: string;
    geofenceModeHighAccuracy?: boolean;
    geofenceInitialTriggerEntry?: boolean;
    activityType?: number;
    triggerActivities?: string[];
    stopDetectionDelay?: number;
    stopOnTerminate?: boolean;
    startOnBoot?: boolean;
    enableHeadless?: boolean;
    backgroundPermissionRationale?: Record<string, string>;
    logLevel?: number;
    transistorAuthorizationToken?: string;
    locationAuthorizationAlert?: Record<string, string>;
    [key: string]: unknown;
  }

  export interface State {
    enabled: boolean;
    trackingMode: number;
    [key: string]: unknown;
  }

  export interface Battery {
    level: number;
    is_charging: boolean;
  }

  export interface Activity {
    type: string;
    confidence: number;
  }

  export interface Coords {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed?: number;
    heading?: number;
    altitude?: number;
  }

  export interface Location {
    coords: Coords;
    timestamp: string;
    is_moving: boolean;
    battery?: Battery;
    activity?: Activity;
    [key: string]: unknown;
  }

  export interface Geofence {
    identifier: string;
    radius: number;
    latitude: number;
    longitude: number;
    notifyOnEntry?: boolean;
    notifyOnExit?: boolean;
    notifyOnDwell?: boolean;
    loiteringDelay?: number;
    vertices?: number[][];
    extras?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface GeofenceEvent {
    identifier: string;
    action: 'ENTER' | 'EXIT' | 'DWELL';
    location: Location;
    [key: string]: unknown;
  }

  export interface MotionActivityEvent {
    activity: string;
    confidence: number;
    [key: string]: unknown;
  }

  export interface MotionChangeEvent {
    isMoving: boolean;
    location: Location;
    [key: string]: unknown;
  }

  export interface ProviderChangeEvent {
    status: number;
    enabled: boolean;
    gps: boolean;
    network: boolean;
    accuracyAuthorization?: number;
    [key: string]: unknown;
  }

  export interface Subscription {
    remove(): void;
  }

  export interface HeartbeatEvent {
    [key: string]: unknown;
  }

  const BackgroundGeolocation: {
    ready(config: Config): Promise<State>;
    start(): Promise<State>;
    stop(): Promise<State>;
    getState(): Promise<State>;
    setConfig(config: Partial<Config>): Promise<State>;
    startGeofences(): Promise<State>;
    addGeofences(geofences: Geofence[]): Promise<void>;
    removeGeofences(identifiers?: string[]): Promise<void>;
    getGeofences(): Promise<Geofence[]>;
    getCurrentPosition(options?: Record<string, unknown>): Promise<Location>;
    requestPermission(): Promise<number>;
    requestTemporaryFullAccuracy(purpose: string): Promise<number>;
    getProviderState(): Promise<ProviderChangeEvent>;
    onLocation(callback: (location: Location) => void): Subscription;
    onGeofence(callback: (event: GeofenceEvent) => void): Subscription;
    onActivityChange(callback: (event: MotionActivityEvent) => void): Subscription;
    onMotionChange(callback: (event: MotionChangeEvent) => void): Subscription;
    onProviderChange(callback: (event: ProviderChangeEvent) => void): Subscription;
    onGeofencesChange(callback: (event: { on: Geofence[]; off: string[] }) => void): Subscription;
    onHeartbeat(callback: (event: HeartbeatEvent) => void): Subscription;
    onPowerSaveChange(callback: (isPowerSaveMode: boolean) => void): Subscription;
    removeListeners(): Promise<void>;
    PersistMode: { None: number; Location: number; Geofence: number; All: number };
    ActivityType: { Other: number; AutomotiveNavigation: number; Fitness: number; OtherNavigation: number };
    DesiredAccuracy: { High: number; Medium: number; Low: number; VeryLow: number; Lowest: number; Navigation: number };
    TriggerActivity: { InVehicle: string; OnBicycle: string; OnFoot: string; Running: string; Walking: string };
    AuthorizationStatus: { NotDetermined: number; Restricted: number; Denied: number; Always: number; WhenInUse: number };
    // NOTE: runtime keys are `Full` and `Reduced` (see
    // node_modules/react-native-background-geolocation/src/index.js).
    // Do NOT rename to `FullAccuracy` — the value will be undefined at
    // runtime and every accuracy comparison silently fails.
    AccuracyAuthorization: { Full: number; Reduced: number };
    LogLevel: { Off: number; Error: number; Warning: number; Info: number; Debug: number; Verbose: number };
    [key: string]: unknown;
  };

  export default BackgroundGeolocation;
}
