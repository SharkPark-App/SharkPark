import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import {
  AdminPenetrationRateService,
  type AdminPenetrationRateResponse,
} from './admin-penetration-rate.service';

/**
 * GET /admin/penetration-rate/:lotId
 *
 * Returns the learned EWMA penetration-rate grid (24 hours × 3 dow_buckets,
 * sparse) for one lot, plus the gating thresholds the runtime uses to decide
 * whether each cell will actually be blended into the live estimate.
 *
 * `:lotId` accepts either the cuid PK or the human-readable code (e.g. "G1").
 *
 * Authentication: x-admin-api-key header validated by AdminApiKeyGuard.
 * Marked @Public() to bypass the global AzureAdGuard (operators don't have
 * Azure AD identities); AdminApiKeyGuard is what actually protects the route.
 *
 * NOT a public endpoint — the learned values are derived from device counts
 * and could leak rough estimates of campus population. Operator-only.
 */
@Public()
@Controller('admin/penetration-rate')
@UseGuards(AdminApiKeyGuard)
export class AdminPenetrationRateController {
  constructor(private readonly service: AdminPenetrationRateService) {}

  @Get(':lotId')
  async get(@Param('lotId') lotId: string): Promise<AdminPenetrationRateResponse> {
    return this.service.getForLot(lotId);
  }
}
