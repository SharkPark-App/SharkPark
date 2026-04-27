// src/transit/shuttle-tracker.gateway.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { ShuttleTrackerGateway } from './shuttle-tracker.gateway';

describe('ShuttleTrackerGateway', () => {
  let gateway: ShuttleTrackerGateway;
  let mockServer: Partial<Server>;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Mock Socket.IO Server
    mockServer = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ShuttleTrackerGateway],
    }).compile();

    gateway = module.get<ShuttleTrackerGateway>(ShuttleTrackerGateway);
    gateway.server = mockServer as Server;

    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
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

  describe('broadcastShuttles', () => {
    it('should emit the shuttle_update event to all connected clients', () => {
      // Mock data
      const mockShuttles = [
        { id: '101', latitude: 33.78, longitude: -118.11, heading: 90 },
        { id: '102', latitude: 33.79, longitude: -118.12, heading: 180 },
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