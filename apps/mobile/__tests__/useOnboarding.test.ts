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
  });
});
