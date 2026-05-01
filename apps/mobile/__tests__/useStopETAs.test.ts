import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useStopETAs } from '../src/hooks/useStopETAs';
import { TransitService } from '../src/services/api/transit';
import type { RouteArrival } from '../src/types/transit';

// Mock the TransitService
jest.mock('../src/services/api/transit');
const mockTransitService = TransitService as jest.Mocked<typeof TransitService>;

describe('useStopETAs hook', () => {
  const mockStopId = '154358';
  const mockArrivals: RouteArrival[] = [
    {
      routeId: '44317',
      routeName: 'East Loop',
      abbreviation: 'E',
      color: '#ffea3f',
      etaMinutes: 3,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns empty state when stopId is undefined', () => {
    const { result } = renderHook(() => useStopETAs(undefined));

    expect(result.current.arrivals).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockTransitService.getStopETAs).not.toHaveBeenCalled();
  });

  it('fetches ETAs and manages loading state on initial mount', async () => {
    mockTransitService.getStopETAs.mockResolvedValueOnce(mockArrivals);

    const { result } = renderHook(() => useStopETAs(mockStopId));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.arrivals).toEqual([]);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.arrivals).toEqual(mockArrivals);
    expect(result.current.error).toBeNull();
    expect(mockTransitService.getStopETAs).toHaveBeenCalledWith(mockStopId);
    expect(mockTransitService.getStopETAs).toHaveBeenCalledTimes(1);
  });

  it('handles API errors gracefully', async () => {
    const errorMessage = 'Failed to fetch ETAs';
    mockTransitService.getStopETAs.mockRejectedValueOnce(new Error(errorMessage));

    const { result } = renderHook(() => useStopETAs(mockStopId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.arrivals).toEqual([]);
    expect(result.current.error).toBe(errorMessage);
  });

  it('polls the API every 30 seconds without triggering the loading spinner', async () => {
    mockTransitService.getStopETAs.mockResolvedValue(mockArrivals);

    const { result } = renderHook(() => useStopETAs(mockStopId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockTransitService.getStopETAs).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    // The service should have been called a second time
    expect(mockTransitService.getStopETAs).toHaveBeenCalledTimes(2);
    
    // No loading spinner during background refresh
    expect(result.current.isLoading).toBe(false);
  });

  it('cleans up the interval and ignores async resolution on unmount', async () => {
    mockTransitService.getStopETAs.mockResolvedValue(mockArrivals);

    const { unmount } = renderHook(() => useStopETAs(mockStopId));

    // Unmount the component immediately before the promise resolves
    unmount();

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    // Shouldn't be called for interval fetch
    expect(mockTransitService.getStopETAs).toHaveBeenCalledTimes(1);
  });

  it('resets arrivals when stopId changes to undefined', async () => {
    mockTransitService.getStopETAs.mockResolvedValueOnce(mockArrivals);

    const { result, rerender } = renderHook<
      ReturnType<typeof useStopETAs>, 
      { id: string | undefined }
    >(
      ({ id }) => useStopETAs(id),
      { initialProps: { id: mockStopId } }
    );

    await waitFor(() => {
      expect(result.current.arrivals).toEqual(mockArrivals);
    });

    // Rerender with undefined stopId
    rerender({ id: undefined });

    expect(result.current.arrivals).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});