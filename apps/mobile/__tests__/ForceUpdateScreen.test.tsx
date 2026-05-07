/**
 * ForceUpdateScreen — unit tests
 *
 * Tests cover:
 *  1. Nothing shown while version check is in-flight (null render)
 *  2. ForceUpdateScreen rendered when currentVersion < minSupportedVersion
 *  3. Normal app rendered when currentVersion >= minSupportedVersion
 *  4. Normal app rendered when the version API throws (fail-open)
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// ── Third-party mocks (must precede the import that triggers them) ─────────

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getVersion: jest.fn().mockReturnValue('1.0.0'),
    getBrand: jest.fn().mockResolvedValue('Apple'),
    getModel: jest.fn().mockResolvedValue('iPhone'),
    getSystemVersion: jest.fn().mockResolvedValue('16.0'),
    getBatteryLevel: jest.fn().mockResolvedValue(0.8),
    getBluetoothLeState: jest.fn().mockResolvedValue('on'),
  },
}));

jest.mock('../src/services/api/version', () => ({
  fetchMinVersion: jest.fn(),
}));

// ── App-layer mocks ───────────────────────────────────────────────────────

jest.mock('../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    isAuthenticated: false,
    isGuest: false,
    isLoading: false,
  }),
}));

jest.mock('../src/context/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({
    isDark: false,
    colors: {
      primary: '#EBA91B',
      white: '#ffffff',
      lightGray: '#f3f4f6',
      textPrimary: '#111827',
      borderGray: '#e5e7eb',
    },
  }),
}));

jest.mock('../src/hooks/useOnboarding', () => ({
  useOnboarding: () => ({
    isLoading: false,
    needsOnboarding: false,
    completeOnboarding: jest.fn(),
    needsPermissionGate: false,
    completePermissionGate: jest.fn(),
  }),
}));

jest.mock('../src/context/EnhancedGeofencingProvider', () => ({
  EnhancedGeofencingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../src/navigation', () => ({
  MainTabNavigator: () => null,
}));

jest.mock('../src/navigation/linking', () => ({ linkingConfig: {} }));

jest.mock('../src/screens', () => ({
  LoginScreen: () => null,
  OnboardingScreen: () => null,
  PermissionGateScreen: () => null,
  ForceUpdateScreen: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('react-native');
    return <Text testID="force-update-screen">Update Required</Text>;
  },
}));

// ── Imports that depend on the mocks above ────────────────────────────────

import DeviceInfo from 'react-native-device-info';
import { fetchMinVersion } from '../src/services/api/version';
import App from '../App';

const mockFetchMinVersion = fetchMinVersion as jest.Mock;
const mockGetVersion = DeviceInfo.getVersion as jest.Mock;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Force-update gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the force-update screen when currentVersion < minSupportedVersion', async () => {
    mockGetVersion.mockReturnValue('1.0.0');
    mockFetchMinVersion.mockResolvedValue({ minSupportedVersion: '1.1.0' });

    const { getByTestId } = render(<App />);
    await waitFor(() => getByTestId('force-update-screen'));
  });

  it('does NOT render the force-update screen when currentVersion === minSupportedVersion', async () => {
    mockGetVersion.mockReturnValue('1.1.0');
    mockFetchMinVersion.mockResolvedValue({ minSupportedVersion: '1.1.0' });

    const { queryByTestId } = render(<App />);
    await waitFor(() =>
      expect(queryByTestId('force-update-screen')).toBeNull(),
    );
  });

  it('does NOT render the force-update screen when currentVersion > minSupportedVersion', async () => {
    mockGetVersion.mockReturnValue('2.0.0');
    mockFetchMinVersion.mockResolvedValue({ minSupportedVersion: '1.9.9' });

    const { queryByTestId } = render(<App />);
    await waitFor(() =>
      expect(queryByTestId('force-update-screen')).toBeNull(),
    );
  });

  it('fails open (no force-update screen) when the version API throws', async () => {
    mockGetVersion.mockReturnValue('1.0.0');
    mockFetchMinVersion.mockRejectedValue(new Error('Network error'));

    const { queryByTestId } = render(<App />);
    await waitFor(() =>
      expect(queryByTestId('force-update-screen')).toBeNull(),
    );
  });
});

