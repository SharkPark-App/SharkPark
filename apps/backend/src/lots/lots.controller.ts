import { 
  Controller, 
  Get, 
  Header,
  Headers,
  Param, 
  Query, 
  HttpCode, 
  HttpStatus,
  ParseBoolPipe,
  ParseIntPipe,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LotsService } from './lots.service';
import type { GetLotsQueryParams } from './interfaces/parking-lot.interface';
import { Public } from '../auth/public.decorator';
import { ContributorGuard } from '../auth/contributor.guard';
import { ContributorService } from '../auth/contributor.service';
import { EventsService, MAX_EVENTS_WINDOW_HOURS } from '../events/events.service';

/** Default lookahead for nearby-events badge surfaces (next 2 hours). */
const DEFAULT_NEARBY_EVENTS_HOURS = 2;

/** Validate + clamp the `within_hours` query param shared by both events endpoints. */
function parseWithinHours(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_NEARBY_EVENTS_HOURS;
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_EVENTS_WINDOW_HOURS) {
    throw new BadRequestException(
      `within_hours must be an integer between 1 and ${MAX_EVENTS_WINDOW_HOURS}`,
    );
  }
  return raw;
}

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
  constructor(
    private readonly lotsService: LotsService,
    private readonly contributorService: ContributorService,
    private readonly eventsService: EventsService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  // `private` (not `public`) is REQUIRED here: the response shape varies by
  // device tier (live fields are nulled for non-contributors). A shared CDN
  // cache would happily serve a contributor's full payload to anyone hitting
  // the same URL afterwards, defeating the redaction. We pay a small origin-
  // throughput cost in exchange for that correctness; the underlying Postgres
  // reads are cheap and Throttle keeps the bucket bounded.
  @Header('Cache-Control', 'private, max-age=15')
  async getAllLots(
    @Headers('x-device-id') deviceId: string | string[] | undefined,
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

    const redactLive = !(await this.contributorService.isContributor(deviceId));
    const lots = await this.lotsService.findAll(queryParams, { redactLive });

    return {
      success: true,
      count: lots.length,
      data: lots,
    };
  }

  @Get('utilization')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=300, s-maxage=600')
  async getUtilization(@Query('range') range?: string) {
    const rangeDays = this.lotsService.parseRangeDays(range, 30, 90);
    const until = new Date();
    const since = new Date(until.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    const data = await this.lotsService.getUtilization(rangeDays);

    return {
      success: true,
      range_days: rangeDays,
      since: since.toISOString(),
      until: until.toISOString(),
      count: data.length,
      data,
    };
  }

  @Get('summary')
  @UseGuards(ContributorGuard)
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
  // See note on `getAllLots` for why this is `private` rather than `public`.
  @Header('Cache-Control', 'private, max-age=15')
  async getLot(
    @Param('id') id: string,
    @Headers('x-device-id') deviceId: string | string[] | undefined,
  ) {
    const redactLive = !(await this.contributorService.isContributor(deviceId));
    const lot = await this.lotsService.findOne(id.toUpperCase(), { redactLive });

    return {
      success: true,
      data: lot,
    };
  }

  @Get(':id/recommendations')
  @UseGuards(ContributorGuard)
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

  @Get(':id/trends')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=300, s-maxage=600')
  async getLotTrends(
    @Param('id') id: string,
    @Query('range') range?: string,
  ) {
    const rangeDays = this.lotsService.parseRangeDays(range, 7, 90);
    const until = new Date();
    const since = new Date(until.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    const data = await this.lotsService.getTrends(id.toUpperCase(), rangeDays);

    return {
      success: true,
      lot_id: id.toUpperCase(),
      range_days: rangeDays,
      since: since.toISOString(),
      until: until.toISOString(),
      count: data.length,
      data,
    };
  }

  @Get(':id/predictions/short-term')
  @UseGuards(ContributorGuard)
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
  @UseGuards(ContributorGuard)
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

  /**
   * Upcoming events for a single lot in the next `within_hours` (default 2).
   * Public + shared-cacheable for the same reasons as the bulk summary.
   */
  @Get(':id/nearby-events')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300')
  async getNearbyEvents(
    @Param('id') id: string,
    @Query('within_hours', new ParseIntPipe({ optional: true })) withinHours?: number,
  ) {
    const hours = parseWithinHours(withinHours);
    const events = await this.eventsService.getEventsForLot(id.toUpperCase(), hours);

    return {
      success: true,
      lot_id: id.toUpperCase(),
      within_hours: hours,
      count: events.length,
      data: events,
    };
  }
}
