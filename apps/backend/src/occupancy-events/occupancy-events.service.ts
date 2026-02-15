import { Injectable, Inject, Logger, InternalServerErrorException, forwardRef } from '@nestjs/common';
import { 
  DynamoDBClient, 
  PutItemCommand, 
  QueryCommand, 
  UpdateItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DYNAMODB_CLIENT, TABLE_NAME, TIMESERIES_TABLE_NAME } from '../database/database.module';
import { CreateOccupancyEventDto } from './dto/create-occupancy-event.dto';
import type { 
  OccupancyEvent, 
  OccupancySnapshot, 
  CreateEventResponse,
  EventStats,
} from './interfaces/occupancy-event.interface';
import { hashDeviceId, generateEventId, calculateTTL } from './utils/privacy.util';
import { ReliabilityService } from '../reliability/reliability.service';
import type { ReliabilityInput } from '../reliability/interfaces';

/** Service for anonymous occupancy events - handles storage, deduplication, and real-time updates */
@Injectable()
export class OccupancyEventsService {
  private readonly logger = new Logger(OccupancyEventsService.name);

  constructor(
    @Inject(DYNAMODB_CLIENT) private readonly dynamoClient: DynamoDBClient,
    @Inject(TABLE_NAME) private readonly tableName: string,
    @Inject(TIMESERIES_TABLE_NAME) private readonly timeseriesTableName: string,
    @Inject(forwardRef(() => ReliabilityService)) private readonly reliabilityService: ReliabilityService,
  ) {}

  /**
   * Records an anonymous occupancy event and updates lot occupancy.
   * Includes deduplication logic to prevent ENTER→ENTER or EXIT→EXIT.
   */
  async create(dto: CreateOccupancyEventDto): Promise<CreateEventResponse> {
    const deviceHash = hashDeviceId(dto.device_id);
    const eventId = generateEventId();
    const now = new Date().toISOString();

    // Check for duplicate event (same device, same lot, same event type)
    const isDuplicate = await this.checkDuplicate(dto.lot_id, deviceHash, dto.event_type);
    
    if (isDuplicate) {
      this.logger.warn(
        `Duplicate ${dto.event_type} event ignored for lot ${dto.lot_id} from device ${deviceHash.substring(0, 8)}...`
      );
      return {
        event_id: eventId,
        lot_id: dto.lot_id,
        event_type: dto.event_type,
        recorded_at: now,
        deduplicated: true,
      };
    }

    // Store the event in timeseries table
    const event: OccupancyEvent = {
      PK: `LOT#${dto.lot_id}`,
      SK: `EVENT#${dto.timestamp}#${eventId}`,
      EntityType: 'OccupancyEvent',
      lot_id: dto.lot_id,
      event_type: dto.event_type,
      device_hash: deviceHash,
      timestamp: dto.timestamp,
      created_at: now,
      ttl: calculateTTL(90),
    };

    try {
      // Store event
      await this.dynamoClient.send(new PutItemCommand({
        TableName: this.timeseriesTableName,
        Item: marshall(event),
      }));

      // Update lot occupancy atomically
      await this.updateLotOccupancy(dto.lot_id, dto.event_type);

      // Update device's last event type for deduplication
      await this.updateDeviceLastEvent(dto.lot_id, deviceHash, dto.event_type);

      this.logger.log(
        `Recorded ${dto.event_type} event for lot ${dto.lot_id} (device: ${deviceHash.substring(0, 8)}...)`
      );

      return {
        event_id: eventId,
        lot_id: dto.lot_id,
        event_type: dto.event_type,
        recorded_at: now,
        deduplicated: false,
      };
    } catch (error) {
      this.logger.error(`Failed to record occupancy event for lot ${dto.lot_id}`, error);
      throw new InternalServerErrorException('Failed to record occupancy event');
    }
  }

  /**
   * Retrieves events for a specific lot within a date range.
   * Used for ML training data export and debugging.
   */
  async findByLot(
    lotId: string,
    startDate: string,
    endDate: string,
    limit: number = 1000,
  ): Promise<OccupancyEvent[]> {
    try {
      const command = new QueryCommand({
        TableName: this.timeseriesTableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `LOT#${lotId}` },
          ':start': { S: `EVENT#${startDate}` },
          ':end': { S: `EVENT#${endDate}~` }, // ~ sorts after any timestamp
        },
        Limit: limit,
        ScanIndexForward: true, // Chronological order
      });

      const result = await this.dynamoClient.send(command);
      return (result.Items || []).map(item => unmarshall(item) as OccupancyEvent);
    } catch (error) {
      this.logger.error(`Failed to fetch events for lot ${lotId}`, error);
      throw new InternalServerErrorException(`Failed to fetch events for lot ${lotId}`);
    }
  }

  /**
   * Gets event statistics for a lot over a time period.
   */
  async getEventStats(lotId: string, startDate: string, endDate: string): Promise<EventStats> {
    const events = await this.findByLot(lotId, startDate, endDate);
    
    const totalEnters = events.filter(e => e.event_type === 'ENTER').length;
    const totalExits = events.filter(e => e.event_type === 'EXIT').length;

    return {
      lot_id: lotId,
      start_date: startDate,
      end_date: endDate,
      total_enters: totalEnters,
      total_exits: totalExits,
      net_change: totalEnters - totalExits,
    };
  }

  /**
   * Creates occupancy snapshots for all lots.
   * Called by a scheduled job every 15 minutes for ML training data.
   */
  async createSnapshots(): Promise<{ count: number; timestamp: string }> {
    const now = new Date();
    const timestamp = now.toISOString();
    const dateStr = timestamp.split('T')[0];

    try {
      // Get all lots from main table
      const lotsCommand = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1-EntityType-Timestamp',
        KeyConditionExpression: 'EntityType = :type',
        ExpressionAttributeValues: {
          ':type': { S: 'ParkingLot' },
        },
      });

      const lotsResult = await this.dynamoClient.send(lotsCommand);
      const lots = (lotsResult.Items || []).map(item => unmarshall(item));

      // Create snapshot for each lot
      let count = 0;
      for (const lot of lots) {
        const occupancy = lot.current_occupancy || 0;
        const capacity = lot.capacity || 100;
        const available = Math.max(0, capacity - occupancy);
        const occupancyRate = capacity > 0 ? occupancy / capacity : 0;

        // Compute confidence using ReliabilityService multi-factor algorithm
        const reliabilityInput = await this.gatherReliabilityInput(lot.lot_id, lot);
        const reliabilityScore = this.reliabilityService.computeReliabilitySummary(
          lot.lot_id,
          reliabilityInput,
        );
        const confidence = reliabilityScore.confidence;

        const snapshot: OccupancySnapshot = {
          PK: `LOT#${lot.lot_id}#${dateStr}`,
          SK: `SNAPSHOT#${timestamp}`,
          EntityType: 'OccupancySnapshot',
          lot_id: lot.lot_id,
          timestamp,
          occupancy,
          available,
          occupancy_rate: Math.round(occupancyRate * 1000) / 1000,
          confidence,
          reliability_score: reliabilityScore.score,
          is_cold_start: reliabilityScore.isColdStart,
          ttl: calculateTTL(90),
        };

        await this.dynamoClient.send(new PutItemCommand({
          TableName: this.timeseriesTableName,
          Item: marshall(snapshot),
        }));

        count++;
      }

      this.logger.log(`Created ${count} occupancy snapshots at ${timestamp}`);
      return { count, timestamp };
    } catch (error) {
      this.logger.error('Failed to create occupancy snapshots', error);
      throw new InternalServerErrorException('Failed to create occupancy snapshots');
    }
  }

  /**
   * Retrieves snapshots for a lot on a specific date.
   * Used for historical analysis and ML training data export.
   */
  async getSnapshots(lotId: string, date: string, limit: number = 96): Promise<OccupancySnapshot[]> {
    try {
      const command = new QueryCommand({
        TableName: this.timeseriesTableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `LOT#${lotId}#${date}` },
          ':prefix': { S: 'SNAPSHOT#' },
        },
        Limit: limit,
        ScanIndexForward: true,
      });

      const result = await this.dynamoClient.send(command);
      return (result.Items || []).map(item => unmarshall(item) as OccupancySnapshot);
    } catch (error) {
      this.logger.error(`Failed to fetch snapshots for lot ${lotId} on ${date}`, error);
      throw new InternalServerErrorException(`Failed to fetch snapshots for lot ${lotId}`);
    }
  }

  /**
   * Atomically updates a lot's current_occupancy counter.
   * Uses DynamoDB ADD operation to handle concurrent updates.
   */
  private async updateLotOccupancy(lotId: string, eventType: 'ENTER' | 'EXIT'): Promise<void> {
    const increment = eventType === 'ENTER' ? 1 : -1;

    try {
      const updateParams = {
        TableName: this.tableName,
        Key: {
          PK: { S: `LOT#${lotId}` },
          SK: { S: 'METADATA' },
        },
        UpdateExpression: 'SET current_occupancy = if_not_exists(current_occupancy, :zero) + :inc',
        ExpressionAttributeValues: {
          ':inc': { N: String(increment) },
          ':zero': { N: '0' },
        },
        // Only add condition for EXIT to prevent negative occupancy
        ...(eventType === 'EXIT' && { ConditionExpression: 'current_occupancy > :zero' }),
      };

      await this.dynamoClient.send(new UpdateItemCommand(updateParams));
    } catch (error: unknown) {
      // If EXIT fails due to condition (occupancy already 0), log but don't fail
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        this.logger.warn(`Cannot decrement occupancy below 0 for lot ${lotId}`);
        return;
      }
      throw error;
    }
  }

  /**
   * Checks if this event is a duplicate (same event type as last event from this device).
   * Prevents ENTER→ENTER or EXIT→EXIT sequences.
   */
  private async checkDuplicate(
    lotId: string,
    deviceHash: string,
    eventType: 'ENTER' | 'EXIT',
  ): Promise<boolean> {
    try {
      const command = new GetItemCommand({
        TableName: this.timeseriesTableName,
        Key: {
          PK: { S: `DEVICE#${deviceHash}` },
          SK: { S: `LOT#${lotId}` },
        },
      });

      const result = await this.dynamoClient.send(command);
      
      if (!result.Item) {
        return false; // First event from this device for this lot
      }

      const lastEvent = unmarshall(result.Item);
      return lastEvent.last_event_type === eventType;
    } catch (error) {
      this.logger.warn(`Failed to check duplicate for lot ${lotId}, proceeding anyway`, error);
      return false; // On error, allow the event
    }
  }

  /**
   * Updates the device's last event type for a specific lot.
   * Used for deduplication on subsequent events.
   */
  private async updateDeviceLastEvent(
    lotId: string,
    deviceHash: string,
    eventType: 'ENTER' | 'EXIT',
  ): Promise<void> {
    try {
      await this.dynamoClient.send(new PutItemCommand({
        TableName: this.timeseriesTableName,
        Item: marshall({
          PK: `DEVICE#${deviceHash}`,
          SK: `LOT#${lotId}`,
          last_event_type: eventType,
          updated_at: new Date().toISOString(),
          ttl: calculateTTL(7), // Device state expires after 7 days
        }),
      }));
    } catch (error) {
      this.logger.warn(`Failed to update device last event for lot ${lotId}`, error);
      // Non-critical, don't throw
    }
  }

  /**
   * Gathers input data required for reliability computation.
   * Used by createSnapshots to compute multi-factor confidence scores.
   */
  private async gatherReliabilityInput(
    lotId: string,
    lot: Record<string, unknown>,
  ): Promise<ReliabilityInput> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Get events from the last hour
    const recentEvents = await this.findByLot(
      lotId,
      oneHourAgo.toISOString(),
      now.toISOString(),
      1000,
    );

    // Calculate minutes since last event
    let minutesSinceLastEvent = 60; // Default to max if no events
    if (recentEvents.length > 0) {
      const lastEventTime = new Date(recentEvents[recentEvents.length - 1].timestamp);
      minutesSinceLastEvent = (now.getTime() - lastEventTime.getTime()) / 60000;
    }

    // Count unique devices
    const uniqueDevices = new Set(recentEvents.map((e) => e.device_hash));

    return {
      penetrationRate: (lot.penetration_rate as number) || 0,
      minutesSinceLastEvent: Math.min(120, minutesSinceLastEvent),
      eventsInLastHour: recentEvents.length,
      uniqueDevicesInLastHour: uniqueDevices.size,
      historicalAccuracy: null, // Not yet implemented
    };
  }
}
