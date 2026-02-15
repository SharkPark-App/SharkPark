import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DynamoDBClient, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { ReliabilityComputationService } from './reliability-computation.service';
import { ReliabilityService } from './reliability.service';
import { DYNAMODB_CLIENT, TABLE_NAME, TIMESERIES_TABLE_NAME } from '../database/database.module';

describe('ReliabilityComputationService', () => {
  let service: ReliabilityComputationService;
  let dynamoClient: jest.Mocked<DynamoDBClient>;
  let reliabilityService: jest.Mocked<ReliabilityService>;

  const mockLotMetadata = {
    PK: 'LOT#G1',
    SK: 'METADATA',
    lot_id: 'G1',
    lot_name: 'Lot G1',
    capacity: 100,
    penetration_rate: 0.65,
    EntityType: 'ParkingLot',
  };

  const mockEvents = [
    {
      PK: 'LOT#G1',
      SK: 'EVENT#2026-02-14T19:30:00.000Z',
      device_hash: 'hash1',
      event_type: 'ENTER',
      timestamp: '2026-02-14T19:30:00.000Z',
    },
    {
      PK: 'LOT#G1',
      SK: 'EVENT#2026-02-14T19:45:00.000Z',
      device_hash: 'hash2',
      event_type: 'ENTER',
      timestamp: '2026-02-14T19:45:00.000Z',
    },
    {
      PK: 'LOT#G1',
      SK: 'EVENT#2026-02-14T19:55:00.000Z',
      device_hash: 'hash1',
      event_type: 'EXIT',
      timestamp: '2026-02-14T19:55:00.000Z',
    },
  ];

  const mockReliabilityScore = {
    lotId: 'G1',
    score: 75,
    confidence: 'HIGH' as const,
    isColdStart: false,
    computedAt: '2026-02-14T20:00:00.000Z',
    explanation: 'High confidence',
    factors: {
      penetrationRate: { name: 'penetrationRate', rawValue: 0.65, normalizedValue: 0.87, weight: 0.35, weightedScore: 30.45 },
      dataFreshness: { name: 'dataFreshness', rawValue: 5, normalizedValue: 0.83, weight: 0.25, weightedScore: 20.75 },
      eventFrequency: { name: 'eventFrequency', rawValue: 3, normalizedValue: 0.1, weight: 0.2, weightedScore: 2 },
      sampleSize: { name: 'sampleSize', rawValue: 2, normalizedValue: 0.2, weight: 0.15, weightedScore: 3 },
      historicalAccuracy: { name: 'historicalAccuracy', rawValue: 0.5, normalizedValue: 0.5, weight: 0.05, weightedScore: 2.5 },
    },
  };

  const mockScoreSummary = {
    lotId: 'G1',
    score: 75,
    confidence: 'HIGH' as const,
    isColdStart: false,
    computedAt: '2026-02-14T20:00:00.000Z',
  };

  beforeEach(async () => {
    const mockDynamoClient = {
      send: jest.fn(),
    };

    const mockReliabilityService = {
      computeReliability: jest.fn().mockReturnValue(mockReliabilityScore),
      computeReliabilitySummary: jest.fn().mockReturnValue(mockScoreSummary),
      getDefaultWeights: jest.fn(),
      getDefaultThresholds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReliabilityComputationService,
        { provide: DYNAMODB_CLIENT, useValue: mockDynamoClient },
        { provide: TABLE_NAME, useValue: 'sharkpark-main' },
        { provide: TIMESERIES_TABLE_NAME, useValue: 'sharkpark-timeseries' },
        { provide: ReliabilityService, useValue: mockReliabilityService },
      ],
    }).compile();

    service = module.get<ReliabilityComputationService>(ReliabilityComputationService);
    dynamoClient = module.get(DYNAMODB_CLIENT);
    reliabilityService = module.get(ReliabilityService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computeReliabilityForLot', () => {
    it('should compute reliability score for a valid lot', async () => {
      // Mock GetItemCommand for lot metadata
      dynamoClient.send.mockImplementation((command) => {
        if (command instanceof GetItemCommand) {
          return Promise.resolve({ Item: marshall(mockLotMetadata) });
        }
        if (command instanceof QueryCommand) {
          return Promise.resolve({ Items: mockEvents.map(e => marshall(e)) });
        }
        return Promise.resolve({});
      });

      const result = await service.computeReliabilityForLot('G1');

      expect(result).toEqual(mockReliabilityScore);
      expect(reliabilityService.computeReliability).toHaveBeenCalledWith('G1', expect.objectContaining({
        penetrationRate: 0.65,
        eventsInLastHour: expect.any(Number),
        minutesSinceLastEvent: expect.any(Number),
        uniqueDevicesInLastHour: expect.any(Number),
        historicalAccuracy: null,
      }));
    });

    it('should throw NotFoundException for non-existent lot', async () => {
      dynamoClient.send.mockImplementation((command) => {
        if (command instanceof GetItemCommand) {
          return Promise.resolve({ Item: undefined });
        }
        return Promise.resolve({});
      });

      await expect(service.computeReliabilityForLot('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('should handle lot with no recent events', async () => {
      dynamoClient.send.mockImplementation((command) => {
        if (command instanceof GetItemCommand) {
          return Promise.resolve({ Item: marshall(mockLotMetadata) });
        }
        if (command instanceof QueryCommand) {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      });

      await service.computeReliabilityForLot('G1');

      expect(reliabilityService.computeReliability).toHaveBeenCalledWith('G1', expect.objectContaining({
        eventsInLastHour: 0,
        uniqueDevicesInLastHour: 0,
      }));
    });

    it('should calculate unique devices correctly', async () => {
      const eventsWithDuplicateDevices = [
        { ...mockEvents[0], device_hash: 'same-hash' },
        { ...mockEvents[1], device_hash: 'same-hash' },
        { ...mockEvents[2], device_hash: 'different-hash' },
      ];

      dynamoClient.send.mockImplementation((command) => {
        if (command instanceof GetItemCommand) {
          return Promise.resolve({ Item: marshall(mockLotMetadata) });
        }
        if (command instanceof QueryCommand) {
          return Promise.resolve({ Items: eventsWithDuplicateDevices.map(e => marshall(e)) });
        }
        return Promise.resolve({});
      });

      await service.computeReliabilityForLot('G1');

      expect(reliabilityService.computeReliability).toHaveBeenCalledWith('G1', expect.objectContaining({
        uniqueDevicesInLastHour: 2,
      }));
    });
  });

  describe('computeReliabilityForAllLots', () => {
    it('should compute reliability for all lots', async () => {
      const allLots = [
        { ...mockLotMetadata, lot_id: 'G1' },
        { ...mockLotMetadata, lot_id: 'G2', PK: 'LOT#G2' },
      ];

      dynamoClient.send.mockImplementation((command) => {
        if (command instanceof QueryCommand) {
          const input = (command as QueryCommand).input;
          if (input.IndexName === 'GSI1-EntityType-Timestamp') {
            return Promise.resolve({ Items: allLots.map(l => marshall(l)) });
          }
          return Promise.resolve({ Items: [] });
        }
        if (command instanceof GetItemCommand) {
          return Promise.resolve({ Item: marshall(mockLotMetadata) });
        }
        return Promise.resolve({});
      });

      const result = await service.computeReliabilityForAllLots();

      expect(result).toHaveLength(2);
      expect(reliabilityService.computeReliabilitySummary).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no lots exist', async () => {
      dynamoClient.send.mockImplementation((command) => {
        if (command instanceof QueryCommand) {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      });

      const result = await service.computeReliabilityForAllLots();

      expect(result).toEqual([]);
    });

    it('should handle errors for individual lots gracefully', async () => {
      const allLots = [{ ...mockLotMetadata, lot_id: 'G1' }];

      dynamoClient.send.mockImplementation((command) => {
        if (command instanceof QueryCommand) {
          const input = (command as QueryCommand).input;
          if (input.IndexName === 'GSI1-EntityType-Timestamp') {
            return Promise.resolve({ Items: allLots.map(l => marshall(l)) });
          }
          return Promise.reject(new Error('DynamoDB error'));
        }
        return Promise.resolve({});
      });

      reliabilityService.computeReliabilitySummary.mockImplementation(() => {
        throw new Error('Computation failed');
      });

      const result = await service.computeReliabilityForAllLots();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        lotId: 'G1',
        score: 0,
        confidence: 'LOW',
        isColdStart: true,
      }));
    });
  });
});
