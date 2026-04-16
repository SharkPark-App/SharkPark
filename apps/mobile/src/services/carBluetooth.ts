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

interface CarBluetoothEvent {
  timestamp: string;
  portType?: string;         // iOS
  previousPortType?: string; // iOS disconnect
  deviceName?: string;       // Android
  deviceAddress?: string;    // Android
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
    const sub = em.addListener('onCarBluetoothConnect', listener);
    return { remove: () => sub.remove() };
  },

  /** Subscribe to car Bluetooth disconnect events. Returns { remove() }. */
  onDisconnect(listener: CarBluetoothListener): { remove: () => void } {
    const em = getEmitter();
    if (!em) return { remove: () => {} };
    const sub = em.addListener('onCarBluetoothDisconnect', listener);
    return { remove: () => sub.remove() };
  },
};

export default carBluetooth;
