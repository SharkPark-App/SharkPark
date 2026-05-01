/**
 * Tests for useTransitData hook
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useTransitData } from '../src/hooks/useTransitData';
import { TransitService } from '../src/services/api/transit';
import { io } from 'socket.io-client'

jest.mock('socket.io-client');
jest.mock('../src/services/api/transit');

const mockIo = io as jest.Mock;
const mockTransitService = TransitService as jest.Mocked<typeof TransitService>;

describe('useTransitData hook', () => {
  const mockRoutes = [{ id: 'r1', name: 'Route One', shortName: 'R1', color: '#00ff00', status: 'On Time', coordinates: [] }];
  const mockStops = [{ id: 's1', name: 'Student Union', latitude: 33.0, longitude: -118.0, routeId: 'r1', color: '#00ff00' }];
  const mockShuttles = [
    { id: 'sh1', busName: 'Shuttle 1', color: '#ff0000', routeId: 'r1', route: 'Route One', latitude: 33.0, longitude: -118.0, heading: 0, paxLoad: 0, capacity: 30 }
  ];

  // Mock socket object
  let socketHandlers: Record<string, (data: any) => void> = {};
  const mockSocket = {
    on: jest.fn((event, handler) => {
      socketHandlers[event] = handler;
    }),
    disconnect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    socketHandlers = {};
    mockIo.mockReturnValue(mockSocket);

    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initial Load', () => {
    it('fetches static data and initial shuttle state on mount', async () => {
      mockTransitService.getRoutesAndStops.mockResolvedValueOnce({ routes: mockRoutes, stops: mockStops });
      mockTransitService.getLiveShuttles.mockResolvedValueOnce(mockShuttles as any);

      const { result } = renderHook(() => useTransitData());

      await waitFor(() => {
        expect(result.current.shuttles).toEqual(mockShuttles);
      });

      expect(mockTransitService.getRoutesAndStops).toHaveBeenCalled();
      expect(mockTransitService.getLiveShuttles).toHaveBeenCalledTimes(1);
    });

    it('handles HTTP fetch errors gracefully without crashing', async () => {
      mockTransitService.getRoutesAndStops.mockRejectedValueOnce(new Error('Network failure'));
      mockTransitService.getLiveShuttles.mockRejectedValueOnce(new Error('Network failure'));

      const { result } = renderHook(() => useTransitData());

      await waitFor(() => {
        // State should remain as safe empty arrays
        expect(result.current.routes).toEqual([]);
        expect(result.current.shuttles).toEqual([]);
      });

      expect(console.error).toHaveBeenCalledTimes(2);
    });
  });

  describe('Live Socket Updates', () => {
    it('merges lightweight socket updates into existing shuttle state', async () => {
      mockTransitService.getRoutesAndStops.mockResolvedValueOnce({ routes: [], stops: [] });
      mockTransitService.getLiveShuttles.mockResolvedValueOnce(mockShuttles as any);

      const { result } = renderHook(() => useTransitData());

      await waitFor(() => {
        expect(result.current.shuttles[0].latitude).toBe(33.0);
      });

      const socketUpdate = [{
        id: 'sh1',
        latitude: 34.5,
        longitude: -119.0,
        heading: 180,
        paxLoad: 5
      }];

      act(() => {
        socketHandlers['shuttle_update'](socketUpdate);
      });

      expect(result.current.shuttles[0]).toMatchObject({
        id: 'sh1',
        color: '#ff0000', // Preserved from initial load
        latitude: 34.5,   // Updated from socket
        heading: 180      // Updated from socket
      });
    });

    it('disconnects socket on unmount', () => {
      mockTransitService.getRoutesAndStops.mockResolvedValueOnce({ routes: [], stops: [] });
      mockTransitService.getLiveShuttles.mockResolvedValueOnce([]);

      const { unmount } = renderHook(() => useTransitData());
      unmount();

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  it('inserts a placeholder for unknown shuttles and refreshes static metadata', async () => {
    mockTransitService.getRoutesAndStops.mockResolvedValueOnce({ routes: [], stops: [] });
    mockTransitService.getLiveShuttles.mockResolvedValueOnce(mockShuttles as any);

    const { result } = renderHook(() => useTransitData());

    await waitFor(() => {
      expect(result.current.shuttles).toHaveLength(1);
    });

    // A second call from the placeholder-triggered refresh
    mockTransitService.getLiveShuttles.mockResolvedValueOnce(mockShuttles as any);

    // Sending an ID ('sh999') that wasn't in mockShuttles
    const phantomUpdate = [{
      id: 'sh999',
      latitude: 50.0,
      longitude: -50.0,
      heading: 90,
      paxLoad: 7,
    }];

    act(() => {
      socketHandlers['shuttle_update'](phantomUpdate);
    });

    // Placeholder added so the unknown shuttle still renders on the map
    expect(result.current.shuttles).toHaveLength(2);
    expect(result.current.shuttles[1]).toMatchObject({
      id: 'sh999',
      busName: 'Shuttle',
      route: '',
      routeId: '',
      latitude: 50.0,
      longitude: -50.0,
      heading: 90,
      paxLoad: 7,
      capacity: 0,
    });

    // And we trigger a static-metadata refresh so the placeholder gets enriched
    await waitFor(() => {
      expect(mockTransitService.getLiveShuttles).toHaveBeenCalledTimes(2);
    });
  });

  it('logs a warning on socket connect_error', () => {
    mockTransitService.getRoutesAndStops.mockResolvedValueOnce({ routes: [], stops: [] });
    mockTransitService.getLiveShuttles.mockResolvedValueOnce([]);

    renderHook(() => useTransitData());

    act(() => {
      socketHandlers['connect_error'](new Error('Handshake failed'));
    });

    expect(console.warn).toHaveBeenCalledWith(
      '[useTransitData] Socket connection error:', 
      'Handshake failed'
    );
  });

  it('disconnects socket on unmount', () => {
    mockTransitService.getRoutesAndStops.mockResolvedValueOnce({ routes: [], stops: [] });
    mockTransitService.getLiveShuttles.mockResolvedValueOnce([]);

    const { unmount } = renderHook(() => useTransitData());
    unmount();

    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});