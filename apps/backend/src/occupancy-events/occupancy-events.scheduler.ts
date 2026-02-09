import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OccupancyEventsService } from './occupancy-events.service';

/** Scheduler for automated occupancy snapshot generation every 15 minutes */
@Injectable()
export class OccupancyEventsScheduler {
  private readonly logger = new Logger(OccupancyEventsScheduler.name);

  constructor(
    private readonly occupancyEventsService: OccupancyEventsService,
  ) {}

  /** Creates occupancy snapshots for all lots - used for ML training data */
  @Cron('0 */15 * * * *')
  async handleSnapshotCron(): Promise<void> {
    this.logger.log('Starting scheduled occupancy snapshot generation...');
    
    try {
      // Create snapshots for all lots (service fetches lots internally)
      const result = await this.occupancyEventsService.createSnapshots();

      this.logger.log(
        `Successfully created ${result.count} occupancy snapshots for ML training at ${result.timestamp}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to create occupancy snapshots: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }
}
