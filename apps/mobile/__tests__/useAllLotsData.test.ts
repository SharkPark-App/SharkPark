/**
 * useAllLotsData Hook Tests
 *
 * Tests the hook for fetching all lots data:
 *   - Initial fetch on mount
 *   - Polling every 30s
 *   - AppState foreground refresh
 *   - Error handling
 *   - Clean-up on unmount
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

// ────────────────────── Mocks ──────────────────────

const mockGetAllLots = jest.fn();

jest.mock('../src/services/api', () => ({
  lotsApi: {
    getAllLots: (...args: unknown[]) => mockGetAllLots(...args),
  },
}));

// Capture AppState listener
let appStateChangeHandler: ((state: AppStateStatus) => void) | null = null;
const mockRemove = jest.fn();

// Ensure AppState.currentState is defined (React Native default)
Object.defineProperty(AppState, 'currentState', {
  get: () => 'active',
  configurable: true,
});

jest.spyOn(AppState, 'addEventListener').mockImplementation(
  (_type, handler) => {
    appStateChangeHandler = handler;
    return { remove: mockRemove } as ReturnType<typeof AppState.addEventListener>;
  },
);

import { useAllLotsData } from '../src/hooks/useAllLotsData';

// ────────────────────── Helpers ──────────────────────

const mockLots = [
  { lot_id: 'G1', lot_name: 'Lot G1', capacity: 200, current_occupancy: 100 },
  { lot_id: 'G2', lot_name: 'Lot G2', capacity: 150, current_occupancy: 50 },
];

// ────────────────────── Tests ──────────────────────

describe('useAllLotsData', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateChangeHandler = null;
    mockGetAllLots.mockResolvedValue(mockLots);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches lots on mount and returns data', async () => {
    const { result } = renderHook(() => useAllLotsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.lots).toEqual(mockLots);
    expect(result.current.error).toBeNull();
    expect(mockGetAllLots).toHaveBeenCalledTimes(1);
  });

  it('sets loading true initially', () => {
    mockGetAllLots.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useAllLotsData());
    expect(result.current.loading).toBe(true);
  });

  it('sets error on fetch failure', async () => {
    mockGetAllLots.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAllLotsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.lots).toEqual([]);
  });

  it('polls every 30 seconds', async () => {
    const { result } = renderHook(() => useAllLotsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(1);

    // Advance by 30s — should trigger another fetch
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(2);

    // Another 30s
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(3);
  });

  it('cleans up interval and AppState listener on unmount', async () => {
    const { result, unmount } = renderHook(() => useAllLotsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    unmount();

    // Advancing time should not cause more fetches
    mockGetAllLots.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockGetAllLots).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalled();
  });

  it('re-fetches when app comes to foreground', async () => {
    const { result } = renderHook(() => useAllLotsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(1);

    // Simulate going to background first (sets the ref to 'background')
    await act(async () => {
      appStateChangeHandler?.('background');
    });

    // Now simulate foreground — ref was 'background', next is 'active' → triggers fetch
    await act(async () => {
      appStateChangeHandler?.('active');
    });

    // Should have fetched again on foreground
    expect(mockGetAllLots).toHaveBeenCalledTimes(2);
  });

  it('exposes a refresh function', async () => {
    const { result } = renderHook(() => useAllLotsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetAllLots.mockResolvedValueOnce([{ lot_id: 'G3' }]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(2);
  });
});
