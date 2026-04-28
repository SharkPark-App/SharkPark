import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { AzureAdGuard } from '../auth/azure-ad.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @UseGuards(AzureAdGuard, ThrottlerGuard)
  async create(@Body() createReportDto: CreateReportDto) {
    await this.reportsService.createReport(createReportDto);
    return { success: true }; 
  }
}