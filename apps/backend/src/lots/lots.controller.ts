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

/**
 * Handles parking lot queries including filtering, individual lot details,
 * historical occupancy data, and campus-wide occupancy summaries.
 */
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
}
