import { renderHook, waitFor, act } from '@testing-library/react-native';
import { AppState } from 'react-native';

jest.mock('../src/services/api/events');

// Ensure AppState.addEventListener returns a real subscription so the hook's
// cleanup `sub.remove()` doesn't crash on unmount under jest's RN mock.
jest.spyOn(AppState, 'addEventListener').mockImplementation(
  () => ({ remove: jest.fn() }) as ReturnType<typeof AppState.addEventListener>,
);

import { useEvents } from '../src/hooks/useEvents';
import { eventsApi } from '../src/services/api/events';
import type { CampusEvent } from '../src/types/events';

type UseEventsReturn = ReturnType<typeof useEvents>;

const mockEventsApi = eventsApi as jest.Mocked<typeof eventsApi>;

const ev = (overrides: Partial<CampusEvent> = {}): CampusEvent => ({
  id: 'ev-1',
  external_id: 'lbsu-sports-10109',
  event_name: 'Baseball vs Hawaii',
  location: 'Blair Field',
  description: null,
  event_url: null,
  start_time: '2026-05-04T20:00:00Z',
  end_time: '2026-05-04T23:00:00Z',
  created_at: '2026-05-01T00:00:00Z',
  status: 'FINAL',
  home_score: 7,
  away_score: 3,
  result_status: 'W',
  ...overrides,
});

describe('useEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (AppState as { currentState: string }).currentState = 'active';
    // jest.clearAllMocks wiped the module-level AppState spy's implementation;
    // re-install it so cleanup `sub.remove()` doesn't crash.
    (AppState.addEventListener as unknown as jest.Mock).mockImplementation(
      () => ({ remove: jest.fn() }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches on mount and maps backend payload to UI Event shape', async () => {
    mockEventsApi.getEventsForLot.mockResolvedValueOnce([ev()]);

    const { result } = renderHook(() => useEvents('G7'));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockEventsApi.getEventsForLot).toHaveBeenCalledWith('G7');
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      id: 'ev-1',
      name: 'Baseball vs Hawaii',
      status: 'FINAL',
      homeScore: 7,
      awayScore: 3,
      resultStatus: 'W',
    });
    expect(result.current.events[0]!.date).toBeInstanceOf(Date);
    expect(result.current.events[0]!.endDate).toBeInstanceOf(Date);
  });

  it('preserves null score fields for non-sports events', async () => {
    mockEventsApi.getEventsForLot.mockResolvedValueOnce([
      ev({
        id: 'academic-1',
        event_name: 'Lecture',
        status: null,
        home_score: null,
        away_score: null,
        result_status: null,
      }),
    ]);

    const { result } = renderHook(() => useEvents('G7'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.events[0]).toMatchObject({
      status: null,
      homeScore: null,
      awayScore: null,
      resultStatus: null,
    });
  });

  it('captures errors without throwing', async () => {
    mockEventsApi.getEventsForLot.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useEvents('G7'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('boom');
    expect(result.current.events).toEqual([]);
  });

  it('does not fetch when lotId is empty', () => {
    const { result } = renderHook(() => useEvents(''));
    expect(mockEventsApi.getEventsForLot).not.toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
  });

  it('re-fetches when lotId changes and resets the events list', async () => {
    mockEventsApi.getEventsForLot
      .mockResolvedValueOnce([ev({ id: 'a' })])
      .mockResolvedValueOnce([ev({ id: 'b' })]);

    const { result, rerender } = renderHook<UseEventsReturn, { id: string }>(
      ({ id }) => useEvents(id),
      { initialProps: { id: 'G7' } },
    );
    await waitFor(() => expect(result.current.events[0]?.id).toBe('a'));

    rerender({ id: 'G10' });
    // After rerender the events list resets to [] before refetch resolves.
    expect(result.current.events).toEqual([]);
    await waitFor(() => expect(result.current.events[0]?.id).toBe('b'));
    expect(mockEventsApi.getEventsForLot).toHaveBeenLastCalledWith('G10');
  });

  it('polls every 5 minutes', async () => {
    mockEventsApi.getEventsForLot.mockResolvedValue([ev()]);
    renderHook(() => useEvents('G7'));
    await waitFor(() => expect(mockEventsApi.getEventsForLot).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(mockEventsApi.getEventsForLot).toHaveBeenCalledTimes(2);
  });

  it('re-fetches when AppState transitions from background to active', async () => {
    mockEventsApi.getEventsForLot.mockResolvedValue([ev()]);
    // The hook seeds its internal ref from AppState.currentState; ensure it's
    // a real string so the subsequent .match() call doesn't throw under the
    // RN mock (which leaves currentState undefined by default).
    (AppState as { currentState: string }).currentState = 'active';

    const { unmount } = renderHook(() => useEvents('G7'));
    await waitFor(() => expect(mockEventsApi.getEventsForLot).toHaveBeenCalledTimes(1));

    // The module-level spy on addEventListener captured all calls. Find ours.
    const spy = AppState.addEventListener as unknown as jest.Mock;
    const call = spy.mock.calls.find(c => c[0] === 'change');
    expect(call).toBeDefined();
    const handler = call![1] as (s: 'active' | 'background' | 'inactive') => void;

    // Simulate background → active.
    act(() => handler('background'));
    act(() => handler('active'));

    await waitFor(() => expect(mockEventsApi.getEventsForLot).toHaveBeenCalledTimes(2));
    unmount();
  });

  it('drops a stale in-flight response when a newer fetch starts (race protection)', async () => {
    let resolveFirst: (v: CampusEvent[]) => void = () => {};
    const firstPromise = new Promise<CampusEvent[]>(res => { resolveFirst = res; });

    mockEventsApi.getEventsForLot
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce([ev({ id: 'fresh' })]);

    const { result } = renderHook(() => useEvents('G7'));
    expect(mockEventsApi.getEventsForLot).toHaveBeenCalledTimes(1);

    // Advance the poll interval to start a second fetch while the first is
    // still in flight. The second resolves immediately with 'fresh'.
    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    await waitFor(() => expect(result.current.events[0]?.id).toBe('fresh'));

    // Now resolve the stale first call — it must not overwrite the fresh state.
    await act(async () => {
      resolveFirst([ev({ id: 'stale' })]);
      await Promise.resolve();
    });
    expect(result.current.events[0]?.id).toBe('fresh');
  });
});
