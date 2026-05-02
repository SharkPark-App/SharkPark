import { Controller, Get, Param, Logger, UseGuards } from '@nestjs/common';
import { ReliabilityService } from './reliability.service';
import { ReliabilityComputationService } from './reliability-computation.service';
import { ReliabilityScore, ReliabilityScoreSummary, ReliabilityWeights, ReliabilityThresholds } from './interfaces';
import { Public } from '../auth/public.decorator';
import { ContributorGuard } from '../auth/contributor.guard';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Public()
@Controller('reliability')
export class ReliabilityController {
  private readonly logger = new Logger(ReliabilityController.name);

  constructor(
    private readonly reliabilityService: ReliabilityService,
    private readonly computationService: ReliabilityComputationService,
  ) {}

  // Reliability is a live signal computed from the same contributor stream
  // that powers /lots/summary and the forecast endpoints. Gating it behind
  // ContributorGuard keeps the redacted-non-contributor experience consistent
  // — no live occupancy, no forecasts, no reliability meter.
  @Get('lots/:lotId')
  @UseGuards(ContributorGuard)
  async getLotReliability(@Param('lotId') lotId: string): Promise<ApiResponse<ReliabilityScore>> {
    const result = await this.computationService.computeReliabilityForLot(lotId);
    this.logger.log(`Lot ${lotId}: score=${result.score}, confidence=${result.confidence}`);
    return { success: true, data: result };
  }

  @Get('lots')
  @UseGuards(ContributorGuard)
  async getAllLotsReliability(): Promise<ApiResponse<ReliabilityScoreSummary[]>> {
    this.logger.log('Getting reliability for all lots');
    const result = await this.computationService.computeReliabilityForAllLots();
    return { success: true, data: result };
  }

  @Get('config')
  getConfiguration(): ApiResponse<{ weights: ReliabilityWeights; thresholds: ReliabilityThresholds }> {
    return {
      success: true,
      data: {
        weights: this.reliabilityService.getDefaultWeights(),
        thresholds: this.reliabilityService.getDefaultThresholds(),
      },
    };
  }
}
