import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { AdminConsensusController } from './admin-consensus.controller';
import { AdminConsensusService } from './admin-consensus.service';
import { AdminPenetrationRateController } from './admin-penetration-rate.controller';
import { AdminPenetrationRateService } from './admin-penetration-rate.service';
import { MlStatusController } from './ml-status.controller';
import { MlStatusService } from './ml-status.service';

/**
 * Operational endpoints for SharkPark admins. Currently:
 *   - GET /admin/ml-status                  — ML cron run history + rollup
 *   - GET /admin/consensus/:lotId           — per-5-min consensus rows for one lot/day
 *   - GET /admin/penetration-rate/:lotId    — learned EWMA grid + blending thresholds
 *
 * Every controller here is gated by AdminApiKeyGuard. Do NOT add
 * mutating endpoints without first upgrading auth to a per-operator
 * credential + audit-event row.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    MlStatusController,
    AdminConsensusController,
    AdminPenetrationRateController,
  ],
  providers: [
    AdminApiKeyGuard,
    MlStatusService,
    AdminConsensusService,
    AdminPenetrationRateService,
  ],
})
export class AdminModule {}
