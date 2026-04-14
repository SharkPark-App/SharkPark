import { Controller, Get, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
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
