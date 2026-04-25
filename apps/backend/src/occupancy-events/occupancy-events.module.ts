import { Module, forwardRef } from '@nestjs/common';
import { ReliabilityModule } from '../reliability/reliability.module';
import { LotsModule } from '../lots/lots.module';
import { AuthModule } from '../auth/auth.module';
import { OccupancyEventsController } from './occupancy-events.controller';
import { OccupancyEventsService } from './occupancy-events.service';
import { OccupancyEventsScheduler } from './occupancy-events.scheduler';

/** Module for anonymous occupancy events - geofencing ENTER/EXIT + 15-min snapshots for ML.
 *  ScheduleModule.forRoot() is registered once globally in AppModule. */
@Module({
  imports: [
    forwardRef(() => ReliabilityModule),
    LotsModule,
    AuthModule,
  ],
  controllers: [OccupancyEventsController],
  providers: [OccupancyEventsService, OccupancyEventsScheduler],
  exports: [OccupancyEventsService],
})
export class OccupancyEventsModule {}
