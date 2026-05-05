import { Controller, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { EventsService } from './events.service';
import { Public } from '../auth/public.decorator';

@Public()
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('for-lot/:lotId')
  @HttpCode(HttpStatus.OK)
  async getEventsForLot(@Param('lotId') lotId: string) {
    const events = await this.eventsService.getEventsForLot(lotId);
    return {
      success: true,
      count: events.length,
      data: events,
    };
  }
}
