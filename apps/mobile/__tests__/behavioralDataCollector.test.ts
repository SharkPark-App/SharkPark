import BehavioralDataCollector, { BehavioralMetrics } from '../src/services/behavioralDataCollector';

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
jest.mock('../src/services/carBluetooth', () => ({
  __esModule: true,
  default: {
    isAvailable: true,
    isConnected: jest.fn().mockResolvedValue(false),
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

import NetInfo from '@react-native-community/netinfo';
import DeviceInfo from 'react-native-device-info';

/** Flush all pending microtasks (resolved promises) in the queue. */
const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve));

describe('BehavioralDataCollector', () => {
  let collector: BehavioralDataCollector;

  const mockNetInfo = NetInfo as jest.Mocked<typeof NetInfo>;
  const mockDeviceInfo = DeviceInfo as jest.Mocked<typeof DeviceInfo>;

  beforeEach(() => {
    jest.clearAllMocks();
    collector = new BehavioralDataCollector();

    // Setup default mock implementations
    mockNetInfo.fetch.mockResolvedValue({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {
        ssid: 'TestWiFi',
      },
    } as never);

    (mockDeviceInfo.getBrand as jest.Mock).mockResolvedValue('Apple');
    (mockDeviceInfo.getModel as jest.Mock).mockResolvedValue('iPhone');
    (mockDeviceInfo.getSystemVersion as jest.Mock).mockResolvedValue('15.0');
    (mockDeviceInfo.getVersion as jest.Mock).mockResolvedValue('1.0.0');
    (mockDeviceInfo.getBatteryLevel as jest.Mock).mockResolvedValue(0.85);

  });

  afterEach(() => {
    // Ensure collection is stopped after each test to prevent Jest hanging
    if (collector) {
      collector.stopCollection();
    }
  });

  it('should create an instance of BehavioralDataCollector', () => {
    expect(collector).toBeDefined();
    expect(collector).toBeInstanceOf(BehavioralDataCollector);
  });

  describe('startCollection', () => {
    it('should start collecting behavioral data', async () => {
      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);

      // Service no longer manages its own watchPosition — location is fed externally
      expect(mockCallbacks.onError).not.toHaveBeenCalled();

      collector.stopCollection();
    });

    it('should collect metrics with valid data', async () => {
      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);

      // Metrics are now pushed when updateLocation is called (event-driven)
      collector.updateLocation({
        latitude: 33.7838, longitude: -118.1134,
        altitude: 50, accuracy: 5, speed: 2.5, heading: 180,
      });
      await flushPromises();

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics = mockCallbacks.onMetricsCollected.mock.calls[0][0] as BehavioralMetrics;

      expect(metrics).toHaveProperty('speed_mph');
      expect(metrics).toHaveProperty('accuracy_meters');
      expect(metrics).toHaveProperty('bluetooth_state');
      expect(metrics).toHaveProperty('wifi_connected');
      expect(metrics).toHaveProperty('device_info');
      expect(metrics).toHaveProperty('raw_data');

      collector.stopCollection();
    });

    it('should convert speed from m/s to mph correctly', async () => {
      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);

      collector.updateLocation({
        latitude: 33.7838, longitude: -118.1134,
        altitude: 50, accuracy: 5, speed: 2.5, heading: 180,
      });
      await flushPromises();

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics = mockCallbacks.onMetricsCollected.mock.calls[0][0] as BehavioralMetrics;

      // 2.5 m/s should be approximately 5.59 mph (2.5 * 2.237 = 5.5925)
      expect(metrics.speed_mph).toBeCloseTo(5.59, 1);

      collector.stopCollection();
    });

    it('should handle wifi connection status', async () => {
      mockNetInfo.fetch.mockResolvedValue({
        type: 'wifi',
        isConnected: true,
        isInternetReachable: true,
        details: { ssid: 'TestWiFi' },
      } as never);

      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);

      collector.updateLocation({
        latitude: 33.7838, longitude: -118.1134,
        altitude: 50, accuracy: 5, speed: 2.5, heading: 180,
      });
      await flushPromises();

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics = mockCallbacks.onMetricsCollected.mock.calls[0][0] as BehavioralMetrics;
      expect(metrics.wifi_connected).toBe(true);
      expect(metrics.network_type).toBe('wifi');

      collector.stopCollection();
    });

    it('should handle cellular connection', async () => {
      mockNetInfo.fetch.mockResolvedValue({
        type: 'cellular',
        isConnected: true,
        isInternetReachable: true,
        details: { carrier: 'Verizon' },
      } as never);

      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);

      collector.updateLocation({
        latitude: 33.7838, longitude: -118.1134,
        altitude: 50, accuracy: 5, speed: 2.5, heading: 180,
      });
      await flushPromises();

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics = mockCallbacks.onMetricsCollected.mock.calls[0][0] as BehavioralMetrics;
      expect(metrics.wifi_connected).toBe(false);
      expect(metrics.network_type).toBe('cellular');

      collector.stopCollection();
    });
  });

  describe('stopCollection', () => {
    it('should stop collecting data and unregister subscriber', async () => {
      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);
      collector.stopCollection();

      // After stopping, updateLocation should NOT fire the callback
      collector.updateLocation({
        latitude: 33.7838, longitude: -118.1134,
        altitude: 50, accuracy: 5, speed: 2.5, heading: 180,
      });
      await flushPromises();

      expect(mockCallbacks.onMetricsCollected).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentMetrics', () => {

    it('should return current metrics snapshot when collection is active', async () => {
      // Reset DeviceInfo mocks to working state for this test
      (mockDeviceInfo.getBrand as jest.Mock).mockResolvedValue('Apple');
      (mockDeviceInfo.getModel as jest.Mock).mockResolvedValue('iPhone');
      (mockDeviceInfo.getSystemVersion as jest.Mock).mockResolvedValue('15.0');
      (mockDeviceInfo.getVersion as jest.Mock).mockResolvedValue('1.0.0');
      (mockDeviceInfo.getBatteryLevel as jest.Mock).mockResolvedValue(0.85);
      
      // Start collection first to enable the getCurrentMetrics functionality
      collector.startCollection({
        onMetricsCollected: (metrics: BehavioralMetrics) => {
          expect(metrics).toBeDefined();
          expect(metrics.device_info).toBeDefined();
          expect(metrics.device_info.brand).toBe('Apple');
          expect(metrics.device_info.model).toBe('iPhone');
          expect(metrics.network_type).toBe('wifi');
          expect(metrics.wifi_connected).toBe(true);
        },
        onError: (error: string) => {
          throw new Error(`Should not have error: ${error}`);
        }
      });

      // getCurrentMetrics should return metrics immediately (doesn't use interval)
      const currentMetrics = await collector.getCurrentMetrics();
      expect(currentMetrics).not.toBeNull();
      expect(currentMetrics?.device_info.brand).toBe('Apple');
      
      collector.stopCollection();
    });

    it('should handle errors gracefully when collection fails', async () => {
      (mockDeviceInfo.getBrand as jest.Mock).mockRejectedValue(new Error('Device info error'));
      
      collector.startCollection({
        onMetricsCollected: () => {
          throw new Error('Should not receive metrics');
        },
        onError: (error: string) => {
          expect(error).toContain('Device info error');
        }
      });

      // getCurrentMetrics should return null when there's an error
      const currentMetrics = await collector.getCurrentMetrics();
      expect(currentMetrics).toBeNull();
      
      collector.stopCollection();
    });
  });

  describe('error handling', () => {
    it('should handle network fetch errors on location update', async () => {
      mockNetInfo.fetch.mockRejectedValue(new Error('Network error'));

      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);

      // Trigger metrics push via location update
      collector.updateLocation({
        latitude: 33.7838, longitude: -118.1134,
        altitude: 50, accuracy: 5, speed: 2.5, heading: 180,
      });
      await flushPromises();

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to collect metrics')
      );
    });
  });
});
