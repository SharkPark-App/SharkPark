// src/transit/shuttle-tracker.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ShuttleTrackerController } from './shuttle-tracker.controller';
import { ShuttleTrackerService } from './shuttle-tracker.service';

describe('ShuttleTrackerController', () => {
  let controller: ShuttleTrackerController;
  let service: jest.Mocked<ShuttleTrackerService>;

  beforeEach(async () => {
    // Mock the service methods used by the controller
    const mockService = {
      getCurrentShuttles: jest.fn(),
      getCurrentRoutes: jest.fn(),
      getCurrentStops: jest.fn(),
      getStopETAs: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShuttleTrackerController],
      providers: [
        { provide: ShuttleTrackerService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<ShuttleTrackerController>(ShuttleTrackerController);
    service = module.get(ShuttleTrackerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getShuttles', () => {
    it('should return a list of active shuttles', () => {
      const mockShuttles = [
        { id: '101', busName: 'Shuttle 101', latitude: 33.0, longitude: -118.0, heading: 90 },
        { id: '102', busName: 'Shuttle 102', latitude: 33.1, longitude: -118.1, heading: 180 },
      ];

      service.getCurrentShuttles.mockReturnValue(mockShuttles as any);

      const result = controller.getShuttles();

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.data).toEqual(mockShuttles);
      expect(service.getCurrentShuttles).toHaveBeenCalledTimes(1);
    });

    it('should handle an empty list of shuttles', () => {
      service.getCurrentShuttles.mockReturnValue([]);

      const result = controller.getShuttles();

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.data).toEqual([]);
    });
  });

  describe('getRoutes', () => {
    it('should return a list of current routes', () => {
      const mockRoutes = [
        { id: 'r1', name: 'Red Route', shortName: 'RD', color: '#FF0000', coordinates: [] },
      ];

      service.getCurrentRoutes.mockReturnValue(mockRoutes as any);

      const result = controller.getRoutes();

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.data).toEqual(mockRoutes);
      expect(service.getCurrentRoutes).toHaveBeenCalledTimes(1);
    });

    it('should handle an empty list of routes', () => {
      service.getCurrentRoutes.mockReturnValue([]);

      const result = controller.getRoutes();

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.data).toEqual([]);
    });
  });

  describe('getStops', () => {
    it('should return a list of current stops', () => {
      const mockStops = [
        { id: 's1', name: 'Main Station', routeId: 'r1', latitude: 33.1, longitude: -118.1 },
        { id: 's2', name: 'North Campus', routeId: 'r1', latitude: 33.2, longitude: -118.2 },
      ];

      service.getCurrentStops.mockReturnValue(mockStops as any);

      const result = controller.getStops();

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.data).toEqual(mockStops);
      expect(service.getCurrentStops).toHaveBeenCalledTimes(1);
    });

    it('should handle an empty list of stops', () => {
      service.getCurrentStops.mockReturnValue([]);

      const result = controller.getStops();

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.data).toEqual([]);
    });
  });

  describe('getETAs', () => {
    it('should return a list of ETAs for a specific stop', async () => {
      const stopId = 1001; // number — ParseIntPipe converts the route param before it reaches the handler
      const mockETAs = [
        { routeId: 'r1', routeName: 'Red Route', abbreviation: 'RD', color: '#FF0000', etaMinutes: 5 },
        { routeId: 'r2', routeName: 'Blue Route', abbreviation: 'BL', color: '#0000FF', etaMinutes: 12 },
      ];

      service.getStopETAs.mockResolvedValue(mockETAs);

      const result = await controller.getETAs(stopId);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.data).toEqual(mockETAs);
      expect(service.getStopETAs).toHaveBeenCalledWith('1001'); // handler converts number back to string
      expect(service.getStopETAs).toHaveBeenCalledTimes(1);
    });

    it('should return an empty list if there are no ETAs for the stop', async () => {
      const stopId = 9999;
      service.getStopETAs.mockResolvedValue([]);

      const result = await controller.getETAs(stopId);

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.data).toEqual([]);
      expect(service.getStopETAs).toHaveBeenCalledWith('9999');
    });
  });
});