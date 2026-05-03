/**
 * Tests for AuthContext — specifically that guest-mode hydration survives
 * a simulated app restart (the core fix of fix/persist-guest-mode).
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { loadAuth } from '../src/auth/AzureAuth';

// AsyncStorage is auto-mocked via the jest setup in package.json /
// jest.config.js via @react-native-async-storage/async-storage/jest/async-storage-mock
jest.mock('../src/auth/AzureAuth', () => ({
  loginWithAzure: jest.fn(),
  logoutFromAzure: jest.fn(),
  loadAuth: jest.fn().mockResolvedValue(null),
  saveAuth: jest.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext — guest-mode hydration', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('isGuest === false on a cold start with no stored flag', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isGuest).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('isGuest === true after a simulated restart when guest flag is stored', async () => {
    // Pre-seed storage exactly as continueAsGuest() would on a previous launch
    await AsyncStorage.setItem('@SharkPark:isGuest', 'true');

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isGuest).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('continueAsGuest persists the flag to AsyncStorage', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.continueAsGuest();
    });

    expect(result.current.isGuest).toBe(true);
    const stored = await AsyncStorage.getItem('@SharkPark:isGuest');
    expect(stored).toBe('true');
  });

  it('exitGuestMode removes the flag from AsyncStorage', async () => {
    await AsyncStorage.setItem('@SharkPark:isGuest', 'true');

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.exitGuestMode();
    });

    expect(result.current.isGuest).toBe(false);
    const stored = await AsyncStorage.getItem('@SharkPark:isGuest');
    expect(stored).toBeNull();
  });

  it('initAuth clears a stale guest flag when a saved user exists', async () => {
    (loadAuth as jest.Mock).mockResolvedValueOnce({
      accessToken: 'tok',
      idToken: 'id',
      email: 'a@b.com',
      name: 'Test',
    });
    // Simulate a stale guest flag from before sign-in
    await AsyncStorage.setItem('@SharkPark:isGuest', 'true');

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isGuest).toBe(false);
    // Flag should have been removed opportunistically
    const stored = await AsyncStorage.getItem('@SharkPark:isGuest');
    expect(stored).toBeNull();
  });
});
