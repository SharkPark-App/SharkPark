import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'shuttles',
  path: '/api/v1/socket.io/',
  transports: ['websocket'],
})
export class ShuttleTrackerGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;
  private logger = new Logger(ShuttleTrackerGateway.name);

  afterInit() {
    this.logger.log('Shuttle gateway initialized. Ready to broadcast to mobile clients.');
  }

  broadcastShuttles(shuttles: Record<string, unknown>[]) {
    this.server.emit('shuttle_update', shuttles);
  }
}