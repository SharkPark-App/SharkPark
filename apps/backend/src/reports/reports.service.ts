import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportType } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReport(dto: CreateReportDto) {
    const typeMapping: Record<string, ReportType> = {
      blockage: ReportType.BLOCKAGE,
      crash: ReportType.CRASH,
      other: ReportType.OTHER,
    };

    // Relate lotId (e.g. 'G2') to lot DB cuid
    const lot = await this.prisma.lot.findFirst({
      where: { lot_id: dto.lotId },
      select: { id: true },
    });

    if (!lot) {
      throw new NotFoundException(`Parking lot '${dto.lotId}' not found.`);
    }

    return await this.prisma.report.create({
      data: {
        lot_id: dto.lotId,
        type: typeMapping[dto.type],
        message: dto.message?.trim() || null,
      },
    });
  }
}