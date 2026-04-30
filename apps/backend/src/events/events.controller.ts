import { Controller, Get, Query, HttpCode, HttpStatus, ParseIntPipe } from '@nestjs/common';
import { EventsService } from './events.service';
import { Public } from '../auth/public.decorator';

/**
 * Provides campus event data for display and notification surfaces in the
 * mobile app. Events are stored as raw scraped records; mobile clients
 * decide which events are relevant to a user based on their favorite lots.
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
}
