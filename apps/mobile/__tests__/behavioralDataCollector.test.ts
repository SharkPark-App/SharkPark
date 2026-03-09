import BehavioralDataCollector, { BehavioralMetrics } from '../src/services/behavioralDataCollector';

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
}));

jest.mock('@react-native-community/geolocation', () => ({
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
  getCurrentPosition: jest.fn(),
  setRNConfiguration: jest.fn(),
}));

jest.mock('react-native-device-info', () => ({
  getBrand: jest.fn(),
  getModel: jest.fn(),
  getSystemVersion: jest.fn(),
  getVersion: jest.fn(),
  getBatteryLevel: jest.fn(),
}));

import NetInfo from '@react-native-community/netinfo';
import Geolocation from '@react-native-community/geolocation';
import DeviceInfo from 'react-native-device-info';

describe('BehavioralDataCollector', () => {
  let collector: BehavioralDataCollector;

  const mockNetInfo = NetInfo as jest.Mocked<typeof NetInfo>;
  const mockGeolocation = Geolocation as jest.Mocked<typeof Geolocation>;
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

    mockGeolocation.watchPosition.mockImplementation((success) => {
      // Immediately call success callback with location data  
      success({
        coords: {
          latitude: 33.7838,
          longitude: -118.1134,
          altitude: 50,
          accuracy: 5,
          speed: 2.5, // 2.5 m/s - this is the key field for speed conversion test
          heading: 180,
          altitudeAccuracy: 3,
        },
        timestamp: Date.now(),
      });
      return 1; // mock watch ID
    });
    
    // Use fake timers to control intervals
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Ensure collection is stopped after each test to prevent Jest hanging
    if (collector) {
      collector.stopCollection();
    }
    
    // Reset timers
    jest.useRealTimers();
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

      expect(mockGeolocation.watchPosition).toHaveBeenCalled();
      expect(mockCallbacks.onError).not.toHaveBeenCalled();
      
      collector.stopCollection();
    });

    it('should collect metrics with valid data', async () => {
      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);

      // Fast-forward time to trigger location update and metrics collection
      jest.advanceTimersByTime(200); // Location callback
      jest.advanceTimersByTime(30000); // Metrics collection interval

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

      // Fast-forward time to trigger metrics collection (location is immediate now)
      jest.advanceTimersByTime(30000); // Metrics collection interval

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
        details: {
          ssid: 'TestWiFi',
        },
      } as never);

      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);
      
      // Fast-forward time to trigger metrics collection
      jest.advanceTimersByTime(200); // Location callback
      jest.advanceTimersByTime(30000); // Metrics collection interval

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
        details: {
          carrier: 'Verizon',
        },
      } as never);

      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);
      
      // Fast-forward time to trigger metrics collection
      jest.advanceTimersByTime(200); // Location callback
      jest.advanceTimersByTime(30000); // Metrics collection interval

      const metrics = mockCallbacks.onMetricsCollected.mock.calls[0][0] as BehavioralMetrics;
      expect(metrics.wifi_connected).toBe(false);
      expect(metrics.network_type).toBe('cellular');
      
      collector.stopCollection();
    });
  });

  describe('stopCollection', () => {
    it('should stop collecting data and clear resources', async () => {
      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);
      collector.stopCollection();

      expect(mockGeolocation.clearWatch).toHaveBeenCalledWith(1);
    });
  });

  describe('getCurrentMetrics', () => {
    beforeEach(() => {
      // Use real timers for getCurrentMetrics tests since they call collectAndSendMetrics directly
      jest.useRealTimers();
    });

    afterEach(() => {
      // Switch back to fake timers for other tests
      jest.useFakeTimers();
    });

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
    it('should handle location errors', async () => {
      mockGeolocation.watchPosition.mockImplementation((success, error) => {
        // Immediately call error callback
        error?.({
          code: 1,
          message: 'Location access denied',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
        return 1;
      });

      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.stringContaining('Location tracking error')
      );
    });

    it('should handle network fetch errors', async () => {
      mockNetInfo.fetch.mockRejectedValue(new Error('Network error'));

      const mockCallbacks = {
        onMetricsCollected: jest.fn(),
        onError: jest.fn(),
      };

      await collector.startCollection(mockCallbacks);
      
      // Fast-forward to trigger metrics collection with network error
      jest.advanceTimersByTime(30000);

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to collect metrics')
      );
    });
  });
});
