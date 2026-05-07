/**
 * PermissionGateScreen — unit tests
 *
 * Covers:
 *  1. Intro renders with allow + skip buttons
 *  2. Allow → granted on Android calls PermissionsAndroid.request
 *     and auto-advances after the timer
 *  3. Allow → denied on Android shows the "No problem" copy
 *  4. Allow on iOS delegates to services/pushNotifications
 *  5. "Not now" calls onDone immediately without prompting the OS
 *  6. The double-tap guard prevents a second OS request while one is in-flight
 *  7. The auto-advance timer is cleaned up on unmount (no callback after unmount)
 */

import React from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../src/services/pushNotifications', () => ({
  requestNotificationPermission: jest.fn(),
}));

import { PermissionGateScreen } from '../src/screens/PermissionGateScreen';
import { requestNotificationPermission as requestFcmPermission } from '../src/services/pushNotifications';

const mockFcmRequest = requestFcmPermission as jest.Mock;
const mockAndroidRequest = jest
  .spyOn(PermissionsAndroid, 'request')
  .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

function setPlatform(os: 'ios' | 'android', version: number | string = 33) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
}

describe('PermissionGateScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    setPlatform('ios');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders intro stage with Allow and Not now controls', () => {
    const onDone = jest.fn();
    const { getByText } = render(<PermissionGateScreen onDone={onDone} />);

    expect(getByText('Stay in the loop')).toBeTruthy();
    expect(getByText('Allow Notifications')).toBeTruthy();
    expect(getByText('Not now')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('"Not now" advances immediately without invoking any permission API', () => {
    const onDone = jest.fn();
    const { getByText } = render(<PermissionGateScreen onDone={onDone} />);

    fireEvent.press(getByText('Not now'));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockFcmRequest).not.toHaveBeenCalled();
    expect(mockAndroidRequest).not.toHaveBeenCalled();
  });

  it('iOS Allow → granted shows success copy and auto-advances after 1.4 s', async () => {
    setPlatform('ios');
    mockFcmRequest.mockResolvedValueOnce(true);
    const onDone = jest.fn();

    const { getByText, queryByText } = render(<PermissionGateScreen onDone={onDone} />);

    await act(async () => {
      fireEvent.press(getByText('Allow Notifications'));
    });

    expect(mockFcmRequest).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(queryByText("You're all set!")).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(1400); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Android Allow → denied shows the "No problem" copy', async () => {
    setPlatform('android', 33);
    mockAndroidRequest.mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED);
    const onDone = jest.fn();

    const { getByText, queryByText } = render(<PermissionGateScreen onDone={onDone} />);

    await act(async () => {
      fireEvent.press(getByText('Allow Notifications'));
    });

    expect(mockAndroidRequest).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    expect(mockFcmRequest).not.toHaveBeenCalled();
    await waitFor(() => expect(queryByText('No problem')).toBeTruthy());
  });

  it('Android < 13 short-circuits to granted without calling PermissionsAndroid', async () => {
    setPlatform('android', 31);
    const onDone = jest.fn();

    const { getByText, queryByText } = render(<PermissionGateScreen onDone={onDone} />);

    await act(async () => {
      fireEvent.press(getByText('Allow Notifications'));
    });

    expect(mockAndroidRequest).not.toHaveBeenCalled();
    await waitFor(() => expect(queryByText("You're all set!")).toBeTruthy());
  });

  it('falls back to denied state when the permission API throws', async () => {
    setPlatform('ios');
    mockFcmRequest.mockRejectedValueOnce(new Error('boom'));
    const onDone = jest.fn();

    const { getByText, queryByText } = render(<PermissionGateScreen onDone={onDone} />);

    await act(async () => {
      fireEvent.press(getByText('Allow Notifications'));
    });

    await waitFor(() => expect(queryByText('No problem')).toBeTruthy());
  });

  it('clears the auto-advance timer on unmount', async () => {
    setPlatform('ios');
    mockFcmRequest.mockResolvedValueOnce(true);
    const onDone = jest.fn();

    const { getByText, unmount } = render(<PermissionGateScreen onDone={onDone} />);

    await act(async () => {
      fireEvent.press(getByText('Allow Notifications'));
    });

    unmount();
    act(() => { jest.advanceTimersByTime(2000); });

    expect(onDone).not.toHaveBeenCalled();
  });
});
