import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { OccupancyEventsService } from './occupancy-events.service';
import { CreateOccupancyEventDto } from './dto/create-occupancy-event.dto';

/** Controller for anonymous occupancy event logging from mobile geofencing */
@Controller('occupancy-events')
export class OccupancyEventsController {
  constructor(private readonly occupancyEventsService: OccupancyEventsService) {}

  /** Records an anonymous ENTER/EXIT event for a parking lot */
  @Post()
  @Throttle({ default: { ttl: 10_000, limit: 6 } })
  @HttpCode(HttpStatus.CREATED)
  async createEvent(@Body() createEventDto: CreateOccupancyEventDto) {
    const result = await this.occupancyEventsService.create(createEventDto);
    
    return {
      success: true,
      message: result.deduplicated 
        ? 'Duplicate event ignored' 
        : 'Occupancy event recorded successfully',
      data: result,
    };
  }

  /** Get events for a lot within a date range */
  @Get('lots/:lotId')
  @HttpCode(HttpStatus.OK)
  async getEventsByLot(
    @Param('lotId') lotId: string,
    @Query('start') startDate?: string,
    @Query('end') endDate?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    // Default to today if no dates provided
    const today = new Date().toISOString().split('T')[0];
    const start = startDate || today;
    const end = endDate || `${today}T23:59:59.999Z`;

    // Validate date formats
    if (!/^\d{4}-\d{2}-\d{2}/.test(start)) {
      throw new BadRequestException('Invalid start date format. Use YYYY-MM-DD');
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(end)) {
      throw new BadRequestException('Invalid end date format. Use YYYY-MM-DD');
    }

    const events = await this.occupancyEventsService.findByLot(
      lotId.toUpperCase(),
      start,
      end,
      limit || 1000,
    );

    return {
      success: true,
      lot_id: lotId.toUpperCase(),
      start_date: start,
      end_date: end,
      count: events.length,
      data: events,
    };
  }

  /** Get event statistics (enter/exit counts) for a lot */
  @Get('lots/:lotId/stats')
  @HttpCode(HttpStatus.OK)
  async getEventStats(
    @Param('lotId') lotId: string,
    @Query('start') startDate?: string,
    @Query('end') endDate?: string,
  ) {
    const today = new Date().toISOString().split('T')[0];
    const start = startDate || today;
    const end = endDate || `${today}T23:59:59.999Z`;

    if (startDate && !/^\d{4}-\d{2}-\d{2}/.test(start)) {
      throw new BadRequestException('Invalid start date format. Use YYYY-MM-DD');
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}/.test(end)) {
      throw new BadRequestException('Invalid end date format. Use YYYY-MM-DD');
    }

    const stats = await this.occupancyEventsService.getEventStats(
      lotId.toUpperCase(),
      start,
      end,
    );

    return {
      success: true,
      data: stats,
    };
  }

  /** Manually trigger snapshot creation (normally called by scheduler) */
  @UseGuards(AuthGuard('azure-ad'))
  @Post('snapshots')
  @HttpCode(HttpStatus.CREATED)
  async createSnapshots() {
    const result = await this.occupancyEventsService.createSnapshots();
    
    return {
      success: true,
      message: `Created ${result.count} occupancy snapshots`,
      data: result,
    };
  }

  /** Get snapshots for a lot on a given date */
  @Get('snapshots/:lotId')
  @HttpCode(HttpStatus.OK)
  async getSnapshots(
    @Param('lotId') lotId: string,
    @Query('date') date?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const targetDate = date || new Date().toISOString().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }

    const snapshots = await this.occupancyEventsService.getSnapshots(
      lotId.toUpperCase(),
      targetDate,
      limit || 96,
    );

    return {
      success: true,
      lot_id: lotId.toUpperCase(),
      date: targetDate,
      count: snapshots.length,
      data: snapshots,
    };
  }
}
