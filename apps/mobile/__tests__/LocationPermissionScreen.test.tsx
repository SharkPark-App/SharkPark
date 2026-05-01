/**
 * Smoke test for LocationPermissionScreen.
 *
 * Verifies the soft-ask flow advances `step` based on the result of
 * `locationService.requestPermissions()` rather than calling
 * `BackgroundGeolocation.ready()` (which would clobber the prod config
 * applied at app boot — see comments in LocationPermissionScreen.tsx).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Mock navigation — the screen calls useNavigation but the smoke test only
// exercises the button-press → step-transition path.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

// Mock locationService.requestPermissions so we control the granted/denied path.
const mockRequestPermissions = jest.fn();
jest.mock('../src/services/locationService', () => ({
  locationService: {
    requestPermissions: (...args: unknown[]) => mockRequestPermissions(...args),
  },
}));

// Theme context — the screen reads colors from useTheme.
jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      backgroundLight: '#fff',
      textPrimary: '#000',
      gray: '#888',
      primary: '#0a7',
      white: '#fff',
      lightGray: '#eee',
      shadowDark: '#000',
    },
    isDark: false,
  }),
}));

import LocationPermissionScreen from '../src/screens/LocationPermissionScreen';

describe('LocationPermissionScreen', () => {
  beforeEach(() => {
    mockRequestPermissions.mockReset();
  });

  it('renders the explain step on mount', () => {
    const { getByText } = render(<LocationPermissionScreen />);
    // Initial step shows the WhenInUse CTA.
    expect(getByText(/Enable location access/i)).toBeTruthy();
  });

  it('routes through locationService and advances on grant', async () => {
    mockRequestPermissions.mockResolvedValueOnce(true);
    const { getByText } = render(<LocationPermissionScreen />);

    fireEvent.press(getByText(/Enable location access/i));

    await waitFor(() => {
      expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    });

    // After grant, step advances to 'always' which renders the Always-Allow CTA.
    await waitFor(() => {
      expect(getByText(/Allow background access/i)).toBeTruthy();
    });
  });

  it('advances to done when permission is denied', async () => {
    mockRequestPermissions.mockResolvedValueOnce(false);
    const { getByText, queryByText } = render(<LocationPermissionScreen />);

    fireEvent.press(getByText(/Enable location access/i));

    await waitFor(() => {
      expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    });

    // 'done' step renders the success CTA, not the WhenInUse CTA.
    await waitFor(() => {
      expect(queryByText(/Enable location access/i)).toBeNull();
      expect(getByText(/Back to Map/i)).toBeTruthy();
    });
  });
});
