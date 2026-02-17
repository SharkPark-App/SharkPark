import { Test, TestingModule } from '@nestjs/testing';
import { OccupancyEventsService } from './occupancy-events.service';
import { DYNAMODB_CLIENT, TABLE_NAME, TIMESERIES_TABLE_NAME } from '../database/database.module';
import { ReliabilityService } from '../reliability/reliability.service';

describe('OccupancyEventsService', () => {
  let service: OccupancyEventsService;
  let mockDynamoClient: {
    send: jest.Mock;
  };
  let mockReliabilityService: {
    computeReliabilitySummary: jest.Mock;
  };

  const mockTableName = 'sharkpark-main';
  const mockTimeseriesTableName = 'sharkpark-timeseries';

  beforeEach(async () => {
    mockDynamoClient = {
      send: jest.fn(),
    };

    mockReliabilityService = {
      computeReliabilitySummary: jest.fn().mockReturnValue({
        lotId: 'test-lot',
        score: 50,
        confidence: 'MEDIUM',
        isColdStart: false,
        computedAt: new Date().toISOString(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OccupancyEventsService,
        { provide: DYNAMODB_CLIENT, useValue: mockDynamoClient },
        { provide: TABLE_NAME, useValue: mockTableName },
        { provide: TIMESERIES_TABLE_NAME, useValue: mockTimeseriesTableName },
        { provide: ReliabilityService, useValue: mockReliabilityService },
      ],
    }).compile();

    service = module.get<OccupancyEventsService>(OccupancyEventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const validDto = {
      lot_id: 'G1',
      event_type: 'ENTER' as const,
      device_id: 'test-device-123',
      timestamp: '2026-02-07T14:30:00.000Z',
    };

    it('should create an event and update occupancy for ENTER', async () => {
      // Mock: no duplicate found
      mockDynamoClient.send
        .mockResolvedValueOnce({ Item: null }) // checkDuplicate - GetItem
        .mockResolvedValueOnce({}) // PutItem - store event
        .mockResolvedValueOnce({}) // UpdateItem - update occupancy
        .mockResolvedValueOnce({}); // PutItem - update device last event

      const result = await service.create(validDto);

      expect(result.lot_id).toBe('G1');
      expect(result.event_type).toBe('ENTER');
      expect(result.deduplicated).toBe(false);
      expect(result.event_id).toBeDefined();
      expect(mockDynamoClient.send).toHaveBeenCalledTimes(4);
    });

    it('should create an event and decrement occupancy for EXIT', async () => {
      const exitDto = { ...validDto, event_type: 'EXIT' as const };

      mockDynamoClient.send
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result = await service.create(exitDto);

      expect(result.event_type).toBe('EXIT');
      expect(result.deduplicated).toBe(false);
    });

    it('should return deduplicated=true when duplicate detected', async () => {
      // Mock: duplicate found (same event type as last)
      mockDynamoClient.send.mockResolvedValueOnce({
        Item: {
          PK: { S: 'DEVICE#hash' },
          SK: { S: 'LOT#G1' },
          last_event_type: { S: 'ENTER' },
        },
      });

      const result = await service.create(validDto);

      expect(result.deduplicated).toBe(true);
      expect(mockDynamoClient.send).toHaveBeenCalledTimes(1); // Only the check call
    });

    it('should handle device hash consistently', async () => {
      mockDynamoClient.send
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result1 = await service.create(validDto);

      mockDynamoClient.send
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result2 = await service.create(validDto);

      // Same device should produce same behavior
      expect(result1.lot_id).toBe(result2.lot_id);
    });

    it('should throw InternalServerErrorException on DynamoDB error', async () => {
      mockDynamoClient.send
        .mockResolvedValueOnce({ Item: null })
        .mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(service.create(validDto)).rejects.toThrow('Failed to record occupancy event');
    });

    it('should handle ConditionalCheckFailedException on EXIT when occupancy is 0', async () => {
      const exitDto = { ...validDto, event_type: 'EXIT' as const };

      const conditionalError = new Error('Condition not met');
      (conditionalError as Error & { name: string }).name = 'ConditionalCheckFailedException';

      mockDynamoClient.send
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(conditionalError)
        .mockResolvedValueOnce({});

      // Should not throw, just log warning
      const result = await service.create(exitDto);
      expect(result.deduplicated).toBe(false);
    });
  });

  describe('findByLot', () => {
    it('should return events for a lot within date range', async () => {
      const mockEvents = [
        { PK: 'LOT#G1', SK: 'EVENT#2026-02-07T10:00:00Z#123', event_type: 'ENTER' },
        { PK: 'LOT#G1', SK: 'EVENT#2026-02-07T12:00:00Z#456', event_type: 'EXIT' },
      ];

      mockDynamoClient.send.mockResolvedValueOnce({
        Items: mockEvents.map(e => ({
          PK: { S: e.PK },
          SK: { S: e.SK },
          event_type: { S: e.event_type },
        })),
      });

      const result = await service.findByLot('G1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(result).toHaveLength(2);
      expect(result[0].event_type).toBe('ENTER');
      expect(result[1].event_type).toBe('EXIT');
    });

    it('should return empty array when no events found', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({ Items: [] });

      const result = await service.findByLot('G1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(result).toEqual([]);
    });

    it('should throw InternalServerErrorException on error', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('Query failed'));

      await expect(service.findByLot('G1', '2026-02-07', '2026-02-07T23:59:59Z'))
        .rejects.toThrow('Failed to fetch events for lot G1');
    });
  });

  describe('getEventStats', () => {
    it('should calculate correct statistics', async () => {
      const mockEvents = [
        { PK: { S: 'LOT#G1' }, event_type: { S: 'ENTER' } },
        { PK: { S: 'LOT#G1' }, event_type: { S: 'ENTER' } },
        { PK: { S: 'LOT#G1' }, event_type: { S: 'EXIT' } },
      ];

      mockDynamoClient.send.mockResolvedValueOnce({ Items: mockEvents });

      const stats = await service.getEventStats('G1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(stats.total_enters).toBe(2);
      expect(stats.total_exits).toBe(1);
      expect(stats.net_change).toBe(1);
    });

    it('should handle empty events', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({ Items: [] });

      const stats = await service.getEventStats('G1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(stats.total_enters).toBe(0);
      expect(stats.total_exits).toBe(0);
      expect(stats.net_change).toBe(0);
    });
  });

  describe('createSnapshots', () => {
    it('should create snapshots for all lots', async () => {
      const mockLots = [
        { lot_id: 'G1', current_occupancy: 50, capacity: 100, penetration_rate: 0.8 },
        { lot_id: 'E7', current_occupancy: 30, capacity: 80, penetration_rate: 0.5 },
      ];

      mockDynamoClient.send
        .mockResolvedValueOnce({
          Items: mockLots.map(lot => ({
            lot_id: { S: lot.lot_id },
            current_occupancy: { N: String(lot.current_occupancy) },
            capacity: { N: String(lot.capacity) },
            penetration_rate: { N: String(lot.penetration_rate) },
          })),
        })
        .mockResolvedValue({}); // PutItem calls

      const result = await service.createSnapshots();

      expect(result.count).toBe(2);
      expect(result.timestamp).toBeDefined();
    });

    it('should determine confidence based on penetration rate', async () => {
      const mockLots = [
        { lot_id: 'G1', current_occupancy: 50, capacity: 100, penetration_rate: 0.8 }, // HIGH
        { lot_id: 'E7', current_occupancy: 30, capacity: 80, penetration_rate: 0.5 },  // MEDIUM
        { lot_id: 'F3', current_occupancy: 20, capacity: 60, penetration_rate: 0.2 },  // LOW
      ];

      mockDynamoClient.send
        .mockResolvedValueOnce({
          Items: mockLots.map(lot => ({
            lot_id: { S: lot.lot_id },
            current_occupancy: { N: String(lot.current_occupancy) },
            capacity: { N: String(lot.capacity) },
            penetration_rate: { N: String(lot.penetration_rate) },
          })),
        })
        .mockResolvedValue({});

      const result = await service.createSnapshots();
      expect(result.count).toBe(3);
    });

    it('should throw InternalServerErrorException on error', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('Query failed'));

      await expect(service.createSnapshots()).rejects.toThrow('Failed to create occupancy snapshots');
    });
  });

  describe('getSnapshots', () => {
    it('should return snapshots for a lot on a specific date', async () => {
      const mockSnapshots = [
        { PK: 'LOT#G1#2026-02-07', SK: 'SNAPSHOT#2026-02-07T10:00:00Z', occupancy: 50 },
        { PK: 'LOT#G1#2026-02-07', SK: 'SNAPSHOT#2026-02-07T10:15:00Z', occupancy: 52 },
      ];

      mockDynamoClient.send.mockResolvedValueOnce({
        Items: mockSnapshots.map(s => ({
          PK: { S: s.PK },
          SK: { S: s.SK },
          occupancy: { N: String(s.occupancy) },
        })),
      });

      const result = await service.getSnapshots('G1', '2026-02-07');

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no snapshots found', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({ Items: [] });

      const result = await service.getSnapshots('G1', '2026-02-07');

      expect(result).toEqual([]);
    });

    it('should throw InternalServerErrorException on error', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('Query failed'));

      await expect(service.getSnapshots('G1', '2026-02-07'))
        .rejects.toThrow('Failed to fetch snapshots for lot G1');
    });
  });
});
