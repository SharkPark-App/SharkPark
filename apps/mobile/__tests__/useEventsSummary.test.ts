import { renderHook, waitFor, act } from '@testing-library/react-native';

// useEventsSummary uses `useFocusEffect` from @react-navigation/native to
// gate polling. Without a NavigationContainer in unit tests the real hook
// is a no-op, so shim it to behave like a plain useEffect that runs on
// mount and tears down on unmount.
jest.mock('@react-navigation/native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => cb(), [cb]);
    },
  };
});

import { useEventsSummary } from '../src/hooks/useEventsSummary';
import { eventsApi } from '../src/services/api/events';
import type { LotEventsSummary } from '../src/types/events';

jest.mock('../src/services/api/events');
const mockEventsApi = eventsApi as jest.Mocked<typeof eventsApi>;

describe('useEventsSummary hook', () => {
  const summary: LotEventsSummary[] = [
    {
      lot_id: 'G7',
      count: 2,
      next_event: {
        id: 'ev-1',
        event_name: 'Game',
        location: 'Pyramid',
        start_time: '2026-05-04T20:00:00Z',
        end_time: '2026-05-04T22:00:00Z',
      },
    },
    { lot_id: 'G10', count: 0, next_event: null },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches the summary on mount and exposes per-lot counts', async () => {
    mockEventsApi.getEventsSummary.mockResolvedValueOnce(summary);

    const { result } = renderHook(() => useEventsSummary(2));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockEventsApi.getEventsSummary).toHaveBeenCalledWith(2);
    expect(result.current.byLotId).toEqual({ G7: 2, G10: 0 });
    expect(result.current.summaryByLotId.G7).toEqual(summary[0]);
    expect(result.current.error).toBeNull();
  });

  it('captures errors without throwing', async () => {
    mockEventsApi.getEventsSummary.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useEventsSummary(2));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.byLotId).toEqual({});
  });

  it('refetches on the configured interval without flipping loading', async () => {
    mockEventsApi.getEventsSummary.mockResolvedValue(summary);

    const { result } = renderHook(() => useEventsSummary(2, 60_000));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockEventsApi.getEventsSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    await waitFor(() =>
      expect(mockEventsApi.getEventsSummary).toHaveBeenCalledTimes(2),
    );
    expect(result.current.loading).toBe(false);
  });
});
