/**
 * @jest-environment node
 */

import BehavioralDataCollector, { BehavioralMetrics } from '../behavioralDataCollector';

// Mock the native modules
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

// Mock react-native-bluetooth-status with proper NativeEventEmitter handling
jest.mock('react-native-bluetooth-status', () => ({
  state: jest.fn(),
}));

// Mock React Native core
jest.mock('react-native', () => ({
  NativeEventEmitter: jest.fn(() => ({
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })),
  NativeModules: {},
  Platform: {
    OS: 'ios',
  },
}));

import Geolocation from '@react-native-community/geolocation';
import NetInfo from '@react-native-community/netinfo';
import DeviceInfo from 'react-native-device-info';
import BluetoothStatus from 'react-native-bluetooth-status';

// Helper function for async delays
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('BehavioralDataCollector', () => {
  let collector: BehavioralDataCollector;
  let mockCallbacks: {
    onMetricsCollected: jest.Mock;
    onError: jest.Mock;
  };

  beforeEach(() => {
    collector = new BehavioralDataCollector();
    mockCallbacks = {
      onMetricsCollected: jest.fn(),
      onError: jest.fn(),
    };

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    (NetInfo.fetch as jest.Mock).mockResolvedValue({
      type: 'wifi',
      isConnected: true,
      details: { ssid: 'TestNetwork' }
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

  describe('Bluetooth State Detection', () => {
    it('should return CONNECTED when Bluetooth is enabled', async () => {
      // Mock Bluetooth as enabled
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);

      await collector.startCollection(mockCallbacks);

      // Wait a bit for the async operations
      await delay(100);

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics: BehavioralMetrics = mockCallbacks.onMetricsCollected.mock.calls[0][0];
      expect(metrics.bluetooth_state).toBe('CONNECTED');
    });

    it('should return DISCONNECTED when Bluetooth is disabled', async () => {
      // Mock Bluetooth as disabled
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(false);

      await collector.startCollection(mockCallbacks);

      // Wait a bit for the async operations
      await delay(100);

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics: BehavioralMetrics = mockCallbacks.onMetricsCollected.mock.calls[0][0];
      expect(metrics.bluetooth_state).toBe('DISCONNECTED');
    });

    it('should return null when Bluetooth state check fails', async () => {
      // Mock Bluetooth state check failure
      (BluetoothStatus.state as jest.Mock).mockRejectedValue(new Error('Bluetooth access denied'));

      await collector.startCollection(mockCallbacks);

      // Wait a bit for the async operations
      await delay(100);

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics: BehavioralMetrics = mockCallbacks.onMetricsCollected.mock.calls[0][0];
      expect(metrics.bluetooth_state).toBe(null);
    });
  });

  describe('Complete Data Collection', () => {
    it('should collect all behavioral metrics successfully', async () => {
      // Setup mocks
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      (Geolocation.watchPosition as jest.Mock).mockImplementation((success) => {
        // Simulate GPS data with speed
        setTimeout(() => success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 10,
            speed: 5, // 5 m/s = ~11.18 mph
            altitude: 100,
            heading: 90
          },
          timestamp: Date.now()
        }), 50);
        return 1; // mock watch ID
      });

      await collector.startCollection(mockCallbacks);

      // Wait for location and metrics collection
      await delay(200);

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics: BehavioralMetrics = mockCallbacks.onMetricsCollected.mock.calls[0][0];

      // Verify all metrics are collected
      expect(metrics.bluetooth_state).toBe('CONNECTED');
      expect(metrics.wifi_connected).toBe(true);
      expect(metrics.network_type).toBe('wifi');
      expect(metrics.speed_mph).toBeCloseTo(11.18, 1); // 5 m/s converted to mph
      expect(metrics.accuracy_meters).toBe(10);
      expect(metrics.device_info.brand).toBe('Apple');
      expect(metrics.device_info.model).toBe('iPhone');
      expect(metrics.device_info.system_version).toBe('17.0');
      expect(metrics.device_info.app_version).toBe('1.0.0');
      expect(metrics.device_info.battery_level).toBe(0.85);
      expect(metrics.raw_data.wifi_ssid).toBe('TestNetwork');
      expect(typeof metrics.raw_data.timestamp).toBe('string');
    });

    it('should handle cellular network data', async () => {
      // Mock cellular network
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        type: 'cellular',
        isConnected: true,
        details: { carrier: 'Verizon' }
      });
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(false);

      await collector.startCollection(mockCallbacks);
      await delay(100);

      expect(mockCallbacks.onMetricsCollected).toHaveBeenCalled();
      const metrics: BehavioralMetrics = mockCallbacks.onMetricsCollected.mock.calls[0][0];

      expect(metrics.wifi_connected).toBe(false);
      expect(metrics.network_type).toBe('cellular');
      expect(metrics.raw_data.cellular_carrier).toBe('Verizon');
      expect(metrics.raw_data.wifi_ssid).toBeUndefined();
    });
  });

  describe('Speed Calculation', () => {
    it('should convert GPS speed from m/s to mph correctly', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);
      
      // Mock GPS with different speeds
      const testSpeeds = [
        { input: 0, expected: 0 },      // 0 m/s = 0 mph
        { input: 2.5, expected: 5.59 }, // 2.5 m/s ≈ 5.59 mph
        { input: 13.4, expected: 30 },  // 13.4 m/s ≈ 30 mph
        { input: null, expected: null }  // No speed data
      ];

      for (const testSpeed of testSpeeds) {
        (Geolocation.watchPosition as jest.Mock).mockImplementation((success) => {
          setTimeout(() => success({
            coords: {
              latitude: 37.7749,
              longitude: -122.4194,
              accuracy: 10,
              speed: testSpeed.input,
              altitude: 100,
              heading: 90
            },
            timestamp: Date.now()
          }), 10);
          return 1;
        });

        await collector.startCollection(mockCallbacks);
        await delay(100);

        const metrics: BehavioralMetrics = mockCallbacks.onMetricsCollected.mock.calls[0][0];
        
        if (testSpeed.expected === null) {
          expect(metrics.speed_mph).toBeNull();
        } else {
          expect(metrics.speed_mph).toBeCloseTo(testSpeed.expected, 1);
        }

        collector.stopCollection();
        jest.clearAllMocks();
      }
    });
  });

  describe('Error Handling', () => {
    it('should call onError when data collection fails', async () => {
      // Mock all services to fail
      (BluetoothStatus.state as jest.Mock).mockRejectedValue(new Error('Bluetooth error'));
      (NetInfo.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
      (DeviceInfo.getBrand as jest.Mock).mockRejectedValue(new Error('Device error'));

      await collector.startCollection(mockCallbacks);
      await delay(100);

      expect(mockCallbacks.onError).toHaveBeenCalled();
      expect(mockCallbacks.onError.mock.calls[0][0]).toContain('Failed to collect metrics');
    });

    it('should handle location tracking errors', async () => {
      (Geolocation.watchPosition as jest.Mock).mockImplementation((success, error) => {
        setTimeout(() => error({ message: 'Location access denied' }), 10);
        return 1;
      });

      await collector.startCollection(mockCallbacks);
      await delay(100);

      expect(mockCallbacks.onError).toHaveBeenCalled();
      expect(mockCallbacks.onError.mock.calls[0][0]).toContain('Location tracking error');
    });
  });

  describe('getCurrentMetrics', () => {
    it('should return metrics without starting collection', async () => {
      (BluetoothStatus.state as jest.Mock).mockResolvedValue(true);

      const metrics = await collector.getCurrentMetrics();

      expect(metrics).not.toBeNull();
      expect(metrics?.bluetooth_state).toBe('CONNECTED');
      expect(metrics?.device_info.brand).toBe('Apple');
    });

    it('should return null when getCurrentMetrics fails', async () => {
      // Make all services fail
      (BluetoothStatus.state as jest.Mock).mockRejectedValue(new Error('Failed'));
      (NetInfo.fetch as jest.Mock).mockRejectedValue(new Error('Failed'));

      const metrics = await collector.getCurrentMetrics();
      expect(metrics).toBeNull();
    });
  });
});
