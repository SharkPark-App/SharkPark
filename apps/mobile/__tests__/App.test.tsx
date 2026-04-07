/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn().mockResolvedValue({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
    }),
    addEventListener: jest.fn(() => jest.fn()),
    useNetInfo: jest.fn(() => ({
      type: 'wifi',
      isConnected: true,
    })),
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

jest.mock('../src/services/behavioralDataCollector', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    startCollection: jest.fn(),
    stopCollection: jest.fn(),
    getCurrentMetrics: jest.fn(),
  })),
}));

// Mock the auth context
jest.mock('../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mock EnhancedGeofencingProvider — the provider App.tsx actually mounts
jest.mock('../src/context/EnhancedGeofencingProvider', () => ({
  EnhancedGeofencingProvider: ({ children }: { children: React.ReactNode }) => children,
  useEnhancedGeofencing: () => ({
    isGeofencingActive: false,
    currentLotId: null,
    currentValidationStatus: null,
    currentLeaveIntent: null,
    debugInfo: { activeSessions: 0, isCollectingData: false, activeLeaveMonitoring: 0, isMonitoringLeave: false },
  }),
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
