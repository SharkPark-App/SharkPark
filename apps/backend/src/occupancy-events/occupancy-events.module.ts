import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { OccupancyEventsController } from './occupancy-events.controller';
import { OccupancyEventsService } from './occupancy-events.service';
import { OccupancyEventsScheduler } from './occupancy-events.scheduler';

/** Module for anonymous occupancy events - geofencing ENTER/EXIT + 15-min snapshots for ML */
@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [OccupancyEventsController],
  providers: [OccupancyEventsService, OccupancyEventsScheduler],
  exports: [OccupancyEventsService],
})
export class OccupancyEventsModule {}
