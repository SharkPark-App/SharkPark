import { Test, TestingModule } from '@nestjs/testing';
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
});
