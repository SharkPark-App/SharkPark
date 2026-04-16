/**
 * Behavioral Data Collector Service
 * Collects real sensor data for parking validation including:
 * - User speed from GPS location updates
 * - Device connectivity (car Bluetooth, WiFi)
 * - Device information (battery, model, etc.)
 * - Motion patterns
 */

import NetInfo from '@react-native-community/netinfo';
import DeviceInfo from 'react-native-device-info';
import carBluetooth from './carBluetooth';
import { ValidationEvent } from '../validation';

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

  // Car Bluetooth state — updated via event-driven callbacks from CarBluetoothModule
  private carBluetoothConnected: boolean | null = null;

  // Cached device info (static per app session)
  private cachedDeviceInfo: { brand: string; model: string; system_version: string; app_version: string } | null = null;

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
    this.carBluetoothConnected = null;
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

    // Push metrics on motion state change (still ↔ moving is critical for parking detection)
    this.collectAndSendMetrics();
  }

  /**
   * Update car Bluetooth connection state from CarBluetoothModule events.
   * Called by the geofencing provider when connect/disconnect events fire.
   */
  updateCarBluetoothState(connected: boolean): void {
    this.carBluetoothConnected = connected;

    // Push metrics immediately — Bluetooth state change is a strong parking/leave signal
    this.collectAndSendMetrics();
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
    // Cache device info on first call (static per app session)
    if (!this.cachedDeviceInfo) {
      const [brand, model, systemVersion, appVersion] = await Promise.all([
        DeviceInfo.getBrand(),
        DeviceInfo.getModel(),
        DeviceInfo.getSystemVersion(),
        DeviceInfo.getVersion(),
      ]);
      this.cachedDeviceInfo = { brand, model, system_version: systemVersion, app_version: appVersion };
    }

    // Collect dynamic data in parallel
    const [bluetoothState, networkState] = await Promise.all([
      this.getBluetoothState(),
      NetInfo.fetch(),
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
        brand: this.cachedDeviceInfo.brand,
        model: this.cachedDeviceInfo.model,
        system_version: this.cachedDeviceInfo.system_version,
        app_version: this.cachedDeviceInfo.app_version,
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
   * Get current car Bluetooth state.
   * Prefers the cached event-driven state; falls back to polling the native module.
   */
  private async getBluetoothState(): Promise<ValidationEvent['bluetooth_state']> {
    // If we have event-driven state, use it (most up-to-date)
    if (this.carBluetoothConnected !== null) {
      return this.carBluetoothConnected ? 'CONNECTED' : 'DISCONNECTED';
    }

    // Fallback: poll the native module for initial state
    try {
      const connected = await carBluetooth.isConnected();
      this.carBluetoothConnected = connected;
      return connected ? 'CONNECTED' : 'DISCONNECTED';
    } catch {
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

// Shared singleton instance — both parkingValidationService and leaveDetectionService
// must use this so GPS/sensor data is collected and processed only once.
export const sharedBehavioralCollector = new BehavioralDataCollector();

export default BehavioralDataCollector;
