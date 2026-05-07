import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import type { ShuttleLiveUpdate } from './interfaces/shuttle-tracker.interface';

// Mirrors the HTTP CORS policy in main.ts: use CORS_ORIGINS env var in production,
// allow all in dev (native apps never send Origin, so this only gates browser tabs).
const wsOrigins =
  process.env.NODE_ENV === 'production'
    ? (process.env.CORS_ORIGINS || 'https://sharkpark.app')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : true;

@WebSocketGateway({
  cors: { origin: wsOrigins },
  namespace: 'shuttles',
  path: '/api/v1/socket.io/',
  transports: ['websocket'],
})
export class ShuttleTrackerGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private logger = new Logger(ShuttleTrackerGateway.name);

  afterInit() {
    this.logger.log('Shuttle gateway initialized. Ready to broadcast to mobile clients.');
    if (!process.env.WS_CONNECT_SECRET) {
      this.logger.warn('WS_CONNECT_SECRET not set — connection token validation disabled');
    }
  }

  handleConnection(client: Socket) {
    const secret = process.env.WS_CONNECT_SECRET;
    if (!secret) {
      // Fail closed in production: never accept unauthenticated connections
      // when the shared secret hasn't been provisioned. Outside production we
      // allow open access so local dev / simulators don't need the env var.
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          `[WS] Rejected connection: WS_CONNECT_SECRET is not set in production (${client.handshake.address})`,
        );
        client.disconnect(true);
      }
      return;
    }
    const token = (client.handshake.auth as Record<string, unknown>)?.token;
    if (token !== secret) {
      this.logger.warn(`[WS] Rejected connection: invalid token (${client.handshake.address})`);
      client.disconnect(true);
    }
  }

  broadcastShuttles(shuttles: ShuttleLiveUpdate[]) {
    this.server.emit('shuttle_update', shuttles);
  }
}