import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { ParkingValidationDebug } from '../src/components/ParkingValidationDebug';
import { useBehavioralDataCollection } from '../src/services/behavioralDataCollector';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn().mockResolvedValue({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
    }),
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

jest.mock('@react-native-community/geolocation', () => ({
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
  getCurrentPosition: jest.fn(),
  setRNConfiguration: jest.fn(),
}));

jest.mock('react-native-device-info', () => ({
  getBrand: jest.fn().mockResolvedValue('Apple'),
  getModel: jest.fn().mockResolvedValue('iPhone'),
  getSystemVersion: jest.fn().mockResolvedValue('15.0'),
  getVersion: jest.fn().mockResolvedValue('1.0.0'),
  getBatteryLevel: jest.fn().mockResolvedValue(0.85),
  getBluetoothLeState: jest.fn().mockResolvedValue('on'),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiSet: jest.fn(),
  multiRemove: jest.fn(),
}));

// Mock services
jest.mock('../src/services/parkingValidationService', () => ({
  __esModule: true,
  default: {
    startSession: jest.fn(),
    endSession: jest.fn(),
    recordBehavioralEvent: jest.fn(),
  },
}));

jest.mock('../src/services/locationService', () => ({
  __esModule: true,
  default: {
    triggerTestGeofenceEvent: jest.fn(),
  },
}));

// Mock Enhanced Geofencing context
jest.mock('../src/context/EnhancedGeofencingProvider', () => ({
  useEnhancedGeofencing: jest.fn().mockReturnValue({
    currentLotId: null,
    currentValidationStatus: null,
    debugInfo: {
      activeSessions: 0,
      isCollectingData: false,
    },
  }),
}));

// Mock BehavioralDataCollector class and hook
jest.mock('../src/services/behavioralDataCollector', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    startCollection: jest.fn(),
    stopCollection: jest.fn(),
    getCurrentMetrics: jest.fn(),
  })),
  useBehavioralDataCollection: jest.fn(),
}));

// Mock console to reduce test noise
jest.spyOn(console, 'log').mockImplementation();
jest.spyOn(console, 'warn').mockImplementation();
jest.spyOn(console, 'error').mockImplementation();

describe('ParkingValidationDebug Component', () => {
  const mockGetCurrentMetrics = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    (useBehavioralDataCollection as jest.Mock).mockReturnValue({
      getCurrentMetrics: mockGetCurrentMetrics,
    });

    mockGetCurrentMetrics.mockResolvedValue({
      speed_mph: 25.5,
      accuracy_meters: 5,
      bluetooth_state: 'CONNECTED',
      wifi_connected: true,
      network_type: 'wifi',
      device_info: {
        brand: 'Apple',
        model: 'iPhone 14',
        system_version: '16.4',
        app_version: '1.0.0',
        battery_level: 0.85,
      },
      raw_data: {
        timestamp: '2026-03-09T12:00:00.000Z',
        location_accuracy: 5,
        altitude: 100,
        heading: 90,
        wifi_ssid: 'TestWiFi',
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Component Rendering', () => {
    it('should render debug interface with initial state', async () => {
      const { getByText } = render(<ParkingValidationDebug />);
      
      expect(getByText('Parking Validation Debug')).toBeTruthy();
      expect(getByText('Test Controls')).toBeTruthy();
      expect(getByText('ENTER Lot')).toBeTruthy();
      expect(getByText('EXIT Lot')).toBeTruthy();
      
      expect(getByText('Loading...')).toBeTruthy();
    });

    it('should display sensor metrics when available', async () => {
      const { getByText } = render(<ParkingValidationDebug />);
      
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      await waitFor(() => {
        expect(getByText('25.5 mph')).toBeTruthy();
        expect(getByText('5m')).toBeTruthy();
        expect(getByText('Connected')).toBeTruthy();
        expect(getByText('wifi')).toBeTruthy();
      });
    });

    it('should handle refresh sensors button', async () => {
      mockGetCurrentMetrics.mockResolvedValue({
        speed_mph: 0,
        accuracy_meters: 5,
        bluetooth_state: 'CONNECTED',
        wifi_connected: true,
        network_type: 'wifi',
        device_info: {
          brand: 'Apple',
          model: 'iPhone',
          system_version: '15.0',
          app_version: '1.0.0',
        },
        raw_data: {
          timestamp: '2026-03-09T12:00:00.000Z',
          location_accuracy: 5,
          altitude: null,
          heading: null,
        },
      });
      
      const { getByText } = render(<ParkingValidationDebug />);
      
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      await waitFor(() => {
        expect(getByText('Refresh Sensors')).toBeTruthy();
      });
      
      await act(async () => {
        fireEvent.press(getByText('Refresh Sensors'));
      });
      
      expect(mockGetCurrentMetrics).toHaveBeenCalled();
    });

    it('should handle loading state during metrics fetch', async () => {
      mockGetCurrentMetrics
        .mockResolvedValueOnce({
          speed_mph: 0,
          accuracy_meters: 5,
          bluetooth_state: null,
          wifi_connected: false,
          network_type: 'none',
          device_info: {
            brand: 'Apple',
            model: 'iPhone',
            system_version: '15.0',
            app_version: '1.0.0',
          },
          raw_data: {
            timestamp: '2026-03-09T12:00:00.000Z',
            location_accuracy: 5,
            altitude: null,
            heading: null,
          },
        })
        .mockReturnValue(new Promise(() => {})); 

      const { getByText } = render(<ParkingValidationDebug />);

      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      await waitFor(() => {
        expect(getByText('Refresh Sensors')).toBeTruthy();
      });
      
      await act(async () => {
        fireEvent.press(getByText('Refresh Sensors'));
      });
      
      expect(getByText('Loading...')).toBeTruthy();
    });

    it('should handle metrics fetch errors', async () => {
      mockGetCurrentMetrics.mockRejectedValue(new Error('Failed to fetch'));
      
      const { getByText } = render(<ParkingValidationDebug />);
      
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      expect(getByText('No sensor data available')).toBeTruthy();
    });
  });

  describe('Real-time Data Display', () => {
    it('should display speed correctly', async () => {
      const { getByText } = render(<ParkingValidationDebug />);
      
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      await waitFor(() => {
        expect(getByText('25.5 mph')).toBeTruthy();
      });
    });

    it('should display network status correctly', async () => {
      mockGetCurrentMetrics.mockResolvedValue({
        speed_mph: 0,
        accuracy_meters: 10,
        bluetooth_state: 'DISCONNECTED',
        wifi_connected: false,
        network_type: 'cellular',
        device_info: {
          brand: 'Samsung',
          model: 'Galaxy S23',
          system_version: '13.0',
          app_version: '1.0.0',
          battery_level: 0.65,
        },
        raw_data: {
          timestamp: '2026-03-09T12:00:00.000Z',
          location_accuracy: 10,
          altitude: null,
          heading: null,
          cellular_carrier: 'Verizon',
        },
      });
      
      const { getByText } = render(<ParkingValidationDebug />);
      
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      await waitFor(() => {
        expect(getByText('Disconnected')).toBeTruthy();
        expect(getByText('cellular')).toBeTruthy();
      });
    });

    it('should handle missing optional data', async () => {
      mockGetCurrentMetrics.mockResolvedValue({
        speed_mph: null,
        accuracy_meters: null,
        bluetooth_state: null,
        wifi_connected: false,
        network_type: null,
        device_info: {
          brand: 'Apple',
          model: 'iPhone',
          system_version: '15.0',
          app_version: '1.0.0',
          battery_level: undefined,
        },
        raw_data: {
          timestamp: '2026-03-09T12:00:00.000Z',
          location_accuracy: null,
          altitude: null,
          heading: null,
        },
      });
      
      const { getByText, getAllByText } = render(<ParkingValidationDebug />);
      
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      await waitFor(() => {
        expect(getByText('No GPS')).toBeTruthy();
        expect(getAllByText('Unknown').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Test Control Buttons', () => {
    it('should render all test control buttons', async () => {
      mockGetCurrentMetrics.mockResolvedValue({
        speed_mph: 0,
        accuracy_meters: 5,
        bluetooth_state: null,
        wifi_connected: false,
        network_type: 'none',
        device_info: {
          brand: 'Apple',
          model: 'iPhone',
          system_version: '15.0',
          app_version: '1.0.0',
        },
        raw_data: {
          timestamp: '2026-03-09T12:00:00.000Z',
          location_accuracy: 5,
          altitude: null,
          heading: null,
        },
      });
      
      const { getByText } = render(<ParkingValidationDebug />);
      
      // Wait for initial load
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      expect(getByText('ENTER Lot')).toBeTruthy();
      expect(getByText('EXIT Lot')).toBeTruthy();
      expect(getByText('Stationary')).toBeTruthy();
      expect(getByText('Walking')).toBeTruthy();
      expect(getByText('Driving')).toBeTruthy();
      expect(getByText('Bluetooth')).toBeTruthy();
      
      await waitFor(() => {
        expect(getByText('Refresh Sensors')).toBeTruthy();
      });
    });

    it('should handle geofence event buttons', () => {
      const { getByText } = render(<ParkingValidationDebug />);
      
      // Test ENTER button (should not throw error)
      fireEvent.press(getByText('ENTER Lot'));
      
      // Test EXIT button (should not throw error)
      fireEvent.press(getByText('EXIT Lot'));
      
      // Expect no errors - buttons should work
      expect(getByText('ENTER Lot')).toBeTruthy();
      expect(getByText('EXIT Lot')).toBeTruthy();
    });

    it('should handle behavioral event buttons', () => {
      const { getByText } = render(<ParkingValidationDebug />);
      
      // Test all behavioral event buttons
      fireEvent.press(getByText('Stationary'));
      fireEvent.press(getByText('Walking'));
      fireEvent.press(getByText('Driving'));
      fireEvent.press(getByText('Bluetooth'));
      
      // Buttons should still be present after press
      expect(getByText('Stationary')).toBeTruthy();
      expect(getByText('Walking')).toBeTruthy();
      expect(getByText('Driving')).toBeTruthy();
      expect(getByText('Bluetooth')).toBeTruthy();
    });
  });

  describe('Performance and Updates', () => {
    it('should handle periodic updates', async () => {
      render(<ParkingValidationDebug />);
      
      // Fast-forward through a few intervals
      await act(async () => {
        jest.advanceTimersByTime(3000); // 3 seconds - should trigger update
      });
      
      // Should have called getCurrentMetrics multiple times
      expect(mockGetCurrentMetrics).toHaveBeenCalledTimes(2); // Initial + interval
      
      await act(async () => {
        jest.advanceTimersByTime(3000); // Another 3 seconds
      });
      
      expect(mockGetCurrentMetrics).toHaveBeenCalledTimes(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large speed values', async () => {
      mockGetCurrentMetrics.mockResolvedValue({
        speed_mph: 999.99,
        accuracy_meters: 1,
        bluetooth_state: 'CONNECTED',
        wifi_connected: true,
        network_type: 'wifi',
        device_info: {
          brand: 'Apple',
          model: 'iPhone',
          system_version: '15.0',
          app_version: '1.0.0',
        },
        raw_data: {
          timestamp: '2026-03-09T12:00:00.000Z',
          location_accuracy: 1,
          altitude: null,
          heading: null,
        },
      });
      
      const { getByText } = render(<ParkingValidationDebug />);
      
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      await waitFor(() => {
        expect(getByText('999.99 mph')).toBeTruthy();
      });
    });

    it('should handle malformed timestamps', async () => {
      mockGetCurrentMetrics.mockResolvedValue({
        speed_mph: 0,
        accuracy_meters: 5,
        bluetooth_state: null,
        wifi_connected: false,
        network_type: 'none',
        device_info: {
          brand: 'Unknown',
          model: 'Unknown',
          system_version: 'Unknown',
          app_version: '1.0.0',
        },
        raw_data: {
          timestamp: 'invalid-timestamp',
          location_accuracy: 5,
          altitude: null,
          heading: null,
        },
      });
      
      const { getByText } = render(<ParkingValidationDebug />);
      
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      
      // Should not crash and handle gracefully
      expect(getByText('Test Controls')).toBeTruthy();
    });
  });
});
