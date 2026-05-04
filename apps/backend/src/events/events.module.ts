import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventsScrapersModule } from './events-scrapers.module';

/**
 * Full events module for the long-lived `app` process: serves the
 * `GET /events/for-lot/:lotId` controller and exposes the scraper services
 * via the re-exported {@link EventsScrapersModule}.
 *
 * Cron scripts should import {@link EventsScrapersModule} directly to avoid
 * loading the controller + read service.
 */
@Module({
  imports: [EventsScrapersModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService, EventsScrapersModule],
})
export class EventsModule {}
