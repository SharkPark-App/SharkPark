import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { LotsService } from './lots.service';
import { PrismaService } from '../database/database.module';

describe('LotsService', () => {
  let service: LotsService;
  let prisma: {
    lot: { findMany: jest.Mock; findFirst: jest.Mock };
    occupancySnapshot: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      lot: { findMany: jest.fn(), findFirst: jest.fn() },
      occupancySnapshot: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LotsService>(LotsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    const mockLot = {
      id: 'uuid-1',
      lot_id: 'G1',
      lot_name: 'Lot G1',
      capacity: 100,
      current_occupancy: 50,
      lot_type: 'STUDENT',
      permit_types: ['Gold'],
      daily_permit_allowed: true,
      ev_charging_stations: 2,
      school_id: 'school-1',
      penetration_rate: 0.65,
      latitude: 33.78,
      longitude: -118.11,
      geofence_coordinates: [],
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('should return all parking lots', async () => {
      prisma.lot.findMany.mockResolvedValue([mockLot]);

      const result = await service.findAll();

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].lot_id).toBe('G1');
      expect(result[0].available).toBe(50);
      expect(result[0].occupancy_rate).toBeDefined();
    });

    it('should return empty array when no lots exist', async () => {
      prisma.lot.findMany.mockResolvedValue([]);
      const result = await service.findAll();
      expect(result).toEqual([]);
    });

    it('should pass type filter to Prisma', async () => {
      prisma.lot.findMany.mockResolvedValue([]);
      await service.findAll({ type: 'STUDENT' });
      expect(prisma.lot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lot_type: 'STUDENT' }),
        }),
      );
    });

    it('should filter by available_only after fetch', async () => {
      const fullLot = { ...mockLot, current_occupancy: 100 };
      prisma.lot.findMany.mockResolvedValue([mockLot, fullLot]);
      const result = await service.findAll({ available_only: true });
      expect(result).toHaveLength(1);
      expect(result[0].lot_id).toBe('G1');
    });

    it('should throw InternalServerErrorException on error', async () => {
      prisma.lot.findMany.mockRejectedValue(new Error('DB error'));
      await expect(service.findAll()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('findOne', () => {
    it('should return a parking lot by lot_id', async () => {
      const mockLot = {
        id: 'uuid-1', lot_id: 'G1', lot_name: 'Lot G1', capacity: 100,
        current_occupancy: 50, lot_type: 'STUDENT', permit_types: [],
        daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
        penetration_rate: 0.5, latitude: 33.78, longitude: -118.11,
        geofence_coordinates: [], created_at: new Date(), updated_at: new Date(),
      };
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      const result = await service.findOne('G1');
      expect(result).toBeDefined();
      expect(result.lot_id).toBe('G1');
      expect(prisma.lot.findFirst).toHaveBeenCalledWith({ where: { lot_id: 'G1' } });
    });

    it('should throw NotFoundException when lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);
      await expect(service.findOne('INVALID')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHistory', () => {
    it('should return occupancy snapshots for a lot on a date', async () => {
      const mockLot = { id: 'uuid-1', lot_id: 'G1' };
      const mockSnapshots = [
        { lot_id: 'uuid-1', timestamp: new Date('2026-02-07T10:00:00Z'), occupancy: 50, available: 50, occupancy_rate: 0.5, confidence: 'HIGH' },
        { lot_id: 'uuid-1', timestamp: new Date('2026-02-07T10:15:00Z'), occupancy: 52, available: 48, occupancy_rate: 0.52, confidence: 'HIGH' },
      ];
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancySnapshot.findMany.mockResolvedValue(mockSnapshots);
      const result = await service.getHistory('G1', '2026-02-07');
      expect(result).toHaveLength(2);
      expect(result[0].lot_id).toBe('G1');
    });

    it('should throw NotFoundException when lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);
      await expect(service.getHistory('INVALID', '2026-02-07')).rejects.toThrow(NotFoundException);
    });
  });
});
