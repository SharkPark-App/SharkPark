/**
 * @jest-environment node
 *
 * Tests for BehavioralDataCollector.
 *
 * The service no longer starts its own Geolocation.watchPosition — location is
 * fed externally via updateLocation().  Metrics are emitted immediately when
 * updateLocation() or updateActivity() is called (event-driven, no polling).
 * getCurrentMetrics() can also be called directly for a snapshot.
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
  __esModule: true,
  default: {
    state: jest.fn(),
  },
  state: jest.fn(),
}));

jest.mock('react-native', () => ({
  NativeEventEmitter: jest.fn(() => ({
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })),
  NativeModules: {
    RNBluetoothManager: {},
  },
  Platform: { OS: 'ios' },
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import NetInfo from '@react-native-community/netinfo';
import DeviceInfo from 'react-native-device-info';
import BluetoothStatus from 'react-native-bluetooth-status';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Flush all pending microtasks (resolved promises) in the queue. */
const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve));

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
  //
  // NOTE: BluetoothStatus.state() is mocked at the module boundary because
  // react-native-bluetooth-status requires a native bridge unavailable in a
  // Node test environment.  The actual getBluetoothState() branching logic
  // (boolean, object variants, null/undefined, error) runs for real — only
  // the underlying native call is replaced.

  describe('Bluetooth State Detection', () => {
    // ── Boolean responses (primary path on iOS/Android) ───────────────────

    it('returns CONNECTED when BluetoothStatus.state() resolves true', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
    });

    it('returns DISCONNECTED when BluetoothStatus.state() resolves false', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(false);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('DISCONNECTED');
    });

    // ── Null / undefined responses ────────────────────────────────────────

    it('returns null bluetooth_state when BluetoothStatus.state() resolves null', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(null);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBeNull();
    });

    it('returns null bluetooth_state when BluetoothStatus.state() resolves undefined', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(undefined);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBeNull();
    });

    // ── Object responses (some Android implementations return an object) ──

    it('returns CONNECTED when state object has { state: true }', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue({ state: true });
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
    });

    it('returns DISCONNECTED when state object has { state: false }', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue({ state: false });
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('DISCONNECTED');
    });

    it('returns CONNECTED when state object has { enabled: true }', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue({ enabled: true });
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
    });

    it('returns DISCONNECTED when state object has { enabled: false }', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue({ enabled: false });
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('DISCONNECTED');
    });

    it('returns CONNECTED when state object has { state: "on" }', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue({ state: 'on' });
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
    });

    it('returns CONNECTED when state object has { state: "enabled" }', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue({ state: 'enabled' });
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
    });

    it('returns DISCONNECTED when state object has { state: "off" }', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue({ state: 'off' });
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('DISCONNECTED');
    });

    // ── Unexpected / unrecognised format ──────────────────────────────────

    it('returns null bluetooth_state for an unrecognised object format', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue({ unknown: 'value' });
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBeNull();
    });

    // ── Error / unavailable ───────────────────────────────────────────────

    it('returns null bluetooth_state when BluetoothStatus.state() throws', async () => {
      (BluetoothStatus.state as jest.Mock).mockRejectedValue(new Error('Bluetooth access denied'));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBeNull();
    });

    it('returns null bluetooth_state when BluetoothStatus.state is not a function', async () => {
      // Simulate a platform where the native module exposes the object but
      // not the state() method (e.g. older library version).
      const original = BluetoothStatus.state;
      (BluetoothStatus as unknown as Record<string, unknown>).state = undefined;

      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBeNull();

      // Restore
      (BluetoothStatus as unknown as Record<string, unknown>).state = original;
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

    it('subscriber onError is called on collection failure', async () => {
      const onMetricsCollected = jest.fn();
      const onError = jest.fn();

      (NetInfo.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
      (DeviceInfo.getBrand as jest.Mock).mockRejectedValue(new Error('Device error'));

      await collector.startCollection({ onMetricsCollected, onError });
      collector.updateLocation(makeLocation());
      await flushPromises();

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to collect metrics'));
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
    it('fans out to multiple subscribers on location update', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);

      const cb1 = { onMetricsCollected: jest.fn(), onError: jest.fn() };
      const cb2 = { onMetricsCollected: jest.fn(), onError: jest.fn() };

      await collector.startCollection(cb1, 'sub-a');
      await collector.startCollection(cb2, 'sub-b');

      collector.updateLocation(makeLocation());
      await flushPromises();

      expect(cb1.onMetricsCollected).toHaveBeenCalled();
      expect(cb2.onMetricsCollected).toHaveBeenCalled();
    });

    it('stops delivering metrics when a subscriber is removed', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);

      const cb1 = { onMetricsCollected: jest.fn(), onError: jest.fn() };
      const cb2 = { onMetricsCollected: jest.fn(), onError: jest.fn() };

      await collector.startCollection(cb1, 'sub-a');
      await collector.startCollection(cb2, 'sub-b');

      collector.stopCollection('sub-a');
      collector.updateLocation(makeLocation());
      await flushPromises();

      expect(cb2.onMetricsCollected).toHaveBeenCalled();
      expect(cb1.onMetricsCollected).not.toHaveBeenCalled();

      collector.stopCollection('sub-b');
      cb2.onMetricsCollected.mockClear();
      collector.updateLocation(makeLocation({ speed: 5 }));
      await flushPromises();

      expect(cb2.onMetricsCollected).not.toHaveBeenCalled();
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
