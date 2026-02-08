import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { LotsService } from './lots.service';

describe('LotsService', () => {
  let service: LotsService;

  const mockDynamoClient = {
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotsService,
        {
          provide: 'DYNAMODB_CLIENT',
          useValue: mockDynamoClient,
        },
        {
          provide: 'TABLE_NAME',
          useValue: 'sharkpark-main',
        },
        {
          provide: 'TIMESERIES_TABLE_NAME',
          useValue: 'sharkpark-timeseries',
        },
      ],
    }).compile();

    service = module.get<LotsService>(LotsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return all parking lots', async () => {
    const mockLots = {
      Items: [
        {
          lot_id: { S: 'G1' },
          lot_name: { S: 'Lot G1' },
          capacity: { N: '100' },
        },
      ],
    };

    mockDynamoClient.send.mockResolvedValueOnce(mockLots);

    const result = await service.findAll();

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  describe('recordOccupancyEvent', () => {
    it('should record an ENTER event and return event id', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({});

      const eventData = {
        lot_id: 'G1',
        event_type: 'ENTER' as const,
        source: 'geofencing',
        timestamp: '2026-02-06T10:30:00Z',
      };

      const result = await service.recordOccupancyEvent(eventData);

      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
      expect(result.id.length).toBeGreaterThan(0);
      expect(mockDynamoClient.send).toHaveBeenCalled();
    });

    it('should record an EXIT event and return event id', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({});

      const eventData = {
        lot_id: 'G1',
        event_type: 'EXIT' as const,
        source: 'geofencing',
        timestamp: '2026-02-06T11:00:00Z',
      };

      const result = await service.recordOccupancyEvent(eventData);

      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
    });

    it('should throw InternalServerErrorException when DynamoDB fails', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

      const eventData = {
        lot_id: 'G1',
        event_type: 'ENTER' as const,
        source: 'geofencing',
        timestamp: '2026-02-06T10:30:00Z',
      };

      await expect(service.recordOccupancyEvent(eventData)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
