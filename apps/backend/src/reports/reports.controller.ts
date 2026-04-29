import { Controller, Post, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { User } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user: User; 
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() createReportDto: CreateReportDto) {
    const report = await this.reportsService.createReport(createReportDto, req.user);
    
    return {
      id: report.id,
      created_at: report.created_at,
    };
  }
}