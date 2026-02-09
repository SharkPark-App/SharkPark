import { Injectable, Inject, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { DYNAMODB_CLIENT, TABLE_NAME, TIMESERIES_TABLE_NAME } from '../database/database.module';
import type { ParkingLot, ParkingLotResponse, GetLotsQueryParams, OccupancySnapshot } from './interfaces/parking-lot.interface';

/**
 * Service for parking lot data access and business logic.
 * Queries DynamoDB for lot metadata and timeseries occupancy data.
 */
@Injectable()
export class LotsService {
  private readonly logger = new Logger(LotsService.name);

  constructor(
    @Inject(DYNAMODB_CLIENT) private readonly dynamoClient: DynamoDBClient,
    @Inject(TABLE_NAME) private readonly tableName: string,
    @Inject(TIMESERIES_TABLE_NAME) private readonly timeseriesTableName: string,
  ) {}

  /**
   * Retrieves all parking lots, with optional filtering.
   * Fetches from GSI and applies client-side filters for flexibility.
   */
  async findAll(query: GetLotsQueryParams = {}): Promise<ParkingLotResponse[]> {
    try {
      // Query GSI to get all parking lots
      const command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1-EntityType-Timestamp',
        KeyConditionExpression: 'EntityType = :type',
        ExpressionAttributeValues: {
          ':type': { S: 'ParkingLot' },
        },
      });

      const result = await this.dynamoClient.send(command);
      const lots = (result.Items?.map(item => unmarshall(item)) || []) as ParkingLot[];

      // Apply client-side filters
      let filteredLots = lots;

      if (query.type) {
        filteredLots = filteredLots.filter(lot => lot.lot_type === query.type);
      }

      if (query.permit_type) {
        filteredLots = filteredLots.filter(lot => 
          lot.permit_types.includes(query.permit_type!)
        );
      }

      if (query.daily_permit !== undefined) {
        filteredLots = filteredLots.filter(lot => 
          lot.daily_permit_allowed === query.daily_permit
        );
      }

      if (query.ev_charging) {
        filteredLots = filteredLots.filter(lot => lot.ev_charging_stations > 0);
      }

      if (query.min_available) {
        filteredLots = filteredLots.filter(lot => 
          (lot.capacity - lot.current_occupancy) >= query.min_available!
        );
      }

      if (query.available_only) {
        filteredLots = filteredLots.filter(lot => 
          lot.current_occupancy < lot.capacity
        );
      }

      return filteredLots.map(lot => this.transformToResponse(lot));

    } catch (error) {
      this.logger.error('Failed to fetch parking lots', error);
      throw new InternalServerErrorException('Failed to fetch parking lots');
    }
  }

  async findOne(lotId: string): Promise<ParkingLotResponse> {
    try {
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': { S: `LOT#${lotId}` },
          ':sk': { S: 'METADATA' },
        },
      });

      const result = await this.dynamoClient.send(command);

      if (!result.Items || result.Items.length === 0) {
        throw new NotFoundException(`Parking lot ${lotId} not found`);
      }

      const lot = unmarshall(result.Items[0]) as ParkingLot;
      return this.transformToResponse(lot);

    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch lot ${lotId}`, error);
      throw new InternalServerErrorException(`Failed to fetch parking lot ${lotId}`);
    }
  }

  /**
   * Retrieves historical occupancy snapshots for a specific lot and date.
   * Data is stored in the timeseries table, partitioned by lot+date.
   */
  async getHistory(
    lotId: string,
    date: string,
    limit: number = 96,
  ): Promise<OccupancySnapshot[]> {
    try {
      // Query timeseries table for historical occupancy snapshots
      const command = new QueryCommand({
        TableName: this.timeseriesTableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `LOT#${lotId}#${date}` },
        },
        Limit: limit,
        ScanIndexForward: false, // Most recent first
      });

      const result = await this.dynamoClient.send(command);
      return (result.Items?.map(item => unmarshall(item)) || []) as OccupancySnapshot[];

    } catch (error) {
      this.logger.error(`Failed to fetch history for lot ${lotId}`, error);
      throw new InternalServerErrorException(`Failed to fetch historical data for lot ${lotId}`);
    }
  }

  async getOccupancySummary(): Promise<{
    total_lots: number;
    total_capacity: number;
    total_occupied: number;
    total_available: number;
    overall_occupancy_rate: number;
    student_lots: { count: number; capacity: number; occupied: number };
    employee_lots: { count: number; capacity: number; occupied: number };
  }> {
    try {
      const lots = await this.findAll();

      const studentLots = lots.filter(lot => lot.lot_type === 'STUDENT');
      const employeeLots = lots.filter(lot => lot.lot_type === 'EMPLOYEE');

      const totalCapacity = lots.reduce((sum, lot) => sum + lot.capacity, 0);
      const totalOccupied = lots.reduce((sum, lot) => sum + lot.current_occupancy, 0);

      return {
        total_lots: lots.length,
        total_capacity: totalCapacity,
        total_occupied: totalOccupied,
        total_available: totalCapacity - totalOccupied,
        overall_occupancy_rate: totalCapacity > 0 ? totalOccupied / totalCapacity : 0,
        student_lots: {
          count: studentLots.length,
          capacity: studentLots.reduce((sum, lot) => sum + lot.capacity, 0),
          occupied: studentLots.reduce((sum, lot) => sum + lot.current_occupancy, 0),
        },
        employee_lots: {
          count: employeeLots.length,
          capacity: employeeLots.reduce((sum, lot) => sum + lot.capacity, 0),
          occupied: employeeLots.reduce((sum, lot) => sum + lot.current_occupancy, 0),
        },
      };

    } catch (error) {
      this.logger.error('Failed to calculate occupancy summary', error);
      throw new InternalServerErrorException('Failed to calculate occupancy summary');
    }
  }

  /**
   * Adds computed fields to parking lot data for client consumption.
   * Calculates available spaces, occupancy rate, and categorical fill status.
   */
  private transformToResponse(lot: ParkingLot): ParkingLotResponse {
    const available = lot.capacity - lot.current_occupancy;
    const occupancy_rate = lot.capacity > 0 ? lot.current_occupancy / lot.capacity : 0;
    
    let fill_status: 'AVAILABLE' | 'FILLING' | 'NEARLY_FULL' | 'FULL';
    if (occupancy_rate >= 0.95) {
      fill_status = 'FULL';
    } else if (occupancy_rate >= 0.80) {
      fill_status = 'NEARLY_FULL';
    } else if (occupancy_rate >= 0.60) {
      fill_status = 'FILLING';
    } else {
      fill_status = 'AVAILABLE';
    }

    return {
      ...lot,
      available,
      occupancy_rate: Math.round(occupancy_rate * 1000) / 1000,
      fill_status,
    };
  }
}
