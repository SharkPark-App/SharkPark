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
    report: { create: jest.Mock; updateMany: jest.Mock };
  };

  const mockUser = { id: 'cuid-user-420', email: 'test@csulb.edu' } as User;

  beforeEach(async () => {
    prisma = {
      lot: { findUnique: jest.fn() },
      report: { create: jest.fn(), updateMany: jest.fn() },
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

    it('censors profanity in the message before persistence', async () => {
      const dtoWithProfanity = { ...validDto, message: 'This guy is an asshole, blocking row B' };
      prisma.lot.findUnique.mockResolvedValue(mockLot);
      prisma.report.create.mockResolvedValue({ id: 'report-x' });

      await service.createReport(dtoWithProfanity, mockUser);

      const persisted = prisma.report.create.mock.calls[0][0].data.message as string;
      expect(persisted).not.toContain('asshole');
      expect(persisted).toContain('*');
      expect(persisted).toMatch(/blocking row B/);
    });

    it('truncates messages above the cap server-side as defense in depth', async () => {
      const longMessage = 'A'.repeat(5000);
      const dtoLong = { ...validDto, message: longMessage };
      prisma.lot.findUnique.mockResolvedValue(mockLot);
      prisma.report.create.mockResolvedValue({ id: 'report-y' });

      await service.createReport(dtoLong, mockUser);

      const persisted = prisma.report.create.mock.calls[0][0].data.message as string;
      expect(persisted.length).toBeLessThanOrEqual(500);
    });
  });

  describe('pruneOldMessages', () => {
    it('redacts messages on rows older than the retention window', async () => {
      prisma.report.updateMany.mockResolvedValue({ count: 7 });

      const result = await service.pruneOldMessages(90);

      expect(prisma.report.updateMany).toHaveBeenCalledTimes(1);
      const call = prisma.report.updateMany.mock.calls[0][0];
      expect(call.where.message).toEqual({ not: null });
      expect(call.where.created_at.lt).toBeInstanceOf(Date);
      expect(call.data).toEqual({ message: null });
      expect(result.messages_redacted).toBe(7);
      expect(result.cutoff).toMatch(/T/);
    });

    it('throws on a non-positive retention', async () => {
      await expect(service.pruneOldMessages(0)).rejects.toThrow(
        'pruneOldMessages: retentionDays must be >= 1',
      );
    });
  });
});