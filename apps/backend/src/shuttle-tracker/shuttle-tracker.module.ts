import { Module } from '@nestjs/common';
import { ShuttleTrackerController } from './shuttle-tracker.controller';
import { ShuttleTrackerService } from './shuttle-tracker.service';
import { PassioWebSocketService } from './passio-websocket.service';
import { ShuttleTrackerGateway } from './shuttle-tracker.gateway';

@Module({
  controllers: [ShuttleTrackerController],
  providers: [
    ShuttleTrackerService,
    PassioWebSocketService,
    ShuttleTrackerGateway
  ],
  exports: [ShuttleTrackerService], 
})
export class ShuttleTrackerModule {}