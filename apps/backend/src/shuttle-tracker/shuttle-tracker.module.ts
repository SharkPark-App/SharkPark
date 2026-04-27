import { Module } from '@nestjs/common';
import { ShuttleTrackerController } from './shuttle-tracker.controller';
import { ShuttleTrackerService } from './shuttle-tracker.service';
import { PassioWebSocketService } from './passio-websocket.service';

@Module({
  controllers: [ShuttleTrackerController],
  providers: [
    ShuttleTrackerService,
    PassioWebSocketService
  ],
  exports: [ShuttleTrackerService], 
})
export class ShuttleTrackerModule {}