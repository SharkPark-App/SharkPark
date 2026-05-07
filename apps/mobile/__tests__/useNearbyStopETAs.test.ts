/**
 * useNearbyStopETAs hook tests
 *
 * - Returns empty array before stops load
 * - Resolves nearby stops and fetches their ETAs
 * - Shows isLoading=true while ETAs are pending, false after
 * - Polls ETAs every 15 seconds without re-triggering the loading spinner
 * - Handles ETA fetch errors gracefully (empty arrivals, not loading)
 * - Cleans up interval on unmount
 */
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useNearbyStopETAs } from '../src/hooks/useNearbyStopETAs';
import { TransitService } from '../src/services/api/transit';
import type { MapStop, RouteArrival } from '../src/types/transit';

// ────────────────────── Mocks ──────────────────────

jest.mock('../src/services/api/transit');
const mockTransitService = TransitService as jest.Mocked<typeof TransitService>;

// Control which stops are "nearby" without involving real geo math
jest.mock('../src/utils/transitProximity', () => ({
  nearbyStopsForLot: jest.fn(),
}));
import { nearbyStopsForLot } from '../src/utils/transitProximity';
const mockNearby = nearbyStopsForLot as jest.Mock;

// ────────────────────── Mock Data ──────────────────────

const mockStop: MapStop = {
  id: 's1',
  name: 'Student Union',
  latitude: 33.78,
  longitude: -118.11,
  routeIds: ['r1'],
  color: '#ff0000',
};

const mockArrivals: RouteArrival[] = [
  { routeId: 'r1', routeName: 'East Loop', abbreviation: 'E', color: '#ffea3f', etaMinutes: 7 },
];

// ────────────────────── Tests ──────────────────────

describe('useNearbyStopETAs hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockNearby.mockReturnValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns empty array before stops are loaded', () => {
    mockTransitService.getRoutesAndStops.mockResolvedValue({ routes: [], stops: [] });
    const { result } = renderHook(() => useNearbyStopETAs('LOT_A'));
    expect(result.current).toEqual([]);
  });

  it('returns nearby stops with isLoading=true while ETAs are pending', async () => {
    mockTransitService.getRoutesAndStops.mockResolvedValue({ routes: [], stops: [mockStop] });
    mockNearby.mockReturnValue([mockStop]);
    // Hold the ETA fetch open so we can observe loading state
    let resolveEta!: (v: RouteArrival[]) => void;
    mockTransitService.getStopETAs.mockReturnValue(new Promise(r => { resolveEta = r; }));

    const { result } = renderHook(() => useNearbyStopETAs('LOT_A'));

    await waitFor(() => {
      expect(result.current).toHaveLength(1);
    });

    expect(result.current[0].stop.id).toBe('s1');
    expect(result.current[0].isLoading).toBe(true);
    expect(result.current[0].arrivals).toEqual([]);

    await act(async () => { resolveEta(mockArrivals); });

    expect(result.current[0].isLoading).toBe(false);
    expect(result.current[0].arrivals).toEqual(mockArrivals);
  });

  it('handles ETA fetch error — sets arrivals to empty, isLoading to false', async () => {
    mockTransitService.getRoutesAndStops.mockResolvedValue({ routes: [], stops: [mockStop] });
    mockNearby.mockReturnValue([mockStop]);
    mockTransitService.getStopETAs.mockRejectedValue(new Error('timeout'));

    const { result } = renderHook(() => useNearbyStopETAs('LOT_A'));

    await waitFor(() => {
      expect(result.current[0]?.isLoading).toBe(false);
    });

    expect(result.current[0].arrivals).toEqual([]);
  });

  it('polls ETAs every 15 seconds without re-showing the loading spinner', async () => {
    mockTransitService.getRoutesAndStops.mockResolvedValue({ routes: [], stops: [mockStop] });
    mockNearby.mockReturnValue([mockStop]);
    mockTransitService.getStopETAs.mockResolvedValue(mockArrivals);

    const { result } = renderHook(() => useNearbyStopETAs('LOT_A'));

    await waitFor(() => {
      expect(result.current[0]?.isLoading).toBe(false);
    });

    expect(mockTransitService.getStopETAs).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(15_000); });

    expect(mockTransitService.getStopETAs).toHaveBeenCalledTimes(2);
    // Background poll must not flip isLoading back to true
    expect(result.current[0].isLoading).toBe(false);
  });

  it('cleans up the interval on unmount', async () => {
    mockTransitService.getRoutesAndStops.mockResolvedValue({ routes: [], stops: [mockStop] });
    mockNearby.mockReturnValue([mockStop]);
    mockTransitService.getStopETAs.mockResolvedValue(mockArrivals);

    const { unmount } = renderHook(() => useNearbyStopETAs('LOT_A'));

    await waitFor(() => {
      expect(mockTransitService.getStopETAs).toHaveBeenCalledTimes(1);
    });

    unmount();

    await act(async () => { jest.advanceTimersByTime(15_000); });

    expect(mockTransitService.getStopETAs).toHaveBeenCalledTimes(1);
  });

  it('handles stops fetch error gracefully', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockTransitService.getRoutesAndStops.mockRejectedValue(new Error('network fail'));

    const { result } = renderHook(() => useNearbyStopETAs('LOT_A'));

    await waitFor(() => {
      // After failed stops fetch, nearby stays empty
      expect(result.current).toEqual([]);
    });
  });
});
