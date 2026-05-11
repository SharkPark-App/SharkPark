/**
 * Car Bluetooth Detection Module
 *
 * Wraps the native CarBluetoothModule (iOS: AVAudioSession route changes,
 * Android: A2DP/HFP profile broadcasts) and exposes a simple JS API.
 *
 * Usage:
 *   import carBluetooth from './carBluetooth';
 *
 *   const connected = await carBluetooth.isConnected();
 *
 *   const sub = carBluetooth.onDisconnect(() => { ... });
 *   sub.remove();
 */

import { NativeModules, NativeEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface CarBluetoothEvent {
  timestamp: string;
  portType?: string;         // iOS
  previousPortType?: string; // iOS disconnect
  deviceName?: string;       // Android
  deviceAddress?: string;    // Android
  deviceId?: string;         // canonical ID (address or UUID)
}

export type CarBluetoothListener = (event: CarBluetoothEvent) => void;

interface CarBluetoothNativeModule {
  isConnected(): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const NativeCarBluetooth: CarBluetoothNativeModule | undefined =
  NativeModules.CarBluetoothModule;

// Build the emitter only if the native module exists (avoids crash on simulators / test env)
let emitter: NativeEventEmitter | null = null;
function getEmitter(): NativeEventEmitter | null {
  if (!emitter && NativeCarBluetooth) {
    emitter = new NativeEventEmitter(NativeModules.CarBluetoothModule);
  }
  return emitter;
}

interface CarBluetoothDeviceRecord {
  deviceId: string;
  deviceName?: string;
  firstSeenTime: number;
  lastConnectTime?: number;
  isCurrentlyConnected: boolean;
}

class CarBluetoothManager {
  private knownDevices = new Map<string, CarBluetoothDeviceRecord>();
  private currentlyConnectedDevice: string | null = null;
  private initPromise: Promise<void>;
  private persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PERSIST_KEY = '@SharkPark:bluetoothKnownDevices';
  private readonly PERSIST_DEBOUNCE_MS = 10_000;

  private connectListeners: CarBluetoothListener[] = [];
  private disconnectListeners: CarBluetoothListener[] = [];
  private deviceDiscoveryListeners: ((newDeviceIds: string[]) => void)[] = [];

  constructor() {
    this.initPromise = this.loadPersistedDevices();
  }

  private async loadPersistedDevices(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(this.PERSIST_KEY);
      if (!raw) return;
      const devices: CarBluetoothDeviceRecord[] = JSON.parse(raw);
      devices.forEach(dev => {
        this.knownDevices.set(dev.deviceId, { ...dev, isCurrentlyConnected: false });
      });
      if (__DEV__) {
        console.log(`[CarBluetooth] Loaded ${devices.length} known BT devices`);
      }
    } catch (e) {
      if (__DEV__) console.error('[CarBluetooth] Failed to load persisted devices:', e);
    }
  }

  private persistDevices(): void {
    // Debounce to avoid excessive AsyncStorage writes
    if (this.persistDebounceTimer) clearTimeout(this.persistDebounceTimer);
    this.persistDebounceTimer = setTimeout(() => {
      const devices = Array.from(this.knownDevices.values());
      AsyncStorage.setItem(this.PERSIST_KEY, JSON.stringify(devices))
        .catch(e => {
          if (__DEV__) console.error('[CarBluetooth] Failed to persist devices:', e);
        });
    }, this.PERSIST_DEBOUNCE_MS);
  }

  private canonicalizeDeviceId(event: CarBluetoothEvent): string {
    // Prefer Android deviceAddress (MAC), fall back to iOS port type or generic ID
    if (event.deviceAddress) return event.deviceAddress;
    if (event.deviceId) return event.deviceId;
    return `device-${event.portType || event.timestamp}`;
  }

  async onConnect(event: CarBluetoothEvent): Promise<void> {
    await this.initPromise;
    const deviceId = this.canonicalizeDeviceId(event);

    const isNewDevice = !this.knownDevices.has(deviceId);

    if (isNewDevice) {
      this.knownDevices.set(deviceId, {
        deviceId,
        deviceName: event.deviceName,
        firstSeenTime: Date.now(),
        lastConnectTime: Date.now(),
        isCurrentlyConnected: true,
      });
      if (__DEV__) console.log(`[CarBluetooth] NEW device connected: ${deviceId} (${event.deviceName})`);

      // Notify discovery listeners (used by carpool detection)
      this.deviceDiscoveryListeners.forEach(cb => cb([deviceId]));
    } else {
      const record = this.knownDevices.get(deviceId)!;
      record.lastConnectTime = Date.now();
      record.isCurrentlyConnected = true;
      if (__DEV__) console.log(`[CarBluetooth] Known device reconnected: ${deviceId}`);
    }

    this.currentlyConnectedDevice = deviceId;
    this.persistDevices();

    // Notify connect listeners
    this.connectListeners.forEach(cb => cb(event));
  }

  async onDisconnect(event: CarBluetoothEvent): Promise<void> {
    await this.initPromise;
    const deviceId = this.canonicalizeDeviceId(event);

    if (this.knownDevices.has(deviceId)) {
      const record = this.knownDevices.get(deviceId)!;
      record.isCurrentlyConnected = false;
    }

    if (this.currentlyConnectedDevice === deviceId) {
      this.currentlyConnectedDevice = null;
    }

    // Notify disconnect listeners
    this.disconnectListeners.forEach(cb => cb(event));
  }

  /**
   * Get list of all known device IDs (devices that have connected in the past)
   */
  getKnownDeviceIds(): string[] {
    return Array.from(this.knownDevices.keys());
  }

  /**
   * Get device record by ID
   */
  getDevice(deviceId: string): CarBluetoothDeviceRecord | undefined {
    return this.knownDevices.get(deviceId);
  }

  /**
   * Get currently connected device ID (if any)
   */
  getCurrentlyConnectedDevice(): string | null {
    return this.currentlyConnectedDevice;
  }

  /**
   * Subscribe to new device discovery (returns { remove() })
   */
  onNewDeviceDiscovered(listener: (deviceIds: string[]) => void): { remove: () => void } {
    this.deviceDiscoveryListeners.push(listener);
    return {
      remove: () => {
        const idx = this.deviceDiscoveryListeners.indexOf(listener);
        if (idx >= 0) this.deviceDiscoveryListeners.splice(idx, 1);
      },
    };
  }
}

const bluetoothManager = new CarBluetoothManager();

const carBluetooth = {
  /** Whether the native module is available (false on simulators / missing link). */
  get isAvailable(): boolean {
    return NativeCarBluetooth != null;
  },

  /** Returns whether car Bluetooth audio is currently connected. */
  async isConnected(): Promise<boolean> {
    if (!NativeCarBluetooth) return false;
    try {
      return await NativeCarBluetooth.isConnected();
    } catch {
      return false;
    }
  },

  /** Subscribe to car Bluetooth connect events. Returns { remove() }. */
  onConnect(listener: CarBluetoothListener): { remove: () => void } {
    const em = getEmitter();
    if (!em) return { remove: () => {} };
    
    // Also notify the manager
    const managedListener = (event: CarBluetoothEvent) => {
      bluetoothManager.onConnect(event).catch(e => {
        if (__DEV__) console.error('[CarBluetooth] Failed to process connect:', e);
      });
      listener(event);
    };

    const sub = em.addListener('onCarBluetoothConnect', managedListener);
    return { remove: () => sub.remove() };
  },

  /** Subscribe to car Bluetooth disconnect events. Returns { remove() }. */
  onDisconnect(listener: CarBluetoothListener): { remove: () => void } {
    const em = getEmitter();
    if (!em) return { remove: () => {} };
    
    // Also notify the manager
    const managedListener = (event: CarBluetoothEvent) => {
      bluetoothManager.onDisconnect(event).catch(e => {
        if (__DEV__) console.error('[CarBluetooth] Failed to process disconnect:', e);
      });
      listener(event);
    };

    const sub = em.addListener('onCarBluetoothDisconnect', managedListener);
    return { remove: () => sub.remove() };
  },

  /**
   * Get list of all known device IDs (pair history)
   */
  getKnownDeviceIds(): string[] {
    return bluetoothManager.getKnownDeviceIds();
  },

  /**
   * Subscribe to NEW device discovery (not reconnections)
   */
  onNewDeviceDiscovered(listener: (deviceIds: string[]) => void): { remove: () => void } {
    return bluetoothManager.onNewDeviceDiscovered(listener);
  },
};

export default carBluetooth;
