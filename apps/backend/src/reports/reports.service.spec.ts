import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { PrismaService } from '../database/database.module';
import { CreateReportDto, IncidentType } from './dto/create-report.dto';
import { ReportType, User } from '@prisma/client';

describe('ReportsService', () => {
  let service: ReportsService;
  
  // Mock lot & report
  let prisma: {
    lot: { findUnique: jest.Mock };
    report: { create: jest.Mock };
  };

  const mockUser = { id: 'cuid-user-420', email: 'test@csulb.edu' } as User;

  beforeEach(async () => {
    prisma = {
      lot: { findUnique: jest.fn() },
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
      lotId: 'cm0abc1230000xyz',
      type: IncidentType.OTHER,
      message: '  I do not feel like parking  ', // Added padding for .trim()
    };

    const mockLot = { id: 'cm0abc1230000xyz' };

    it('should create a report successfully and link the user', async () => {
      prisma.lot.findUnique.mockResolvedValue(mockLot);
      prisma.report.create.mockResolvedValue({
        id: 'cuid-report-67890',
        lot_id: mockLot.id,
        user_id: mockUser.id,
        type: ReportType.OTHER,
        message: 'I do not feel like parking',
        created_at: new Date(),
      });

      const result = await service.createReport(validDto, mockUser);

      // Verify lot lookup call
      expect(prisma.lot.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.lot.findUnique).toHaveBeenCalledWith({
        where: { id: 'cm0abc1230000xyz' },
        select: { id: true },
      });

      // Verify payload format
      expect(prisma.report.create).toHaveBeenCalledTimes(1);
      expect(prisma.report.create).toHaveBeenCalledWith({
        data: {
          lot_id: mockLot.id,
          user_id: mockUser.id,
          type: ReportType.OTHER,
          message: 'I do not feel like parking',
        },
      });

      // Verify returned report
      expect(result.id).toBe('cuid-report-67890');
    });

    it('should create a report with a null message if message is omitted', async () => {
      const dtoWithoutMessage = { ...validDto, message: undefined };
      
      prisma.lot.findUnique.mockResolvedValue(mockLot);
      prisma.report.create.mockResolvedValue({ id: 'report-1' });

      await service.createReport(dtoWithoutMessage, mockUser);

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ message: null }),
      });
    });

    it('should create a report with a null message if message is only whitespace', async () => {
      const dtoWithWhitespace = { ...validDto, message: '   ' };
      
      prisma.lot.findUnique.mockResolvedValue(mockLot);
      prisma.report.create.mockResolvedValue({ id: 'report-1' });

      await service.createReport(dtoWithWhitespace, mockUser);

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          message: null,
        }),
      });
    });

    it('should throw NotFoundException if the lot does not exist', async () => {
      prisma.lot.findUnique.mockResolvedValue(null);

      await expect(service.createReport(validDto, mockUser)).rejects.toThrow(NotFoundException);
      expect(prisma.report.create).not.toHaveBeenCalled();
    });
  });
});