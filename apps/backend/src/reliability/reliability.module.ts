import { Module } from '@nestjs/common';
import { ReliabilityService } from './reliability.service';
import { ReliabilityComputationService } from './reliability-computation.service';
import { ReliabilityController } from './reliability.controller';
import { AuthModule } from '../auth/auth.module';

/**
 * ReliabilityModule
 *
 * Provides reliability meter functionality for computing and
 * serving confidence levels for parking lot occupancy data.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReliabilityController],
  providers: [ReliabilityService, ReliabilityComputationService],
  exports: [ReliabilityService, ReliabilityComputationService],
})
export class ReliabilityModule {}
