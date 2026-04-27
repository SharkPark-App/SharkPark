import { Module } from '@nestjs/common';
import { ShuttleTrackerController } from './shuttle-tracker.controller';
import { ShuttleTrackerService } from './shuttle-tracker.service';

@Module({
  controllers: [ShuttleTrackerController],
  providers: [ShuttleTrackerService],
  exports: [ShuttleTrackerService], 
})
export class ShuttleTrackerModule {}