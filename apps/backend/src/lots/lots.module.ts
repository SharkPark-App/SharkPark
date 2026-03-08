import { Module } from '@nestjs/common';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { PenetrationEstimationService } from './penetration-estimation.service';

@Module({
  controllers: [LotsController],
  providers: [LotsService, PenetrationEstimationService],
  exports: [LotsService, PenetrationEstimationService],
})
export class LotsModule {}
