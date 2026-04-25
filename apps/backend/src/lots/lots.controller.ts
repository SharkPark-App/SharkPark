import { 
  Controller, 
  Get, 
  Header,
  Param, 
  Query, 
  HttpCode, 
  HttpStatus,
  ParseBoolPipe,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LotsService } from './lots.service';
import type { GetLotsQueryParams } from './interfaces/parking-lot.interface';
import { Public } from '../auth/public.decorator';

/**
 * Handles parking lot queries including filtering, individual lot details,
 * historical occupancy data, and campus-wide occupancy summaries.
 *
 * Cache strategy: occupancy changes are written every ~15 minutes by the
 * snapshot scheduler, so a short edge cache is safe. Each read endpoint
 * declares its own Cache-Control so Cloudflare can serve hot reads while the
 * origin recomputes in the background.
 *
 * Throttling: uses the relaxed `read` bucket (600 req/min) instead of the
 * default 20 req/10s, since hundreds of mobile clients share a single
 * campus NAT IP.
 */
@Public()
@Controller('lots')
@Throttle({ read: { ttl: 60_000, limit: 600 } })
export class LotsController {
  constructor(private readonly lotsService: LotsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60')
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
  @Header('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60')
  async getOccupancySummary() {
    const summary = await this.lotsService.getOccupancySummary();

    return {
      success: true,
      data: summary,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60')
  async getLot(@Param('id') id: string) {
    const lot = await this.lotsService.findOne(id.toUpperCase());

    return {
      success: true,
      data: lot,
    };
  }

  @Get(':id/recommendations')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120')
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
  @Header('Cache-Control', 'public, max-age=300, s-maxage=600')
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
  @Header('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=180')
  async getShortTermPredictions(@Param('id') id: string) {
    const predictions = await this.lotsService.getShortTermPredictions(id.toUpperCase());

    return {
      success: true,
      ...predictions,
    };
  }

  @Get(':id/predictions/long-term')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=600, s-maxage=1800')
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
