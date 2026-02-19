import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReliabilityModule } from '../reliability/reliability.module';
import { OccupancyEventsController } from './occupancy-events.controller';
import { OccupancyEventsService } from './occupancy-events.service';
import { OccupancyEventsScheduler } from './occupancy-events.scheduler';

/** Module for anonymous occupancy events - geofencing ENTER/EXIT + 15-min snapshots for ML */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => ReliabilityModule),
  ],
  controllers: [OccupancyEventsController],
  providers: [OccupancyEventsService, OccupancyEventsScheduler],
  exports: [OccupancyEventsService],
})
export class OccupancyEventsModule {}
