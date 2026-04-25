import { 
  Controller, 
  Get, 
  Param, 
  Query, 
  HttpCode, 
  HttpStatus,
  ParseBoolPipe,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { LotsService } from './lots.service';
import type { GetLotsQueryParams } from './interfaces/parking-lot.interface';
import { Public } from '../auth/public.decorator';

/**
 * Handles parking lot queries including filtering, individual lot details,
 * historical occupancy data, and campus-wide occupancy summaries.
 */
@Public()
@Controller('lots')
export class LotsController {
  constructor(private readonly lotsService: LotsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getAllLots(
    @Query('type') type?: 'STUDENT' | 'EMPLOYEE',
    @Query('available_only', new ParseBoolPipe({ optional: true })) availableOnly?: boolean,
    @Query('min_available', new ParseIntPipe({ optional: true })) minAvailable?: number,
    @Query('permit_type') permitType?: string,
    @Query('daily_permit', new ParseBoolPipe({ optional: true })) dailyPermit?: boolean,
    @Query('ev_charging', new ParseBoolPipe({ optional: true })) evCharging?: boolean,
  ) {
    if (type && !['STUDENT', 'EMPLOYEE'].includes(type)) {
      throw new BadRequestException('Invalid lot type. Must be STUDENT or EMPLOYEE');
    }

    const queryParams: GetLotsQueryParams = {
      type,
      available_only: availableOnly,
      min_available: minAvailable,
      permit_type: permitType,
      daily_permit: dailyPermit,
      ev_charging: evCharging,
    };

    const lots = await this.lotsService.findAll(queryParams);

    return {
      success: true,
      count: lots.length,
      data: lots,
    };
  }

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  async getOccupancySummary() {
    const summary = await this.lotsService.getOccupancySummary();

    return {
      success: true,
      data: summary,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getLot(@Param('id') id: string) {
    const lot = await this.lotsService.findOne(id.toUpperCase());

    return {
      success: true,
      data: lot,
    };
  }

  @Get(':id/recommendations')
  @HttpCode(HttpStatus.OK)
  async getRecommendations(
    @Param('id') id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const cappedLimit = limit && limit >= 1 && limit <= 20 ? limit : 5;

    const recommendations = await this.lotsService.getRecommendations(
      id.toUpperCase(),
      cappedLimit,
    );

    return {
      success: true,
      source_lot: id.toUpperCase(),
      count: recommendations.length,
      data: recommendations,
    };
  }

  @Get(':id/history')
  @HttpCode(HttpStatus.OK)
  async getLotHistory(
    @Param('id') id: string,
    @Query('date') date?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const targetDate = date || new Date().toISOString().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }

    // Cap limit at 200 to prevent expensive queries
    const recordLimit = limit && limit <= 200 ? limit : 96;

    const history = await this.lotsService.getHistory(
      id.toUpperCase(),
      targetDate,
      recordLimit,
    );

    return {
      success: true,
      lot_id: id.toUpperCase(),
      date: targetDate,
      count: history.length,
      data: history,
    };
  }

  @Get(':id/predictions/short-term')
  @HttpCode(HttpStatus.OK)
  async getShortTermPredictions(@Param('id') id: string) {
    const predictions = await this.lotsService.getShortTermPredictions(id.toUpperCase());

    return {
      success: true,
      ...predictions,
    };
  }

  @Get(':id/predictions/long-term')
  @HttpCode(HttpStatus.OK)
  async getLongTermPredictions(
    @Param('id') id: string,
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
  ) {
    const cappedDays = days && days >= 1 && days <= 14 ? days : 7;
    const predictions = await this.lotsService.getLongTermPredictions(id.toUpperCase(), cappedDays);

    return {
      success: true,
      ...predictions,
    };
  }
}
