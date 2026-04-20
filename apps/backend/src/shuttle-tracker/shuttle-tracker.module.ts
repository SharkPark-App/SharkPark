import { Module } from '@nestjs/common';
import { ShuttleTrackerController } from './shuttle-tracker.controller';
import { ShuttleTrackerService } from './shuttle-tracker.service';
import { ShuttleTrackerScheduler } from './shuttle-tracker.scheduler';

@Module({
  controllers: [ShuttleTrackerController],
  providers: [ShuttleTrackerService, ShuttleTrackerScheduler],
  exports: [ShuttleTrackerService], 
})
export class ShuttleTrackerModule {}