import { Controller, Get, Param, Logger } from '@nestjs/common';
import { ReliabilityService } from './reliability.service';
import { ReliabilityComputationService } from './reliability-computation.service';
import { ReliabilityScore, ReliabilityScoreSummary, ReliabilityWeights, ReliabilityThresholds } from './interfaces';

@Controller('reliability')
export class ReliabilityController {
  private readonly logger = new Logger(ReliabilityController.name);

  constructor(
    private readonly reliabilityService: ReliabilityService,
    private readonly computationService: ReliabilityComputationService,
  ) {}

  @Get('lots/:lotId')
  async getLotReliability(@Param('lotId') lotId: string): Promise<ReliabilityScore> {
    this.logger.log(`Getting reliability for lot ${lotId}`);
    return this.computationService.computeReliabilityForLot(lotId);
  }

  @Get('lots')
  async getAllLotsReliability(): Promise<ReliabilityScoreSummary[]> {
    this.logger.log('Getting reliability for all lots');
    return this.computationService.computeReliabilityForAllLots();
  }

  @Get('config')
  getConfiguration(): { weights: ReliabilityWeights; thresholds: ReliabilityThresholds } {
    return {
      weights: this.reliabilityService.getDefaultWeights(),
      thresholds: this.reliabilityService.getDefaultThresholds(),
    };
  }
}
