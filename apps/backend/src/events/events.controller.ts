import { Controller, Get, Param, Query, HttpCode, HttpStatus, ParseIntPipe } from '@nestjs/common';
import { EventsService } from './events.service';
import { Public } from '../auth/public.decorator';

/**
 * Provides campus event data and their impact on parking availability.
 * Events include sports games, graduations, and other large gatherings.
 */
@Public()
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getAllEvents(@Query('type') eventType?: string) {
    const events = await this.eventsService.findAll(eventType);
    return {
      success: true,
      count: events.length,
      data: events,
    };
  }

  @Get('upcoming')
  @HttpCode(HttpStatus.OK)
  async getUpcomingEvents(
    @Query('hours', new ParseIntPipe({ optional: true })) hours?: number,
  ) {
    const windowHours = hours && hours >= 1 && hours <= 168 ? hours : 24;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

    const upcoming = await this.eventsService.findUpcoming(windowEnd);

    return {
      success: true,
      count: upcoming.length,
      window_hours: windowHours,
      data: upcoming,
    };
  }

  @Get(':eventId/impacts')
  @HttpCode(HttpStatus.OK)
  async getEventImpacts(@Param('eventId') eventId: string) {
    const impacts = await this.eventsService.getImpacts(eventId);
    return {
      success: true,
      event_id: eventId,
      count: impacts.length,
      data: impacts,
    };
  }
}
