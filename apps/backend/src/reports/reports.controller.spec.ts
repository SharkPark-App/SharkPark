/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { CreateReportDto, IncidentType } from './dto/create-report.dto';
import { AzureAdGuard } from '../auth/azure-ad.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { NotFoundException } from '@nestjs/common';

describe('ReportsController', () => {
  let controller: ReportsController;
  let service: jest.Mocked<ReportsService>;

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
    // Override guards
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
      lotId: 'G1',
      type: IncidentType.OTHER,
      message: 'Tree branch blocking entrance',
    };

    it('should create a report successfully', async () => {
      // Cast as any to satisfy signature (value gets dropped anyway)
      service.createReport.mockResolvedValue({
        id: 'cuid123',
        lot_id: 'db-cuid-456',
        type: 'OTHER',
        message: 'Tree branch blocking entrance',
        created_at: new Date(),
      } as any);

      const result = await controller.create(validDto);

      expect(result).toEqual({ success: true });
      expect(service.createReport).toHaveBeenCalledTimes(1);
      expect(service.createReport).toHaveBeenCalledWith(validDto);
    });

    it('should propagate NotFoundException if service cannot find the lot', async () => {
      service.createReport.mockRejectedValue(
        new NotFoundException("Parking lot 'G1' not found.")
      );

      await expect(controller.create(validDto)).rejects.toThrow(NotFoundException);
      expect(service.createReport).toHaveBeenCalledWith(validDto);
    });

    it('should propagate generic errors from the service', async () => {
      service.createReport.mockRejectedValue(new Error('Database connection failed'));

      await expect(controller.create(validDto)).rejects.toThrow('Database connection failed');
      expect(service.createReport).toHaveBeenCalledWith(validDto);
    });
  });
});