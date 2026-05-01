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
  // The screen uses useFocusEffect to re-reconcile with OS truth when
  // returning from Settings.app. In tests we no-op it: the screen also
  // has a mount-time useEffect that runs the same probe, so behavior is
  // exercised without the focus callback double-consuming our mock
  // queue (mockResolvedValueOnce).
  useFocusEffect: () => {},
}));

// Mock locationService — both `requestPermissions` (action) and
// `getAuthorizationStatus` (truth-of-record post-action). The screen
// reconciles against the latter, never trusting the former alone, so
// every test must stub it.
const mockRequestPermissions = jest.fn();
const mockGetAuthorizationStatus = jest.fn();
const mockGetAccuracyAuthorization = jest.fn();
const mockOnProviderChange = jest.fn(() => () => undefined);
jest.mock('../src/services/locationService', () => ({
  locationService: {
    requestPermissions: (...args: unknown[]) => mockRequestPermissions(...args),
    getAuthorizationStatus: (...args: unknown[]) => mockGetAuthorizationStatus(...args),
    getAccuracyAuthorization: (...args: unknown[]) => mockGetAccuracyAuthorization(...args),
    onProviderChange: (...args: unknown[]) => mockOnProviderChange(...(args as [])),
  },
}));

// Mock the contributor-grant API so tests don't hit the network.
jest.mock('../src/services/api/contributor', () => ({
  registerContributorGrant: jest.fn().mockResolvedValue(undefined),
  revokeContributorGrant: jest.fn().mockResolvedValue(undefined),
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
    mockGetAuthorizationStatus.mockReset();
    mockGetAccuracyAuthorization.mockReset();
    mockOnProviderChange.mockClear();
    // Default: no prior auth — keeps the screen on the explain step.
    mockGetAuthorizationStatus.mockResolvedValue('notDetermined');
    // Default: full accuracy. Tests that exercise the Reduced path
    // override per-call via mockResolvedValueOnce.
    mockGetAccuracyAuthorization.mockResolvedValue('full');
  });

  it('renders the explain step on mount', () => {
    const { getByText } = render(<LocationPermissionScreen />);
    // Initial step shows the WhenInUse CTA.
    expect(getByText(/Enable location access/i)).toBeTruthy();
  });

  it('routes through locationService and advances on grant', async () => {
    mockRequestPermissions.mockResolvedValueOnce(true);
    // After the prompt the OS reports WhenInUse — should advance to stage 2.
    mockGetAuthorizationStatus
      .mockResolvedValueOnce('notDetermined') // initial mount probe
      .mockResolvedValueOnce('whenInUse');    // post-request reconciliation
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
    // OS still reports denied after the prompt.
    mockGetAuthorizationStatus
      .mockResolvedValueOnce('notDetermined')
      .mockResolvedValueOnce('denied');
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

  it('routes Always + Reduced accuracy to the Precise Location step', async () => {
    // User already had WhenInUse going in (mount probe), so the screen
    // jumps straight to the 'always' step. The escalation prompt then
    // grants Always but iOS reports Reduced accuracy — we must NOT
    // advance to 'done' (would silently treat the user as a contributor
    // despite garbage-tier coords) and must NOT register a grant.
    mockGetAuthorizationStatus
      .mockResolvedValueOnce('whenInUse') // initial mount probe
      .mockResolvedValueOnce('whenInUse') // requestAlways `before` snapshot
      .mockResolvedValueOnce('always');   // requestAlways `after` snapshot
    mockGetAccuracyAuthorization
      .mockResolvedValueOnce('reduced')   // initial mount probe
      .mockResolvedValueOnce('reduced');  // requestAlways post-prompt
    mockRequestPermissions.mockResolvedValueOnce(false); // returns Always+Reduced → not contributor

    const { registerContributorGrant } = jest.requireMock('../src/services/api/contributor') as {
      registerContributorGrant: jest.Mock;
    };

    const { getByText, getAllByText } = render(<LocationPermissionScreen />);

    // Wait for mount probe to land us on the 'always' step.
    await waitFor(() => {
      expect(getByText(/Allow background access/i)).toBeTruthy();
    });

    fireEvent.press(getByText(/Allow background access/i));

    // Lands on the Precise Location step with the Settings deep-link CTA.
    await waitFor(() => {
      expect(getByText(/One more thing/i)).toBeTruthy();
      // Both the body copy and the CTA button mention "Open Settings" —
      // matching multiple confirms the screen rendered.
      const matches = getAllByText(/Open Settings/i);
      expect(matches.length).toBeGreaterThan(0);
    });

    // Critical: contributor grant must NOT have been registered under
    // Always + Reduced — the whole point of the gate.
    expect(registerContributorGrant).not.toHaveBeenCalled();
  });
});
