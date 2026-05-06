/**
 * Tests for useOnboarding hook
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOnboarding } from '../src/hooks/useOnboarding';

// AsyncStorage is auto-mocked via jest setup
const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

describe('useOnboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('needsOnboarding is true when storage key is absent', async () => {
    mockGetItem.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useOnboarding());
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.needsOnboarding).toBe(true);
  });

  it('needsOnboarding is false when storage key is present', async () => {
    mockGetItem.mockResolvedValueOnce('true');

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.needsOnboarding).toBe(false);
  });

  it('completeOnboarding writes the key and clears the flag', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    mockSetItem.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.needsOnboarding).toBe(true);

    await act(async () => {
      await result.current.completeOnboarding();
    });

    expect(mockSetItem).toHaveBeenCalledWith('@SharkPark:onboardingComplete', 'true');
    expect(result.current.needsOnboarding).toBe(false);
  });

  it('skips onboarding if AsyncStorage read throws', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('storage error'));

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.needsOnboarding).toBe(false);
    expect(result.current.needsPermissionGate).toBe(false);
  });

  // ── Permission gate ────────────────────────────────────────────────────

  it('needsPermissionGate is true when onboarding is done but gate has not been shown', async () => {
    mockGetItem.mockImplementation((key: string) =>
      Promise.resolve(key === '@SharkPark:onboardingComplete' ? 'true' : null),
    );

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.needsOnboarding).toBe(false);
    expect(result.current.needsPermissionGate).toBe(true);
  });

  it('needsPermissionGate is false when both keys are present', async () => {
    mockGetItem.mockResolvedValue('true');

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.needsOnboarding).toBe(false);
    expect(result.current.needsPermissionGate).toBe(false);
  });

  it('completeOnboarding queues the permission gate immediately', async () => {
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.needsPermissionGate).toBe(false);

    await act(async () => {
      await result.current.completeOnboarding();
    });

    expect(result.current.needsOnboarding).toBe(false);
    expect(result.current.needsPermissionGate).toBe(true);
  });

  it('completePermissionGate writes the key and clears the flag', async () => {
    mockGetItem.mockImplementation((key: string) =>
      Promise.resolve(key === '@SharkPark:onboardingComplete' ? 'true' : null),
    );
    mockSetItem.mockResolvedValue(undefined);

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.needsPermissionGate).toBe(true);

    await act(async () => {
      await result.current.completePermissionGate();
    });

    expect(mockSetItem).toHaveBeenCalledWith('@SharkPark:permissionGateShown', 'true');
    expect(result.current.needsPermissionGate).toBe(false);
  });
});
