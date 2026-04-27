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
  let loggerLogSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Mock websocket
    wsInstanceMock = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
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

    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
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

    it('should parse valid shuttle telemetry and broadcast to gateway', () => {
      const mockPayload = {
        busId: 15133,
        latitude: 33.785605,
        longitude: -118.136296,
        course: 310.2,
        paxLoad: 0,
        more: {},
      };

      // Simulate incoming stringified message
      triggerWsEvent('message', JSON.stringify(mockPayload));

      expect(gateway.broadcastShuttles).toHaveBeenCalledTimes(1);
      expect(gateway.broadcastShuttles).toHaveBeenCalledWith([
        {
          id: '15133', // Expect number->string conversion
          latitude: 33.785605,
          longitude: -118.136296,
          heading: 310.2, // Expect course->heading conversion
          paxLoad: 0,
        },
      ]);
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

  describe('Error Handling & Reconnection', () => {
    beforeEach(() => {
      service.onModuleInit();
      (WebSocket as unknown as jest.Mock).mockClear();
    });

    it('should log errors and close the socket on "error" event', () => {
      const mockError = new Error('Network timeout');
      triggerWsEvent('error', mockError);

      expect(loggerErrorSpy).toHaveBeenCalledWith('PassioGo WebSocket error: Network timeout');
      expect(wsInstanceMock.close).toHaveBeenCalledTimes(1);
    });

    it('should automatically attempt to reconnect 5 seconds after a "close" event', () => {
      triggerWsEvent('close');

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'PassioGo WebSocket closed. Attempting reconnect in 5 seconds...'
      );
      
      // Connection should not exist yet
      expect(WebSocket).not.toHaveBeenCalled();
      jest.advanceTimersByTime(5000); // 5 seconds

      // Connection should exist
      expect(WebSocket).toHaveBeenCalledTimes(1);
      expect(WebSocket).toHaveBeenCalledWith('wss://passio3.com/');
    });

    it('should clear existing reconnect timers if multiple closes happen rapidly', () => {
      triggerWsEvent('close');
      jest.advanceTimersByTime(2000); // 2s
      
      triggerWsEvent('close'); // Trigger close again
      jest.advanceTimersByTime(3000); // 5s from first event
      
      // No connection yet
      expect(WebSocket).not.toHaveBeenCalled();

      // 2nd event
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