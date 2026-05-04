import { Test, TestingModule } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

describe('EventsController', () => {
  let controller: EventsController;
  let service: EventsService;

  const mockEventsService = {
    getEventsForLot: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventsService, useValue: mockEventsService }],
    }).compile();

    controller = module.get<EventsController>(EventsController);
    service = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getEventsForLot', () => {
    it('should return events for the given lot', async () => {
      const mockEvents = [
        { id: 'ev-1', event_name: 'Basketball Game', location: 'The Pyramid' },
      ];
      mockEventsService.getEventsForLot.mockResolvedValue(mockEvents);

      const result = await controller.getEventsForLot('G1');

      expect(result).toEqual({ success: true, count: 1, data: mockEvents });
      expect(service.getEventsForLot).toHaveBeenCalledWith('G1');
    });

    it('should return empty data when no events match', async () => {
      mockEventsService.getEventsForLot.mockResolvedValue([]);

      const result = await controller.getEventsForLot('G1');

      expect(result).toEqual({ success: true, count: 0, data: [] });
    });
  });
});
