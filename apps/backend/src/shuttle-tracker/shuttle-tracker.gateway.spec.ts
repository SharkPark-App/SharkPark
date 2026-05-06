// src/transit/shuttle-tracker.gateway.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ShuttleTrackerGateway } from './shuttle-tracker.gateway';

const makeClient = (token?: string): jest.Mocked<Partial<Socket>> => ({
  handshake: { auth: { token }, address: '127.0.0.1' } as unknown as Socket['handshake'],
  disconnect: jest.fn(),
});

describe('ShuttleTrackerGateway', () => {
  let gateway: ShuttleTrackerGateway;
  let mockServer: Partial<Server>;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockServer = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ShuttleTrackerGateway],
    }).compile();

    gateway = module.get<ShuttleTrackerGateway>(ShuttleTrackerGateway);
    gateway.server = mockServer as Server;

    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.WS_CONNECT_SECRET;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('afterInit', () => {
    it('should log a message when the gateway initializes', () => {
      gateway.afterInit();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Shuttle gateway initialized. Ready to broadcast to mobile clients.'
      );
    });
  });

  describe('handleConnection', () => {
    it('allows connection when WS_CONNECT_SECRET is not set (non-production)', () => {
      const client = makeClient(undefined);
      gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('rejects connection when WS_CONNECT_SECRET is not set in production', () => {
      const originalEnv = process.env.NODE_ENV;
      const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      process.env.NODE_ENV = 'production';
      try {
        const client = makeClient(undefined);
        gateway.handleConnection(client as unknown as Socket);
        expect(client.disconnect).toHaveBeenCalledWith(true);
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('WS_CONNECT_SECRET is not set in production'),
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
        loggerErrorSpy.mockRestore();
      }
    });

    it('allows connection with a valid token', () => {
      process.env.WS_CONNECT_SECRET = 'correct-secret';
      const client = makeClient('correct-secret');
      gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects client with an invalid token', () => {
      process.env.WS_CONNECT_SECRET = 'correct-secret';
      const client = makeClient('wrong-secret');
      gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects client with no token when secret is set', () => {
      process.env.WS_CONNECT_SECRET = 'correct-secret';
      const client = makeClient(undefined);
      gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('broadcastShuttles', () => {
    it('should emit the shuttle_update event to all connected clients', () => {
      // Mock data
      const mockShuttles = [
        { id: '101', latitude: 33.78, longitude: -118.11, heading: 90, paxLoad: 5 },
        { id: '102', latitude: 33.79, longitude: -118.12, heading: 180, paxLoad: 12 },
      ];

      gateway.broadcastShuttles(mockShuttles);

      // Expect correct socket.io broadcast to be triggered
      expect(mockServer.emit).toHaveBeenCalledTimes(1);
      expect(mockServer.emit).toHaveBeenCalledWith('shuttle_update', mockShuttles);
    });

    it('should handle broadcasting an empty array', () => {
      gateway.broadcastShuttles([]);

      expect(mockServer.emit).toHaveBeenCalledTimes(1);
      expect(mockServer.emit).toHaveBeenCalledWith('shuttle_update', []);
    });
  });
});