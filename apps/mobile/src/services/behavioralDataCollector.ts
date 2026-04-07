/**
 * Behavioral Data Collector Service
 * Collects real sensor data for parking validation including:
 * - User speed from GPS location updates
 * - Device connectivity (Bluetooth state, WiFi)
 * - Device information (battery, model, etc.)
 * - Motion patterns
 */

import { useEffect, useRef, useCallback } from 'react';
import Geolocation from '@react-native-community/geolocation';
import NetInfo from '@react-native-community/netinfo';
import DeviceInfo from 'react-native-device-info';
import BluetoothStatus from 'react-native-bluetooth-status';
import { ValidationEvent } from '../validation';

export interface BehavioralMetrics {
  speed_mph: number | null;
  accuracy_meters: number | null;
  bluetooth_state: ValidationEvent['bluetooth_state'];
  wifi_connected: boolean;
  network_type: string | null;
  device_info: {
    brand: string;
    model: string;
    system_version: string;
    app_version: string;
    battery_level?: number;
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
}

interface DataCollectionCallbacks {
  onMetricsCollected: (metrics: BehavioralMetrics) => void;
  onError: (error: string) => void;
}

class BehavioralDataCollector {
  private locationWatchId: number | null = null;
  private lastLocation: LocationData | null = null;
  private callbacks: DataCollectionCallbacks | null = null;
  private isCollecting = false;
  private collectionInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start collecting behavioral data
   */
  async startCollection(callbacks: DataCollectionCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.isCollecting = true;

    try {
      // Start location tracking for speed and movement
      this.startLocationTracking();

      // Start periodic data collection (every 30 seconds)
      this.collectionInterval = setInterval(() => {
        this.collectAndSendMetrics();
      }, 30000);

      // Collect initial metrics
      await this.collectAndSendMetrics();

    } catch (error) {
      this.callbacks?.onError(`Failed to start data collection: ${error}`);
    }
  }

  /**
   * Stop collecting behavioral data
   */
  stopCollection(): void {
    this.isCollecting = false;
    
    if (this.locationWatchId) {
      Geolocation.clearWatch(this.locationWatchId);
      this.locationWatchId = null;
    }

    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    this.callbacks = null;
    this.lastLocation = null;
  }

  /**
   * Start tracking location for speed and movement data
   */
  private startLocationTracking(): void {
    this.locationWatchId = Geolocation.watchPosition(
      (position) => {
        const locationData: LocationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed, // meters per second
          altitude: position.coords.altitude,
          heading: position.coords.heading,
          timestamp: position.timestamp
        };

        this.lastLocation = locationData;
      },
      (error) => {
        this.callbacks?.onError(`Location tracking error: ${error.message}`);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 1, // Update every 1 meter
        interval: 5000, // Update every 5 seconds
        fastestInterval: 2000, // Fastest update every 2 seconds
      }
    );
  }

  /**
   * Collect all metrics and send to callback
   */
  private async collectAndSendMetrics(): Promise<void> {
    if (!this.isCollecting || !this.callbacks) {
      return;
    }

    try {
      const metrics = await this.buildMetrics();
      this.callbacks.onMetricsCollected(metrics);
    } catch (error) {
      this.callbacks?.onError(`Failed to collect metrics: ${error}`);
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
      batteryLevel
    ] = await Promise.all([
      this.getBluetoothState(),
      NetInfo.fetch(),
      DeviceInfo.getBrand(),
      DeviceInfo.getModel(),
      DeviceInfo.getSystemVersion(),
      DeviceInfo.getVersion(),
      DeviceInfo.getBatteryLevel().catch(() => null)
    ]);

    // Calculate speed from location data
    const speedMph = this.calculateSpeed();

    return {
      speed_mph: speedMph,
      accuracy_meters: this.lastLocation?.accuracy || null,
      bluetooth_state: bluetoothState,
      wifi_connected: networkState.type === 'wifi' && networkState.isConnected === true,
      network_type: networkState.type,
      device_info: {
        brand: deviceBrand,
        model: deviceModel,
        system_version: systemVersion,
        app_version: appVersion,
        battery_level: batteryLevel || undefined
      },
      raw_data: {
        timestamp: new Date().toISOString(),
        location_accuracy: this.lastLocation?.accuracy || null,
        altitude: this.lastLocation?.altitude || null,
        heading: this.lastLocation?.heading || null,
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
      // Get actual Bluetooth state from the device
      const isBluetoothEnabled = await BluetoothStatus.state();
      
      if (isBluetoothEnabled) {
        return 'CONNECTED'; // Bluetooth is enabled/available
      } else {
        return 'DISCONNECTED'; // Bluetooth is disabled
      }
    } catch (error) {
      console.warn('[BehavioralDataCollector] Failed to get Bluetooth state:', error);
      
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      collectorRef.current?.stopCollection();
    };
  }, []);

  return {
    startCollection,
    stopCollection,
    getCurrentMetrics
  };
};

export default BehavioralDataCollector;
