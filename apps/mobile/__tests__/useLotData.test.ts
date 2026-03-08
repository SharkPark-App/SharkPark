/**
 * useLotData & useLotsList Hook Tests
 *
 * Tests:
 *   - useLotData: fetches lot + forecast, polling at 60s, AppState refresh, error handling
 *   - useLotsList: fetches lot list, polling at 30s, AppState refresh, error handling
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

// ────────────────────── Mocks ──────────────────────

const mockGetLotDetails = jest.fn();
const mockGetLotHistory = jest.fn();
const mockGenerateForecast = jest.fn();
const mockGetAllLots = jest.fn();

jest.mock('../src/services/api', () => ({
  lotsApi: {
    getLotDetails: (...args: unknown[]) => mockGetLotDetails(...args),
    getLotHistory: (...args: unknown[]) => mockGetLotHistory(...args),
    generateForecast: (...args: unknown[]) => mockGenerateForecast(...args),
    getAllLots: (...args: unknown[]) => mockGetAllLots(...args),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// Capture AppState listeners
const appStateListeners: Array<(state: AppStateStatus) => void> = [];
const mockRemove = jest.fn();

// Ensure AppState.currentState is defined (React Native default)
Object.defineProperty(AppState, 'currentState', {
  get: () => 'active',
  configurable: true,
});

jest.spyOn(AppState, 'addEventListener').mockImplementation(
  (_type, handler) => {
    appStateListeners.push(handler);
    return { remove: mockRemove } as ReturnType<typeof AppState.addEventListener>;
  },
);

import { useLotData, useLotsList } from '../src/hooks/useLotData';

// ────────────────────── Helpers ──────────────────────

const mockLot = {
  lot_id: 'G1',
  lot_name: 'Lot G1',
  capacity: 200,
  current_occupancy: 100,
  occupancy_rate: 0.5,
};

const mockForecast = [
  { time: '08:00', occupancy: 50, lowerBound: 40, upperBound: 60, accuracy: 0.8 },
];

const mockLotList = [
  { lot_id: 'G1', lot_name: 'Lot G1', capacity: 200, current_occupancy: 100 },
  { lot_id: 'G2', lot_name: 'Lot G2', capacity: 150, current_occupancy: 50 },
];

// ────────────────────── useLotData Tests ──────────────────────

describe('useLotData', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateListeners.length = 0;
    mockGetLotDetails.mockResolvedValue(mockLot);
    mockGetLotHistory.mockResolvedValue([]);
    mockGenerateForecast.mockReturnValue(mockForecast);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches lot data and forecast on mount', async () => {
    const { result } = renderHook(() => useLotData('G1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.lot).toEqual(mockLot);
    expect(result.current.forecast).toEqual(mockForecast);
    expect(result.current.error).toBeNull();
    expect(mockGetLotDetails).toHaveBeenCalledWith('G1');
  });

  it('sets loading true initially', () => {
    mockGetLotDetails.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLotData('G1'));
    expect(result.current.loading).toBe(true);
  });

  it('handles error from API', async () => {
    mockGetLotDetails.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useLotData('G1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to fetch lot data');
    expect(result.current.lot).toBeNull();
  });

  it('does nothing when lotId is empty', async () => {
    const { result } = renderHook(() => useLotData(''));

    // Should not fetch
    expect(mockGetLotDetails).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('polls every 60 seconds', async () => {
    const { result } = renderHook(() => useLotData('G1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetLotDetails).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockGetLotDetails).toHaveBeenCalledTimes(2);
  });

  it('re-fetches on foreground', async () => {
    const { result } = renderHook(() => useLotData('G1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetLotDetails).toHaveBeenCalledTimes(1);

    // Simulate going to background first
    await act(async () => {
      for (const handler of appStateListeners) {
        handler('background');
      }
    });

    // Then simulate foreground — ref was 'background', next is 'active' → triggers fetch
    await act(async () => {
      for (const handler of appStateListeners) {
        handler('active');
      }
    });

    // Should have fetched again
    expect(mockGetLotDetails).toHaveBeenCalledTimes(2);
  });

  it('cleans up on unmount', async () => {
    const { result, unmount } = renderHook(() => useLotData('G1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    unmount();

    mockGetLotDetails.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });

    expect(mockGetLotDetails).not.toHaveBeenCalled();
  });

  it('refreshHistory fetches history data', async () => {
    const { result } = renderHook(() => useLotData('G1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refreshHistory('2026-03-07');
    });

    // Initial call + explicit call
    expect(mockGetLotHistory).toHaveBeenCalledWith('G1', { date: '2026-03-07', limit: 96 });
  });

  it('refreshHistory does nothing when lotId is empty', async () => {
    const { result } = renderHook(() => useLotData(''));

    await act(async () => {
      await result.current.refreshHistory();
    });

    expect(mockGetLotHistory).not.toHaveBeenCalled();
  });
});

// ────────────────────── useLotsList Tests ──────────────────────

describe('useLotsList', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateListeners.length = 0;
    mockGetAllLots.mockResolvedValue(mockLotList);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches lots on mount', async () => {
    const { result } = renderHook(() => useLotsList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.lots).toEqual(mockLotList);
    expect(result.current.error).toBeNull();
  });

  it('passes filters to API', async () => {
    const filters = { type: 'STUDENT' as const, available_only: true };
    const { result } = renderHook(() => useLotsList(filters));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetAllLots).toHaveBeenCalledWith(filters);
  });

  it('handles errors', async () => {
    mockGetAllLots.mockRejectedValue(new Error('Fetch failed'));

    const { result } = renderHook(() => useLotsList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to fetch lots data');
    expect(result.current.lots).toEqual([]);
  });

  it('polls every 30 seconds', async () => {
    const { result } = renderHook(() => useLotsList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(2);
  });

  it('re-fetches on foreground', async () => {
    const { result } = renderHook(() => useLotsList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      for (const handler of appStateListeners) {
        handler('background');
      }
    });

    await act(async () => {
      for (const handler of appStateListeners) {
        handler('active');
      }
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(2);
  });

  it('cleans up on unmount', async () => {
    const { result, unmount } = renderHook(() => useLotsList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    unmount();

    mockGetAllLots.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockGetAllLots).not.toHaveBeenCalled();
  });

  it('exposes refreshLots function', async () => {
    const { result } = renderHook(() => useLotsList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refreshLots();
    });

    expect(mockGetAllLots).toHaveBeenCalledTimes(2);
  });
});
