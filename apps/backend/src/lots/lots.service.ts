import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { Lot, LotType } from '@prisma/client';
import type { ParkingLotResponse, GetLotsQueryParams, OccupancySnapshotResponse } from './interfaces/parking-lot.interface';

/**
 * Service for parking lot data access and business logic.
 * Queries PostgreSQL via Prisma for lot metadata and timeseries occupancy data.
 */
@Injectable()
export class LotsService {
  private readonly logger = new Logger(LotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves all parking lots, with optional filtering.
   * Prisma WHERE clauses replace client-side filtering from DynamoDB.
   */
  async findAll(query: GetLotsQueryParams = {}): Promise<ParkingLotResponse[]> {
    try {
      const lots = await this.prisma.lot.findMany({
        where: {
          ...(query.type && { lot_type: query.type as LotType }),
          ...(query.permit_type && { permit_types: { has: query.permit_type } }),
          ...(query.daily_permit !== undefined && { daily_permit_allowed: query.daily_permit }),
          ...(query.ev_charging && { ev_charging_stations: { gt: 0 } }),
        },
      });

      let filteredLots = lots;

      // These filters require computed values, so apply after fetch
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
      const lot = await this.prisma.lot.findFirst({
        where: { lot_id: lotId },
      });

      if (!lot) {
        throw new NotFoundException(`Parking lot ${lotId} not found`);
      }

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
   */
  async getHistory(
    lotId: string,
    date: string,
    limit: number = 96,
  ): Promise<OccupancySnapshotResponse[]> {
    try {
      // Find the lot's internal ID from the human-readable lot_id
      const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
      if (!lot) {
        throw new NotFoundException(`Parking lot ${lotId} not found`);
      }

      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      const snapshots = await this.prisma.occupancySnapshot.findMany({
        where: {
          lot_id: lot.id,
          timestamp: { gte: startOfDay, lte: endOfDay },
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return snapshots.map(s => ({
        lot_id: lotId,
        timestamp: s.timestamp.toISOString(),
        occupancy: s.occupancy,
        available: s.available,
        occupancy_rate: s.occupancy_rate,
        confidence: s.confidence,
      }));
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
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
   */
  private transformToResponse(lot: Lot): ParkingLotResponse {
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

