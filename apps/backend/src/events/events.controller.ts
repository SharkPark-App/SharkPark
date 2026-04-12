import { Controller, Get, Param, Query, HttpCode, HttpStatus, ParseIntPipe } from '@nestjs/common';
import { EventsService } from './events.service';

/**
 * Provides campus event data and their impact on parking availability.
 * Events include sports games, graduations, and other large gatherings.
 */
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

    const events = await this.eventsService.findAll();
    const upcoming = events.filter(
      (e) => e.start_time <= windowEnd && e.end_time >= now,
    );

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
