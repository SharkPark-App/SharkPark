// src/transit/passio-websocket.service.spec.ts
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { PassioWebSocketService } from './passio-websocket.service';
import { ShuttleTrackerGateway } from './shuttle-tracker.gateway';

// Mock ws
jest.mock('ws');

describe('PassioWebSocketService', () => {
  let service: PassioWebSocketService;
  let gateway: jest.Mocked<ShuttleTrackerGateway>;
  let wsInstanceMock: any;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Mock websocket
    wsInstanceMock = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn(),
      removeAllListeners: jest.fn(),
      readyState: 1, // Open
    };

    (WebSocket as unknown as jest.Mock).mockImplementation(() => wsInstanceMock);

    // Mock gateway
    const mockGateway = {
      broadcastShuttles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PassioWebSocketService,
        { provide: ShuttleTrackerGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<PassioWebSocketService>(PassioWebSocketService);
    gateway = module.get(ShuttleTrackerGateway);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // Helper to extract and trigger a registered socket event listener
  const triggerWsEvent = (eventName: string, ...args: any[]) => {
    const call = wsInstanceMock.on.mock.calls.find((c: any) => c[0] === eventName);
    if (call && call[1]) {
      call[1](...args);
    } else {
      throw new Error(`No listener registered for WebSocket event: ${eventName}`);
    }
  };

  // Wait for DTO validation (microtask) + batch window to flush
  const waitForBatch = () => new Promise<void>((resolve) => setTimeout(resolve, 300));

  describe('Initialization & Connection', () => {
    it('should connect to PassioGO WebSocket on module init', () => {
      service.onModuleInit();

      expect(WebSocket).toHaveBeenCalledWith('wss://passio3.com/');
      expect(wsInstanceMock.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(wsInstanceMock.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(wsInstanceMock.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(wsInstanceMock.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should send the handshake payload when the connection opens', () => {
      service.onModuleInit();

      // Simulate open event
      triggerWsEvent('open');

      expect(wsInstanceMock.send).toHaveBeenCalledTimes(1);
      // Verify essential props are present
      const sentPayload = JSON.parse(wsInstanceMock.send.mock.calls[0][0]);
      expect(sentPayload.subscribe).toBe('location');
      expect(sentPayload.userId).toContain(4163);
      expect(sentPayload.field).toContain('latitude');
    });

    it('should not send handshake if socket is not OPEN', () => {
      service.onModuleInit();
      wsInstanceMock.readyState = 0; // CONNECTING

      triggerWsEvent('open');

      expect(wsInstanceMock.send).not.toHaveBeenCalled();
    });
  });

  describe('Message Handling (Telemetry Stream)', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should parse valid shuttle telemetry and broadcast to gateway after the batch window', async () => {
      jest.useRealTimers();
      const mockPayload = {
        busId: 15133,
        latitude: 33.785605,
        longitude: -118.136296,
        course: 310.2,
        paxLoad: 0,
        more: {},
      };

      triggerWsEvent('message', JSON.stringify(mockPayload));

      // Wait for DTO validation (microtask) + 200ms batch window
      await waitForBatch();

      expect(gateway.broadcastShuttles).toHaveBeenCalledTimes(1);
      expect(gateway.broadcastShuttles).toHaveBeenCalledWith([
        {
          id: '15133',
          latitude: 33.785605,
          longitude: -118.136296,
          heading: 310.2,
          paxLoad: 0,
        },
      ]);
    });

    it('should drop malformed live shuttle frames without broadcasting', async () => {
      jest.useRealTimers();
      const malformedPayload = {
        // busId is required as a number; sending a string should fail validation
        busId: 'not-a-number',
        latitude: 33.78,
        longitude: -118.13,
        course: 0,
        paxLoad: 0,
      };

      triggerWsEvent('message', JSON.stringify(malformedPayload));

      await waitForBatch();

      expect(gateway.broadcastShuttles).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Dropping malformed live shuttle frame from PassioGO!',
      );
    });

    it('should ignore empty payloads or keep-alive frames without broadcasting', () => {
      triggerWsEvent('message', JSON.stringify({}));
      expect(gateway.broadcastShuttles).not.toHaveBeenCalled();

      triggerWsEvent('message', 'null');
      expect(gateway.broadcastShuttles).not.toHaveBeenCalled();
    });

    it('should gracefully handle malformed JSON without crashing', () => {
      triggerWsEvent('message', 'NOT_VALID_JSON');

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to parse incoming WS message',
        expect.any(Error)
      );
      expect(gateway.broadcastShuttles).not.toHaveBeenCalled();
    });
  });

  describe('Batching', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should batch updates from multiple buses within the window into a single broadcast', async () => {
      jest.useRealTimers();
      const makePayload = (busId: number) =>
        JSON.stringify({ busId, latitude: 33.78, longitude: -118.13, course: 0, paxLoad: 0, more: {} });

      triggerWsEvent('message', makePayload(1));
      triggerWsEvent('message', makePayload(2));
      triggerWsEvent('message', makePayload(3));

      await waitForBatch();

      expect(gateway.broadcastShuttles).toHaveBeenCalledTimes(1);
      const emitted = gateway.broadcastShuttles.mock.calls[0][0] as any[];
      expect(emitted).toHaveLength(3);
      expect(emitted.map((u: any) => u.id)).toEqual(expect.arrayContaining(['1', '2', '3']));
    });

    it('should deduplicate updates for the same bus within the window, keeping the latest', async () => {
      jest.useRealTimers();
      const payload1 = JSON.stringify({ busId: 1, latitude: 33.78, longitude: -118.13, course: 0, paxLoad: 0, more: {} });
      const payload2 = JSON.stringify({ busId: 1, latitude: 33.79, longitude: -118.14, course: 90, paxLoad: 5, more: {} });

      triggerWsEvent('message', payload1);
      triggerWsEvent('message', payload2);

      await waitForBatch();

      expect(gateway.broadcastShuttles).toHaveBeenCalledTimes(1);
      const emitted = gateway.broadcastShuttles.mock.calls[0][0] as any[];
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ id: '1', latitude: 33.79, heading: 90, paxLoad: 5 });
    });
  });

  describe('Ping Keep-Alive', () => {
    it('should ping the WebSocket every 30 seconds after connection opens', () => {
      service.onModuleInit();
      triggerWsEvent('open');

      jest.advanceTimersByTime(30_000);
      expect(wsInstanceMock.ping).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(30_000);
      expect(wsInstanceMock.ping).toHaveBeenCalledTimes(2);
    });

    it('should stop pinging when the connection closes', () => {
      service.onModuleInit();
      triggerWsEvent('open');
      triggerWsEvent('close');

      jest.advanceTimersByTime(60_000);
      expect(wsInstanceMock.ping).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling & Reconnection', () => {
    let mathRandomSpy: jest.SpyInstance;

    beforeEach(() => {
      service.onModuleInit();
      (WebSocket as unknown as jest.Mock).mockClear();

      // Mock Math.random to return 0 to remove jitter
      mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
      mathRandomSpy.mockRestore();
    });

    it('should log errors and terminate the socket on "error" event', () => {
      const mockError = new Error('Network timeout');
      triggerWsEvent('error', mockError);

      expect(loggerErrorSpy).toHaveBeenCalledWith('PassioGo WebSocket error: Network timeout');
      expect(wsInstanceMock.terminate).toHaveBeenCalledTimes(1);
      expect(wsInstanceMock.close).not.toHaveBeenCalled();
    });

    it('should automatically attempt to reconnect 5 seconds after a "close" event', () => {
      triggerWsEvent('close');

      expect(loggerWarnSpy).toHaveBeenCalledWith('PassioGo WebSocket closed. Reconnect attempt queued...');
      expect(loggerWarnSpy).toHaveBeenCalledWith('WebSocket closed. Reconnecting in 5s...');

      // Connection should not exist yet
      expect(WebSocket).not.toHaveBeenCalled();
      jest.advanceTimersByTime(5000);

      expect(WebSocket).toHaveBeenCalledTimes(1);
      expect(WebSocket).toHaveBeenCalledWith('wss://passio3.com/');
    });

    it('should clear existing reconnect timers if multiple closes happen rapidly', () => {
      triggerWsEvent('close');
      jest.advanceTimersByTime(2000);

      triggerWsEvent('close'); // Should reset timer
      jest.advanceTimersByTime(3000);

      // No connection yet
      expect(WebSocket).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2000);
      expect(WebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup', () => {
    it('should clean up listeners and close socket on module destroy', () => {
      service.onModuleInit();
      service.onModuleDestroy();

      expect(wsInstanceMock.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(wsInstanceMock.close).toHaveBeenCalledTimes(1);

      // Expect nullification
      expect(service['ws']).toBeNull();
    });
  });
});
