import { Module } from '@nestjs/common';
import { ShuttleTrackerController } from './shuttle-tracker.controller';
import { ShuttleTrackerCoreModule } from './shuttle-tracker-core.module';
import { ShuttleTrackerService } from './shuttle-tracker.service';
import { PassioWebSocketService } from './passio-websocket.service';
import { ShuttleTrackerGateway } from './shuttle-tracker.gateway';

/**
 * Full shuttle-tracker module for the long-lived `app` process: serves the
 * REST controller, runs the Socket.IO gateway, and keeps a persistent
 * WebSocket open to PassioGo for live shuttle positions.
 *
 * Cron scripts should import {@link ShuttleTrackerCoreModule} instead — it
 * exposes `ShuttleTrackerService` without the WebSocket/Gateway bootstrap.
 */
@Module({
  imports: [ShuttleTrackerCoreModule],
  controllers: [ShuttleTrackerController],
  providers: [
    PassioWebSocketService,
    ShuttleTrackerGateway,
  ],
  exports: [ShuttleTrackerService],
})
export class ShuttleTrackerModule {}
