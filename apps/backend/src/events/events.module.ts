import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventsScraperService } from './events-scraper.service';

@Module({
  controllers: [EventsController],
  providers: [EventsService, EventsScraperService],
  exports: [EventsService, EventsScraperService],
})
export class EventsModule {}
