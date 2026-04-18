import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OccupancyEventsService } from './occupancy-events.service';

/** Scheduler for automated occupancy snapshot generation and stale session cleanup */
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

  /**
   * Clean up stale DeviceState ENTER records daily at 3 AM (Pacific).
   *
   * If a user sent ENTER but never sent EXIT (app killed, phone died,
   * permissions revoked), their +1 sticks on the lot forever. This cron
   * finds ENTER records older than 18 hours, decrements the lot occupancy,
   * and deletes the stale DeviceState row.
   *
   * 18 hours is generous enough for long parking sessions (e.g. 6 AM → midnight)
   * while catching truly abandoned sessions before the next morning rush.
   */
  @Cron('0 0 3 * * *', { timeZone: 'America/Los_Angeles' })
  async handleStaleCleanupCron(): Promise<void> {
    this.logger.log('Starting stale device state cleanup...');

    try {
      const result = await this.occupancyEventsService.cleanupStaleDeviceStates(18);
      this.logger.log(`Stale cleanup complete: ${result.cleaned} stale ENTER records cleaned`);
    } catch (error) {
      this.logger.error(
        `Failed to clean up stale device states: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }
}
