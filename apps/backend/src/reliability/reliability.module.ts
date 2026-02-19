import { Module } from '@nestjs/common';
import { ReliabilityService } from './reliability.service';
import { ReliabilityComputationService } from './reliability-computation.service';
import { ReliabilityController } from './reliability.controller';

/**
 * ReliabilityModule
 *
 * Provides reliability meter functionality for computing and
 * serving confidence levels for parking lot occupancy data.
 */
@Module({
  controllers: [ReliabilityController],
  providers: [ReliabilityService, ReliabilityComputationService],
  exports: [ReliabilityService, ReliabilityComputationService],
})
export class ReliabilityModule {}
