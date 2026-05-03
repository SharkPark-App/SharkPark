/**
 * Tests for src/services/carBluetooth.ts
 *
 * The service wraps NativeModules.CarBluetoothModule. All tests confirm the
 * safe-fallback contract: when the native module is absent (Android/sim)
 * every API returns a benign value instead of crashing.
 */

import { NativeModules } from 'react-native';

// NativeEventEmitter is mocked globally by the RN Jest preset.
// Provide a per-test factory for NativeModules.CarBluetoothModule.

// We import the module under test AFTER configuring NativeModules so
// the module-level `isAvailable` getter reads the right value.

describe('carBluetooth service', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  function loadService() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('../src/services/carBluetooth') as { default: typeof import('../src/services/carBluetooth').default }).default;
  }

  function withNativeModule(impl: Record<string, unknown> | null) {
    if (impl) {
      NativeModules.CarBluetoothModule = impl;
    } else {
      delete NativeModules.CarBluetoothModule;
    }
  }

  // ── isAvailable ────────────────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('is false when the native module is absent', () => {
      withNativeModule(null);
      const svc = loadService();
      expect(svc.isAvailable).toBe(false);
    });

    it('is true when the native module is present', () => {
      withNativeModule({ isConnected: jest.fn(), onConnect: jest.fn(), onDisconnect: jest.fn() });
      const svc = loadService();
      expect(svc.isAvailable).toBe(true);
    });
  });

  // ── isConnected ────────────────────────────────────────────────────────────

  describe('isConnected', () => {
    it('returns false when native module is absent', async () => {
      withNativeModule(null);
      const svc = loadService();
      await expect(svc.isConnected()).resolves.toBe(false);
    });

    it('returns the value from the native module', async () => {
      withNativeModule({ isConnected: jest.fn().mockResolvedValue(true) });
      const svc = loadService();
      await expect(svc.isConnected()).resolves.toBe(true);
    });

    it('returns false when the native module throws', async () => {
      withNativeModule({ isConnected: jest.fn().mockRejectedValue(new Error('BT error')) });
      const svc = loadService();
      await expect(svc.isConnected()).resolves.toBe(false);
    });
  });

  // ── onConnect ─────────────────────────────────────────────────────────────

  describe('onConnect', () => {
    it('returns a no-op remove handle when native module is absent', () => {
      withNativeModule(null);
      const svc = loadService();
      const handle = svc.onConnect(jest.fn());
      expect(handle).toHaveProperty('remove');
      expect(() => handle.remove()).not.toThrow();
    });

    it('calls NativeEventEmitter.addListener and wires remove', () => {
      const mockRemove = jest.fn();
      const mockAddListener = jest.fn().mockReturnValue({ remove: mockRemove });
      // Provide the module so NativeEventEmitter can be constructed around it
      withNativeModule({ addListener: jest.fn(), removeListeners: jest.fn() });

      // Patch NativeEventEmitter prototype after module reset
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const NativeEventEmitter = require('react-native').NativeEventEmitter;
      NativeEventEmitter.prototype.addListener = mockAddListener;

      const svc = loadService();
      const listener = jest.fn();
      const handle = svc.onConnect(listener);

      expect(mockAddListener).toHaveBeenCalledWith('onCarBluetoothConnect', listener);
      handle.remove();
      expect(mockRemove).toHaveBeenCalled();
    });
  });

  // ── onDisconnect ───────────────────────────────────────────────────────────

  describe('onDisconnect', () => {
    it('returns a no-op remove handle when native module is absent', () => {
      withNativeModule(null);
      const svc = loadService();
      const handle = svc.onDisconnect(jest.fn());
      expect(handle).toHaveProperty('remove');
      expect(() => handle.remove()).not.toThrow();
    });

    it('calls NativeEventEmitter.addListener and wires remove', () => {
      const mockRemove = jest.fn();
      const mockAddListener = jest.fn().mockReturnValue({ remove: mockRemove });
      withNativeModule({ addListener: jest.fn(), removeListeners: jest.fn() });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const NativeEventEmitter = require('react-native').NativeEventEmitter;
      NativeEventEmitter.prototype.addListener = mockAddListener;

      const svc = loadService();
      const listener = jest.fn();
      const handle = svc.onDisconnect(listener);

      expect(mockAddListener).toHaveBeenCalledWith('onCarBluetoothDisconnect', listener);
      handle.remove();
      expect(mockRemove).toHaveBeenCalled();
    });
  });
});
