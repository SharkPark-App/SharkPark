/**
 * ForceUpdateScreen — render-level unit tests
 *
 * These exercise the actual screen component (not the App.tsx gate logic),
 * to give the file real patch coverage instead of leaving handleUpdate
 * + Linking.openURL untested.
 */

import React from 'react';
import { Linking, Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) => (
      <View style={style}>{children}</View>
    ),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { ForceUpdateScreen } from '../src/screens/ForceUpdateScreen';

describe('ForceUpdateScreen (rendered)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the iOS CTA copy and opens the App Store URL on press (iOS)', () => {
    Platform.OS = 'ios';
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { getByText } = render(<ForceUpdateScreen />);
    const button = getByText('Update on App Store');
    fireEvent.press(button);

    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('apps.apple.com'));
  });

  it('shows the Android CTA copy and opens the correct Play Store package URL (Android)', () => {
    Platform.OS = 'android';
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { getByText } = render(<ForceUpdateScreen />);
    const button = getByText('Update on Play Store');
    fireEvent.press(button);

    // Must match the real applicationId in android/app/build.gradle
    // (app.sharkpark.mobile), NOT the namespace (com.mobile).
    expect(openURL).toHaveBeenCalledWith(
      'https://play.google.com/store/apps/details?id=app.sharkpark.mobile',
    );
  });

  it('renders the Update Required title and body copy', () => {
    Platform.OS = 'ios';
    const { getByText } = render(<ForceUpdateScreen />);
    expect(getByText('Update Required')).toBeTruthy();
    expect(getByText(/newer version of SharkPark is required/i)).toBeTruthy();
  });
});
