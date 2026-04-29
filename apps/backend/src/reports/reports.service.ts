import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { CreateReportDto } from './dto/create-report.dto';
import { Report, ReportType, User } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}
    
  async createReport(dto: CreateReportDto, user: User): Promise<Report> {
    const lot = await this.prisma.lot.findUnique({
      where: { id: dto.lotId },
      select: { id: true },
    });

    if (!lot) {
      throw new NotFoundException(`Parking lot '${dto.lotId}' not found.`);
    }
    
    return await this.prisma.report.create({
      data: {
        lot_id: dto.lotId,
        user_id: user.id,
        type: dto.type.toUpperCase() as ReportType,
        message: dto.message?.trim() || null,
      },
    });
  }
}