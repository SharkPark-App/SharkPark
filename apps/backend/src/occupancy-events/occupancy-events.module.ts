import { Module, forwardRef } from '@nestjs/common';
import { ReliabilityModule } from '../reliability/reliability.module';
import { LotsModule } from '../lots/lots.module';
import { AuthModule } from '../auth/auth.module';
import { OccupancyEventsController } from './occupancy-events.controller';
import { OccupancyEventsService } from './occupancy-events.service';

/**
 * Module for anonymous occupancy events - geofencing ENTER/EXIT + 15-min
 * snapshots for ML. Snapshot generation and stale-state cleanup run as
 * the in-process NestJS scheduler (see src/scheduler/jobs/{snapshot,cleanup-device-states}.job.ts);
 * the API process no longer carries an in-process scheduler.
 */
@Module({
  imports: [
    forwardRef(() => ReliabilityModule),
    LotsModule,
    AuthModule,
  ],
  controllers: [OccupancyEventsController],
  providers: [OccupancyEventsService],
  exports: [OccupancyEventsService],
})
export class OccupancyEventsModule {}
