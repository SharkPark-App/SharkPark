import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';

@Injectable()
export class PassioWebSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PassioWebSocketService.name);
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PASSIO_WS_URL = 'wss://passio3.com/';
  
  // CSULB specification
  private readonly HANDSHAKE_PAYLOAD = JSON.stringify({ s0: 4163, sA: 1 });

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.cleanup();
  }

  private connect() {
    this.logger.log('Attempting to connect to PassioGo WebSocket...');
    this.ws = new WebSocket(this.PASSIO_WS_URL);

    this.ws.on('open', () => {
      this.logger.log('Connected to PassioGo. Sending subscription handshake...');
      
      // Establish connection for CSULB transit
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(this.HANDSHAKE_PAYLOAD);
      }
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsedData = JSON.parse(data.toString()) as Record<string, unknown>;
        
        // Only handle data if it exists
        if (this.hasActiveShuttles(parsedData)) {
           this.handleShuttleUpdate(parsedData);
        } else {
           this.logger.debug('Received empty or keep-alive frame');
        }
      } catch (error) {
        this.logger.error('Failed to parse incoming WS message', error);
      }
    });

    this.ws.on('close', () => {
      this.logger.warn('PassioGo WebSocket closed. Attempting reconnect in 5 seconds...');
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.logger.error(`PassioGo WebSocket error: ${error.message}`);
      this.ws?.close();
    });
  }

  private handleShuttleUpdate(data: Record<string, unknown>) {
    // TODO: get shape of payload once shuttles are running
    this.logger.log('LIVE SHUTTLE DATA RECEIVED:', JSON.stringify(data).substring(0, 100) + '...');
  }

  private hasActiveShuttles(data: Record<string, unknown>): boolean {
    return Object.keys(data).length > 0; 
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 5000);
  }

  private cleanup() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }
}