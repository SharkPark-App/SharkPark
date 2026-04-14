/**
 * Behavioral Data Collector Service
 * Collects real sensor data for parking validation including:
 * - User speed from GPS location updates
 * - Device connectivity (Bluetooth state, WiFi)
 * - Device information (battery, model, etc.)
 * - Motion patterns
 */

import { useEffect, useRef, useCallback } from 'react';
import { NativeModules } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import DeviceInfo from 'react-native-device-info';
import { ValidationEvent } from '../validation';

// Lazy-load react-native-bluetooth-status only when the native module is
// present. The library instantiates NativeEventEmitter at require-time,
// which fatally crashes if the native module (RNBluetoothManager) isn't
// linked (e.g. on iOS simulators).  Checking NativeModules first avoids
// the require entirely.
let _BluetoothStatus: typeof import('react-native-bluetooth-status').default | undefined;
let _bluetoothChecked = false;
function getBluetoothStatusModule() {
  if (!_bluetoothChecked) {
    _bluetoothChecked = true;
    if (NativeModules.RNBluetoothManager) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        _BluetoothStatus = require('react-native-bluetooth-status').default;
      } catch {
        _BluetoothStatus = undefined;
      }
    }
  }
  return _BluetoothStatus;
}

export type ActivityType = 'still' | 'on_foot' | 'in_vehicle' | 'on_bicycle' | 'running' | 'unknown';

export interface BehavioralMetrics {
  speed_mph: number | null;
  accuracy_meters: number | null;
  bluetooth_state: ValidationEvent['bluetooth_state'];
  wifi_connected: boolean;
  network_type: string | null;
  activity_type: ActivityType;
  activity_confidence: number; // 0-100
  is_moving: boolean;
  device_info: {
    brand: string;
    model: string;
    system_version: string;
    app_version: string;
    battery_level?: number;
    battery_charging?: boolean;
  };
  raw_data: {
    timestamp: string;
    location_accuracy: number | null;
    altitude: number | null;
    heading: number | null;
    wifi_ssid?: string;
    cellular_carrier?: string;
  };
}

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  altitude: number | null;
  heading: number | null;
  timestamp: number;
  battery_level: number | null;
  battery_charging: boolean | null;
}

interface DataCollectionCallbacks {
  onMetricsCollected: (metrics: BehavioralMetrics) => void;
  onError: (error: string) => void;
}

class BehavioralDataCollector {
  private lastLocation: LocationData | null = null;
  private isCollecting = false;

  // Activity recognition state from SDK
  private currentActivity: ActivityType = 'unknown';
  private activityConfidence = 0;
  private isMoving = false;

  // Multiple subscribers can register callbacks independently.
  // Using a Map keyed by a caller-supplied id so each service can
  // start/stop independently without affecting the other.
  private subscribers = new Map<string, DataCollectionCallbacks>();

  /**
   * Register a subscriber. Metrics are pushed via updateLocation/updateActivity
   * from the SDK event stream — no polling interval needed.
   * @param subscriberId  A stable string identifying the caller (e.g. 'parkingValidation')
   */
  async startCollection(callbacks: DataCollectionCallbacks, subscriberId = 'default'): Promise<void> {
    this.subscribers.set(subscriberId, callbacks);
    this.isCollecting = true;
  }

  /**
   * Unregister a subscriber. Stops collecting only when no subscribers remain.
   * @param subscriberId  Must match the id used in startCollection
   */
  stopCollection(subscriberId = 'default'): void {
    this.subscribers.delete(subscriberId);

    if (this.subscribers.size === 0) {
      this.teardown();
    }
  }

  /**
   * Force-stop all collection, clear all subscribers.
   * Use when the owning component unmounts to prevent memory leaks.
   */
  destroy(): void {
    this.subscribers.clear();
    this.teardown();
  }

  private teardown(): void {
    this.isCollecting = false;
    this.lastLocation = null;
    this.currentActivity = 'unknown';
    this.activityConfidence = 0;
    this.isMoving = false;
  }

  /**
   * Update location data from SDK onLocation events.
   * Automatically pushes metrics to all subscribers.
   */
  updateLocation(locationData: {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
    altitude?: number | null;
    heading?: number | null;
    battery_level?: number | null;
    battery_charging?: boolean | null;
  }): void {
    this.lastLocation = {
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      accuracy: locationData.accuracy,
      speed: locationData.speed,
      altitude: locationData.altitude ?? null,
      heading: locationData.heading ?? null,
      timestamp: Date.now(),
      battery_level: locationData.battery_level ?? null,
      battery_charging: locationData.battery_charging ?? null,
    };

    // Push metrics immediately on location update (event-driven, no polling)
    this.collectAndSendMetrics();
  }

  /**
   * Update activity recognition data from SDK onActivityChange events.
   */
  updateActivity(activity: string, confidence: number): void {
    this.currentActivity = this.mapActivityType(activity);
    this.activityConfidence = confidence;

    // Push metrics immediately on activity change
    this.collectAndSendMetrics();
  }

  /**
   * Update motion state from SDK onMotionChange events.
   */
  updateMotion(isMoving: boolean): void {
    this.isMoving = isMoving;
  }

  private mapActivityType(activity: string): ActivityType {
    switch (activity.toLowerCase()) {
      case 'still': return 'still';
      case 'on_foot': case 'walking': return 'on_foot';
      case 'in_vehicle': case 'automotive': return 'in_vehicle';
      case 'on_bicycle': return 'on_bicycle';
      case 'running': return 'running';
      default: return 'unknown';
    }
  }

  private async collectAndSendMetrics(): Promise<void> {
    if (this.subscribers.size === 0) {
      return;
    }

    try {
      const metrics = await this.buildMetrics();

      // Fan out to all subscribers
      this.subscribers.forEach(cb => cb.onMetricsCollected(metrics));

    } catch (error) {
      this.subscribers.forEach(cb => cb.onError(`Failed to collect metrics: ${error}`));
    }
  }

  /**
   * Build a metrics snapshot from current sensor data
   */
  private async buildMetrics(): Promise<BehavioralMetrics> {
    // Collect all data in parallel
    const [
      bluetoothState,
      networkState,
      deviceBrand,
      deviceModel,
      systemVersion,
      appVersion,
    ] = await Promise.all([
      this.getBluetoothState(),
      NetInfo.fetch(),
      DeviceInfo.getBrand(),
      DeviceInfo.getModel(),
      DeviceInfo.getSystemVersion(),
      DeviceInfo.getVersion(),
    ]);

    // Use battery level from SDK Location (no extra async call needed)
    const batteryLevel = this.lastLocation?.battery_level ?? null;
    const batteryCharging = this.lastLocation?.battery_charging ?? null;

    // Calculate speed from location data
    const speedMph = this.calculateSpeed();

    return {
      speed_mph: speedMph,
      accuracy_meters: this.lastLocation?.accuracy ?? null,
      bluetooth_state: bluetoothState,
      wifi_connected: networkState.type === 'wifi' && networkState.isConnected === true,
      network_type: networkState.type,
      activity_type: this.currentActivity,
      activity_confidence: this.activityConfidence,
      is_moving: this.isMoving,
      device_info: {
        brand: deviceBrand,
        model: deviceModel,
        system_version: systemVersion,
        app_version: appVersion,
        battery_level: batteryLevel || undefined,
        battery_charging: batteryCharging ?? undefined,
      },
      raw_data: {
        timestamp: new Date().toISOString(),
        location_accuracy: this.lastLocation?.accuracy ?? null,
        altitude: this.lastLocation?.altitude ?? null,
        heading: this.lastLocation?.heading ?? null,
        wifi_ssid: networkState.type === 'wifi' ? networkState.details?.ssid || undefined : undefined,
        cellular_carrier: networkState.type === 'cellular' ? networkState.details?.carrier || undefined : undefined
      }
    };
  }

  /**
   * Get current Bluetooth state
   * Uses react-native-bluetooth-status to detect actual Bluetooth state
   */
  private async getBluetoothState(): Promise<ValidationEvent['bluetooth_state']> {
    try {
      const BluetoothStatus = getBluetoothStatusModule();
      // Check if BluetoothStatus is available
      if (!BluetoothStatus || typeof BluetoothStatus.state !== 'function') {
        if (__DEV__) console.warn('[BehavioralDataCollector] BluetoothStatus API not available');
        return null;
      }

      // Get actual Bluetooth state from the device
      const bluetoothState = await BluetoothStatus.state();
      
      // Check if bluetoothState is null/undefined
      if (bluetoothState === null || bluetoothState === undefined) {
        if (__DEV__) console.warn('[BehavioralDataCollector] BluetoothStatus.state() returned null/undefined');
        return null;
      }
      
      // Handle different possible return formats
      if (typeof bluetoothState === 'boolean') {
        return bluetoothState ? 'CONNECTED' : 'DISCONNECTED';
      } else if (bluetoothState && typeof bluetoothState === 'object') {
        // If it returns an object, check for common state properties.
        // Use 'in' checks rather than || chaining so that a boolean false
        // value is not accidentally skipped by short-circuit evaluation.
        const stateObj = bluetoothState as Record<string, unknown>; // Handle unknown object structure safely
        const rawState =
          'state' in stateObj ? stateObj.state :
          'enabled' in stateObj ? stateObj.enabled :
          'status' in stateObj ? stateObj.status : undefined;
        if (typeof rawState === 'boolean') {
          return rawState ? 'CONNECTED' : 'DISCONNECTED';
        } else if (typeof rawState === 'string') {
          return rawState.toLowerCase().includes('on') || rawState.toLowerCase().includes('enabled')
            ? 'CONNECTED' : 'DISCONNECTED';
        }
      }
      
      // If we can't determine the state
      if (__DEV__) console.warn('[BehavioralDataCollector] Bluetooth state returned unexpected format:', bluetoothState);
      return null; // UNKNOWN state
      
    } catch (error) {
      if (__DEV__) console.warn('[BehavioralDataCollector] Failed to get Bluetooth state:', error);
      
      // If we can't determine the state, return UNKNOWN (null)
      return null;
    }
  }

  /**
   * Calculate speed in MPH from location data
   */
  private calculateSpeed(): number | null {
    if (!this.lastLocation || this.lastLocation.speed === null) {
      return null;
    }

    // Convert from meters per second to miles per hour
    // 1 m/s = 2.237 mph
    return Math.round(this.lastLocation.speed * 2.237 * 100) / 100;
  }

  /**
   * Get current metrics without starting collection (for testing)
   */
  async getCurrentMetrics(): Promise<BehavioralMetrics | null> {
    try {
      return await this.buildMetrics();
    } catch {
      return null;
    }
  }
}

/**
 * React Hook for behavioral data collection
 */
export const useBehavioralDataCollection = () => {
  const collectorRef = useRef<BehavioralDataCollector | null>(null);

  // Initialize collector on first use
  if (!collectorRef.current) {
    collectorRef.current = new BehavioralDataCollector();
  }

  const startCollection = useCallback((callbacks: DataCollectionCallbacks) => {
    collectorRef.current?.startCollection(callbacks);
  }, []);

  const stopCollection = useCallback(() => {
    collectorRef.current?.stopCollection();
  }, []);

  const getCurrentMetrics = useCallback(async (): Promise<BehavioralMetrics | null> => {
    return collectorRef.current?.getCurrentMetrics() || null;
  }, []);

  // Cleanup on unmount — destroy() force-clears all subscribers and timers
  useEffect(() => {
    return () => {
      collectorRef.current?.destroy();
    };
  }, []);

  return {
    startCollection,
    stopCollection,
    getCurrentMetrics
  };
};

// Shared singleton instance — both parkingValidationService and leaveDetectionService
// must use this so GPS/sensor data is collected and processed only once.
export const sharedBehavioralCollector = new BehavioralDataCollector();

export default BehavioralDataCollector;
