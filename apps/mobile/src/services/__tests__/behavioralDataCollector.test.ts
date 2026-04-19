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

// Mock our carBluetooth native bridge module
const mockIsConnected = jest.fn().mockResolvedValue(false);
jest.mock('../carBluetooth', () => ({
  __esModule: true,
  default: {
    isAvailable: true,
    isConnected: (...args: unknown[]) => mockIsConnected(...args),
    onConnect: jest.fn(() => ({ remove: jest.fn() })),
    onDisconnect: jest.fn(() => ({ remove: jest.fn() })),
  },
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
  battery_level: 0.85,
  battery_charging: false,
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

  // ── Car Bluetooth state ────────────────────────────────────────────────────
  //
  // The CarBluetoothModule native module is mocked — carBluetooth.isConnected()
  // returns a promise resolving to a boolean.  The collector also supports
  // event-driven updates via updateCarBluetoothState().

  describe('Car Bluetooth State Detection', () => {
    it('returns CONNECTED when car Bluetooth is connected (polled)', async () => {
      mockIsConnected.mockResolvedValue(true);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
    });

    it('returns DISCONNECTED when car Bluetooth is not connected (polled)', async () => {
      mockIsConnected.mockResolvedValue(false);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('DISCONNECTED');
    });

    it('returns null bluetooth_state when isConnected throws', async () => {
      mockIsConnected.mockRejectedValue(new Error('Not available'));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBeNull();
    });

    it('returns CONNECTED when updateCarBluetoothState(true) is called', async () => {
      mockIsConnected.mockResolvedValue(false); // poll would say false
      collector.updateCarBluetoothState(true);   // but event says true
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
    });

    it('returns DISCONNECTED when updateCarBluetoothState(false) is called', async () => {
      mockIsConnected.mockResolvedValue(true); // poll would say true
      collector.updateCarBluetoothState(false); // but event says false
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.bluetooth_state).toBe('DISCONNECTED');
    });

    it('event-driven state pushes metrics to subscribers', async () => {
      const cb = { onMetricsCollected: jest.fn(), onError: jest.fn() };
      await collector.startCollection(cb, 'bt-test');

      collector.updateCarBluetoothState(true);
      await flushPromises();

      expect(cb.onMetricsCollected).toHaveBeenCalled();
      const metrics = cb.onMetricsCollected.mock.calls[0][0];
      expect(metrics.bluetooth_state).toBe('CONNECTED');

      collector.stopCollection('bt-test');
    });
  });

  // ── Complete metrics shape ────────────────────────────────────────────────

  describe('Complete Data Collection', () => {
    it('collects all behavioral metrics in a single getCurrentMetrics call', async () => {
      mockIsConnected.mockResolvedValue(true);
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
      mockIsConnected.mockResolvedValue(false);

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
      mockIsConnected.mockResolvedValue(true);
      collector.updateLocation(makeLocation({ speed: input }));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.speed_mph).toBeCloseTo(expected, 1);
    });

    it('returns null speed when no location has been fed', async () => {
      mockIsConnected.mockResolvedValue(true);
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.speed_mph).toBeNull();
    });

    it('returns null speed when location speed field is null', async () => {
      mockIsConnected.mockResolvedValue(true);
      collector.updateLocation(makeLocation({ speed: null }));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.speed_mph).toBeNull();
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('getCurrentMetrics returns null when all data services fail', async () => {
      mockIsConnected.mockRejectedValue(new Error('BT error'));
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
      mockIsConnected.mockResolvedValue(true);
      collector.updateLocation(makeLocation());
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics!.bluetooth_state).toBe('CONNECTED');
      expect(metrics!.device_info.brand).toBe('Apple');
    });

    it('returns null when all services reject', async () => {
      mockIsConnected.mockRejectedValue(new Error('Failed'));
      (NetInfo.fetch as jest.Mock).mockRejectedValue(new Error('Failed'));
      (DeviceInfo.getBrand as jest.Mock).mockRejectedValue(new Error('Failed'));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics).toBeNull();
    });
  });

  // ── Subscriber fan-out ────────────────────────────────────────────────────

  describe('Subscriber management', () => {
    it('fans out to multiple subscribers on location update', async () => {
      mockIsConnected.mockResolvedValue(true);

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
      mockIsConnected.mockResolvedValue(true);

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
      mockIsConnected.mockResolvedValue(true);
      collector.updateLocation(makeLocation({ speed: 10, accuracy: 3 }));
      const metrics = await collector.getCurrentMetrics();
      expect(metrics!.speed_mph).toBeCloseTo(10 * 2.237, 1);
      expect(metrics!.accuracy_meters).toBe(3);
    });
  });
});
