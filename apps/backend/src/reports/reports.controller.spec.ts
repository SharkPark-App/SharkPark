import { Test, TestingModule } from '@nestjs/testing';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { CreateReportDto, IncidentType } from './dto/create-report.dto';
import { AzureAdGuard } from '../auth/azure-ad.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';

describe('ReportsController', () => {
  let controller: ReportsController;
  let service: jest.Mocked<ReportsService>;

  const mockUser = { id: 'cuid-user-123', email: 'test@csulb.edu' } as User;
  const mockReq = { user: mockUser } as any;

  beforeEach(async () => {
    const mockService = {
      createReport: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: mockService },
      ],
    })
    .overrideGuard(AzureAdGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

    controller = module.get<ReportsController>(ReportsController);
    service = module.get(ReportsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const validDto: CreateReportDto = {
      lotId: 'cm0abc1230000xyz',
      type: IncidentType.OTHER,
      message: 'I do not feel like parking',
    };

    it('should create a report successfully', async () => {
      const mockDate = new Date();
      service.createReport.mockResolvedValue({
        id: 'cuid-report-123',
        lot_id: 'cm0abc1230000xyz',
        user_id: mockUser.id,
        type: 'OTHER',
        message: 'I do not feel like parking',
        created_at: mockDate,
      } as any);

      const result = await controller.create(mockReq, validDto);

      expect(result).toEqual({ 
        id: 'cuid-report-123', 
        created_at: mockDate 
      });
      expect(service.createReport).toHaveBeenCalledTimes(1);
      expect(service.createReport).toHaveBeenCalledWith(validDto, mockReq.user);
    });

    it('should propagate NotFoundException if service cannot find the lot', async () => {
      service.createReport.mockRejectedValue(
        new NotFoundException("Parking lot 'cm0abc1230000xyz' not found.")
      );

      await expect(controller.create(mockReq, validDto)).rejects.toThrow(NotFoundException);
      expect(service.createReport).toHaveBeenCalledWith(validDto, mockUser);
    });

    it('should propagate generic errors from the service', async () => {
      service.createReport.mockRejectedValue(new Error('Database connection failed'));

      await expect(controller.create(mockReq, validDto)).rejects.toThrow('Database connection failed');
      expect(service.createReport).toHaveBeenCalledWith(validDto, mockUser);
    });
  });
});