import { Module } from '@nestjs/common';
import { ShuttleTrackerService } from './shuttle-tracker.service';

/**
 * Lightweight shuttle-tracker module exposing only `ShuttleTrackerService`
 * (REST fetches against PassioGo + Redis read/write).
 *
 * Use this from cron scripts (`fetch-transit.ts`) so they don't pull in
 * `PassioWebSocketService` (opens a `wss://passio3.com/` connection in
 * onModuleInit) or `ShuttleTrackerGateway` (Socket.IO server) — both of
 * those only make sense inside the long-lived `app` Fly process.
 *
 * The full {@link ShuttleTrackerModule} re-exports this so HTTP/WS consumers
 * still get the same service instance via DI.
 */
@Module({
  providers: [ShuttleTrackerService],
  exports: [ShuttleTrackerService],
})
export class ShuttleTrackerCoreModule {}
