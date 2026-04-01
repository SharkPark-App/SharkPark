/**
 * @jest-environment node
 *
 * Tests for BehavioralDataCollector.
 *
 * The service no longer starts its own Geolocation.watchPosition — location is
 * fed externally via updateLocation().  Metrics are emitted either:
 *   (a) on the 30-second interval (advanced with jest.useFakeTimers), or
 *   (b) immediately when getCurrentMetrics() is called.
 */

import BehavioralDataCollector from '../behavioralDataCollector';

// ─── Native module mocks ─────────────────────────────────────────────────────

jest.mock('@react-native-community/geolocation', () => ({
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
}));

jest.mock('react-native-device-info', () => ({
  getBrand: jest.fn(),
  getModel: jest.fn(),
  getSystemVersion: jest.fn(),
  getVersion: jest.fn(),
  getBatteryLevel: jest.fn(),
}));

// react-native-bluetooth-status creates a NativeEventEmitter in its module
// body which requires a non-null native module — provide a minimal mock so
// the import does not throw in a Node test environment.
jest.mock('react-native-bluetooth-status', () => ({
  state: jest.fn(),
}));

jest.mock('react-native', () => ({
  NativeEventEmitter: jest.fn(() => ({
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })),
  NativeModules: {},
  Platform: { OS: 'ios' },
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import NetInfo from '@react-native-community/netinfo';
import DeviceInfo from 'react-native-device-info';
import BluetoothStatus from 'react-native-bluetooth-status';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeLocation = (overrides: Partial<Parameters<BehavioralDataCollector['updateLocation']>[0]> = {}) => ({
  latitude: 33.7838,
  longitude: -118.1134,
  accuracy: 10,
  speed: 2.5,
  altitude: 50,
  heading: 90,
  ...overrides,
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('BehavioralDataCollector', () => {
  let collector: BehavioralDataCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    collector = new BehavioralDataCollector();

    (NetInfo.fetch as jest.Mock).mockResolvedValue({
      type: 'wifi',
      isConnected: true,
      details: { ssid: 'TestNetwork' },
    });

    (DeviceInfo.getBrand as jest.Mock).mockResolvedValue('Apple');
    (DeviceInfo.getModel as jest.Mock).mockResolvedValue('iPhone');
    (DeviceInfo.getSystemVersion as jest.Mock).mockResolvedValue('17.0');
    (DeviceInfo.getVersion as jest.Mock).mockResolvedValue('1.0.0');
    (DeviceInfo.getBatteryLevel as jest.Mock).mockResolvedValue(0.85);
  });

  afterEach(() => {
    collector.stopCollection();
  });

  // ── Bluetooth state ───────────────────────────────────────────────────────

  describe('Bluetooth State Detection', () => {
    it('returns CONNECTED when Bluetooth is enabled', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
    });

    it('returns DISCONNECTED when Bluetooth is disabled', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(false);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('DISCONNECTED');
    });

    it('returns null bluetooth_state when Bluetooth state check throws', async () => {
      (BluetoothStatus.state as jest.Mock).mockRejectedValue(new Error('Bluetooth access denied'));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBeNull();
    });
  });

  // ── Complete metrics shape ────────────────────────────────────────────────

  describe('Complete Data Collection', () => {
    it('collects all behavioral metrics in a single getCurrentMetrics call', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      collector.updateLocation(makeLocation({ speed: 5 }));

      const metrics = await collector.getCurrentMetrics();

      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
      expect(metrics!.wifi_connected).toBe(true);
      expect(metrics!.network_type).toBe('wifi');
      expect(metrics!.speed_mph).toBeCloseTo(11.18, 1);
      expect(metrics!.accuracy_meters).toBe(10);
      expect(metrics!.device_info.brand).toBe('Apple');
      expect(metrics!.device_info.model).toBe('iPhone');
      expect(metrics!.device_info.system_version).toBe('17.0');
      expect(metrics!.device_info.app_version).toBe('1.0.0');
      expect(metrics!.device_info.battery_level).toBe(0.85);
      expect(metrics!.raw_data.wifi_ssid).toBe('TestNetwork');
      expect(typeof metrics!.raw_data.timestamp).toBe('string');
    });

    it('handles cellular network data correctly', async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        type: 'cellular',
        isConnected: true,
        details: { carrier: 'Verizon' },
      });
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(false);

      const metrics = await collector.getCurrentMetrics();

      expect(metrics).not.toBeNull();
      expect(metrics!.wifi_connected).toBe(false);
      expect(metrics!.network_type).toBe('cellular');
      expect(metrics!.raw_data.cellular_carrier).toBe('Verizon');
      expect(metrics!.raw_data.wifi_ssid).toBeUndefined();
    });
  });

  // ── Speed calculation ─────────────────────────────────────────────────────

  describe('Speed Calculation', () => {
    it.each([
      { input: 0,    expected: 0     },
      { input: 2.5,  expected: 5.59  },
      { input: 13.4, expected: 29.98 },
    ])('converts $input m/s to ~$expected mph', async ({ input, expected }) => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      collector.updateLocation(makeLocation({ speed: input }));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.speed_mph).toBeCloseTo(expected, 1);
    });

    it('returns null speed when no location has been fed', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.speed_mph).toBeNull();
    });

    it('returns null speed when location speed field is null', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      collector.updateLocation(makeLocation({ speed: null }));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.speed_mph).toBeNull();
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('getCurrentMetrics returns null when all data services fail', async () => {
      (BluetoothStatus.state as jest.Mock).mockRejectedValue(new Error('BT error'));
      (NetInfo.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
      (DeviceInfo.getBrand as jest.Mock).mockRejectedValue(new Error('Device error'));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).toBeNull();
    });

    it('subscriber onError is called on interval collection failure', async () => {
      jest.useFakeTimers();
      const onMetricsCollected = jest.fn();
      const onError = jest.fn();

      (NetInfo.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
      (DeviceInfo.getBrand as jest.Mock).mockRejectedValue(new Error('Device error'));

      await collector.startCollection({ onMetricsCollected, onError });
      jest.advanceTimersByTime(30000);
      // Flush the Promise.all microtask chain (needs multiple ticks)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to collect metrics'));
      jest.useRealTimers();
    });
  });

  // ── getCurrentMetrics ─────────────────────────────────────────────────────

  describe('getCurrentMetrics', () => {
    it('returns metrics without starting a subscription', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      collector.updateLocation(makeLocation());
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
      expect(metrics!.device_info.brand).toBe('Apple');
    });

    it('returns null when all services reject', async () => {
      (BluetoothStatus.state as jest.Mock).mockRejectedValue(new Error('Failed'));
      (NetInfo.fetch as jest.Mock).mockRejectedValue(new Error('Failed'));
      (DeviceInfo.getBrand as jest.Mock).mockRejectedValue(new Error('Failed'));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).toBeNull();
    });
  });

  // ── Subscriber fan-out ────────────────────────────────────────────────────

  describe('Subscriber management', () => {
    it('fans out to multiple subscribers on the interval tick', async () => {
      jest.useFakeTimers();
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);

      const cb1 = { onMetricsCollected: jest.fn(), onError: jest.fn() };
      const cb2 = { onMetricsCollected: jest.fn(), onError: jest.fn() };

      await collector.startCollection(cb1, 'sub-a');
      await collector.startCollection(cb2, 'sub-b');

      jest.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(cb1.onMetricsCollected).toHaveBeenCalled();
      expect(cb2.onMetricsCollected).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('stops the interval only when the last subscriber is removed', async () => {
      jest.useFakeTimers();
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);

      const cb1 = { onMetricsCollected: jest.fn(), onError: jest.fn() };
      const cb2 = { onMetricsCollected: jest.fn(), onError: jest.fn() };

      await collector.startCollection(cb1, 'sub-a');
      await collector.startCollection(cb2, 'sub-b');

      collector.stopCollection('sub-a');
      jest.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(cb2.onMetricsCollected).toHaveBeenCalled();
      expect(cb1.onMetricsCollected).not.toHaveBeenCalled();

      collector.stopCollection('sub-b');
      cb2.onMetricsCollected.mockClear();
      jest.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(cb2.onMetricsCollected).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  // ── updateLocation ────────────────────────────────────────────────────────

  describe('updateLocation', () => {
    it('updates the location used for the next metrics snapshot', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      collector.updateLocation(makeLocation({ speed: 10, accuracy: 3 }));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.speed_mph).toBeCloseTo(10 * 2.237, 1);
      expect(metrics!.accuracy_meters).toBe(3);
    });
  });
});
