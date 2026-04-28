import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { PrismaService } from '../database/database.module';
import { CreateReportDto, IncidentType } from './dto/create-report.dto';
import { ReportType } from '@prisma/client';

describe('ReportsService', () => {
  let service: ReportsService;
  
  // Mock lot & report
  let prisma: {
    lot: { findFirst: jest.Mock };
    report: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      lot: { findFirst: jest.fn() },
      report: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createReport', () => {
    const validDto: CreateReportDto = {
      lotId: 'G2',
      type: IncidentType.OTHER,
      message: '  Tree branch blocking entrance  ', // Added padding for .trim()
    };

    const mockLot = {
      id: 'cuid-lot-12345',
    };

    it('should create a report successfully and map properties correctly', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.report.create.mockResolvedValue({
        id: 'cuid-report-67890',
        lot_id: mockLot.id,
        type: ReportType.BLOCKAGE,
        message: 'Tree branch blocking entrance',
        created_at: new Date(),
      });

      const result = await service.createReport(validDto);

      // Verify lot lookup call
      expect(prisma.lot.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.lot.findFirst).toHaveBeenCalledWith({
        where: { lot_id: 'G2' },
        select: { id: true },
      });

      // Verify payload format
      expect(prisma.report.create).toHaveBeenCalledTimes(1);
      expect(prisma.report.create).toHaveBeenCalledWith({
        data: {
          lot_id: mockLot.id,
          type: ReportType.OTHER,
          message: 'Tree branch blocking entrance',
        },
      });

      // Verify returned report
      expect(result.id).toBe('cuid-report-67890');
    });

    it('should create a report with a null message if message is omitted', async () => {
      const dtoWithoutMessage = { ...validDto, message: undefined };
      
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.report.create.mockResolvedValue({ id: 'report-1' });

      await service.createReport(dtoWithoutMessage);

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          message: null,
        }),
      });
    });

    it('should create a report with a null message if message is only whitespace', async () => {
      const dtoWithWhitespace = { ...validDto, message: '   ' };
      
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.report.create.mockResolvedValue({ id: 'report-1' });

      await service.createReport(dtoWithWhitespace);

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          message: null,
        }),
      });
    });

    it('should throw NotFoundException if the lot does not exist', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      await expect(service.createReport(validDto)).rejects.toThrow(NotFoundException);
      await expect(service.createReport(validDto)).rejects.toThrow("Parking lot 'G2' not found.");

      expect(prisma.report.create).not.toHaveBeenCalled();
    });
  });
});