import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import {
  AdminConsensusService,
  type AdminConsensusResponse,
} from './admin-consensus.service';

/**
 * GET /admin/consensus/:lotId?date=YYYY-MM-DD
 *
 * Operator-only view of the per-5-min consensus rows produced by
 * `ConsensusService` (live tick + B3 backfill). Used to spot-check that
 * the pipeline is producing sane agreement scores after a deploy or
 * backfill run.
 *
 * `:lotId` accepts either the cuid PK or the human-readable code (e.g. "G1").
 *
 * Authentication: x-admin-api-key header validated by AdminApiKeyGuard.
 * Marked @Public() to bypass the global AzureAdGuard (operators don't have
 * Azure AD identities); AdminApiKeyGuard is what actually protects the route.
 *
 * NOT a public endpoint: device hashes never appear in the response and
 * never will — only aggregated agreement metrics. Do NOT add per-event
 * detail without a privacy review.
 */
@Public()
@Controller('admin/consensus')
@UseGuards(AdminApiKeyGuard)
export class AdminConsensusController {
  constructor(private readonly service: AdminConsensusService) {}

  @Get(':lotId')
  async get(
    @Param('lotId') lotId: string,
    @Query('date') date: string,
  ): Promise<AdminConsensusResponse> {
    return this.service.getForLotDate(lotId, date);
  }
}
