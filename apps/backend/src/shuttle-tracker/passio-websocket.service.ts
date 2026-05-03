import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import WebSocket from 'ws';
import { ShuttleTrackerGateway } from './shuttle-tracker.gateway';
import { PassioLiveShuttleDto } from './dto/passiogo.dto';

@Injectable()
export class PassioWebSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PassioWebSocketService.name);
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Backoff settings
  private reconnectAttempts = 0;
  private readonly BASE_DELAY_MS = 5000;         // 5 sec
  private readonly MAX_DELAY_MS = 5 * 60 * 1000; // 5 min

  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // Batch outgoing broadcasts: accumulate updates within a window, emit once
  private pendingUpdates = new Map<string, Record<string, unknown>>();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW_MS = 200;

  private readonly PASSIO_WS_URL = 'wss://passio3.com/';
  // CSULB specification
  private readonly HANDSHAKE_PAYLOAD = JSON.stringify({
    subscribe: 'location',
    userId: [4163],
    filter: {
      outOfService: 0
    },
    // Essential fields
    field: ['busId', 'latitude', 'longitude', 'course', 'paxLoad', 'more']
  });

  constructor(private readonly shuttleGateway: ShuttleTrackerGateway) {}
  
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
      this.logger.log('Connected to PassioGO!. Sending subscription handshake...');
      this.reconnectAttempts = 0;

      // Establish connection for CSULB transit
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.logger.log('Subscription handshake established.');
        this.ws.send(this.HANDSHAKE_PAYLOAD);
      }

      // Keep-alive: detect silent drops that don't produce close/error events
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 30_000);
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsedData = JSON.parse(data.toString()) as Record<string, unknown>;

        if (this.hasActiveShuttles(parsedData)) {
           void this.handleShuttleUpdate(parsedData);
        } else {
           this.logger.debug('Received empty or keep-alive frame');
        }
      } catch (error) {
        this.logger.error('Failed to parse incoming WS message', error);
      }
    });

    this.ws.on('close', () => {
      this.logger.warn('PassioGo WebSocket closed. Reconnect attempt queued...');
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.logger.error(`PassioGo WebSocket error: ${error.message}`);
      // terminate() forces immediate teardown; ws fires 'close' automatically after 'error'
      // so the reconnect loop is still triggered. close() would wait for a clean handshake.
      this.ws?.terminate();
    });
  }

  private async handleShuttleUpdate(data: Record<string, unknown>) {
    // Validate the live frame against the DTO schema before broadcasting.
    // Without this a single malformed PassioGO frame would be relayed verbatim
    // to every connected mobile client and could break downstream parsers.
    const liveData = plainToInstance(PassioLiveShuttleDto, data);
    try {
      await validateOrReject(liveData);
    } catch {
      this.logger.warn('Dropping malformed live shuttle frame from PassioGO!');
      return;
    }

    try {
      const locationUpdate = {
        id: liveData.busId.toString(),
        latitude: liveData.latitude,
        longitude: liveData.longitude,
        heading: liveData.course,
        paxLoad: liveData.paxLoad,
      };

      // Accumulate by bus ID — last frame wins if two arrive within the window
      this.pendingUpdates.set(locationUpdate.id, locationUpdate);
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushBatch(), this.BATCH_WINDOW_MS);
      }
    } catch (error) {
      this.logger.error('Failed to process live location payload', error);
    }
  }

  private flushBatch() {
    this.shuttleGateway.broadcastShuttles([...this.pendingUpdates.values()]);
    this.pendingUpdates.clear();
    this.batchTimer = null;
  }

  private hasActiveShuttles(data: Record<string, unknown>): boolean {
    return data !== null && typeof data === 'object' && 'busId' in data;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Calculate delay: min(5s * 2^n + jitter, 5min)
    const exponentialDelay = this.BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.floor(Math.random() * 1000);
    const finalDelay = Math.min(exponentialDelay + jitter, this.MAX_DELAY_MS);

    this.logger.warn(`WebSocket closed. Reconnecting in ${Math.round(finalDelay / 1000)}s...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, finalDelay);
  }

  private cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingUpdates.clear();

    if (this.ws) {
      this.ws.removeAllListeners();
      
      // Swallow error if close() is called during connection establishment
      this.ws.on('error', () => {});
      
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        } else {
          this.ws.terminate(); 
        }
      } catch {
        this.logger.debug('Safely caught error during WebSocket teardown');
      }
      
      this.ws = null;
    }
  }
}