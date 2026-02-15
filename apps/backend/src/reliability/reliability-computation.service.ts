import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DynamoDBClient, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { DYNAMODB_CLIENT, TABLE_NAME, TIMESERIES_TABLE_NAME } from '../database/database.module';
import { ReliabilityService } from './reliability.service';
import {
  ReliabilityScore,
  ReliabilityScoreSummary,
  ReliabilityInput,
} from './interfaces';

@Injectable()
export class ReliabilityComputationService {
  private readonly logger = new Logger(ReliabilityComputationService.name);

  constructor(
    @Inject(DYNAMODB_CLIENT) private readonly dynamoClient: DynamoDBClient,
    @Inject(TABLE_NAME) private readonly tableName: string,
    @Inject(TIMESERIES_TABLE_NAME) private readonly timeseriesTableName: string,
    private readonly reliabilityService: ReliabilityService,
  ) {}

  async computeReliabilityForLot(lotId: string): Promise<ReliabilityScore> {
    // Fetch lot metadata
    const lot = await this.getLotMetadata(lotId);
    if (!lot) {
      throw new NotFoundException(`Lot ${lotId} not found`);
    }

    // Gather reliability input data
    const input = await this.gatherReliabilityInput(lotId, lot);

    // Compute and return score
    return this.reliabilityService.computeReliability(lotId, input);
  }

  async computeReliabilityForAllLots(): Promise<ReliabilityScoreSummary[]> {
    // Get all lots
    const lots = await this.getAllLots();

    const results: ReliabilityScoreSummary[] = [];

    for (const lot of lots) {
      const lotId = lot.lot_id as string;
      try {
        const input = await this.gatherReliabilityInput(lotId, lot);
        const summary = this.reliabilityService.computeReliabilitySummary(
          lotId,
          input,
        );
        results.push(summary);
      } catch (error) {
        this.logger.warn(
          `Failed to compute reliability for lot ${lotId}`,
          error,
        );
        // Include with default LOW score on error
        results.push({
          lotId,
          score: 0,
          confidence: 'LOW',
          isColdStart: true,
          computedAt: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  private async gatherReliabilityInput(
    lotId: string,
    lot: Record<string, unknown>,
  ): Promise<ReliabilityInput> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Get events from the last hour
    const recentEvents = await this.getRecentEvents(
      lotId,
      oneHourAgo.toISOString(),
      now.toISOString(),
    );

    // Calculate minutes since last event
    let minutesSinceLastEvent = 60; // Default to max if no events
    if (recentEvents.length > 0) {
      const lastEventTime = new Date(
        recentEvents[recentEvents.length - 1].timestamp as string,
      );
      minutesSinceLastEvent = (now.getTime() - lastEventTime.getTime()) / 60000;
    } else {
      // Check for events in last 2 hours if no recent events
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const olderEvents = await this.getRecentEvents(
        lotId,
        twoHoursAgo.toISOString(),
        oneHourAgo.toISOString(),
      );
      if (olderEvents.length > 0) {
        const lastEventTime = new Date(
          olderEvents[olderEvents.length - 1].timestamp as string,
        );
        minutesSinceLastEvent =
          (now.getTime() - lastEventTime.getTime()) / 60000;
      } else {
        minutesSinceLastEvent = 120; // No events in last 2 hours
      }
    }

    // Count unique devices
    const uniqueDevices = new Set(
      recentEvents.map((e) => e.device_hash as string),
    );

    // Get historical accuracy if available
    const historicalAccuracy = await this.getHistoricalAccuracy(lotId);

    return {
      penetrationRate: (lot.penetration_rate as number) || 0,
      minutesSinceLastEvent: Math.min(120, minutesSinceLastEvent), // Cap at 120 min
      eventsInLastHour: recentEvents.length,
      uniqueDevicesInLastHour: uniqueDevices.size,
      historicalAccuracy,
    };
  }

  private async getLotMetadata(
    lotId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const command = new GetItemCommand({
        TableName: this.tableName,
        Key: {
          PK: { S: `LOT#${lotId}` },
          SK: { S: 'METADATA' },
        },
      });

      const result = await this.dynamoClient.send(command);
      if (!result.Item) {
        return null;
      }

      return unmarshall(result.Item);
    } catch (error) {
      this.logger.error(`Failed to get lot metadata for ${lotId}`, error);
      throw error;
    }
  }

  private async getAllLots(): Promise<Record<string, unknown>[]> {
    try {
      const command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1-EntityType-Timestamp',
        KeyConditionExpression: 'EntityType = :type',
        ExpressionAttributeValues: {
          ':type': { S: 'ParkingLot' },
        },
      });

      const result = await this.dynamoClient.send(command);
      return (result.Items || []).map((item) => unmarshall(item));
    } catch (error) {
      this.logger.error('Failed to get all lots', error);
      throw error;
    }
  }

  private async getRecentEvents(
    lotId: string,
    startDate: string,
    endDate: string,
  ): Promise<Record<string, unknown>[]> {
    try {
      const command = new QueryCommand({
        TableName: this.timeseriesTableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `LOT#${lotId}` },
          ':start': { S: `EVENT#${startDate}` },
          ':end': { S: `EVENT#${endDate}~` },
        },
        ScanIndexForward: true,
      });

      const result = await this.dynamoClient.send(command);
      return (result.Items || []).map((item) => unmarshall(item));
    } catch (error) {
      this.logger.warn(`Failed to get recent events for lot ${lotId}`, error);
      return [];
    }
  }

  private async getHistoricalAccuracy(_lotId: string): Promise<number | null> {
    // TODO: Compare past predictions against verified data
    void _lotId;
    return null;
  }
}
