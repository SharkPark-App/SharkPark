import { Module } from '@nestjs/common';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { PenetrationEstimationService } from './penetration-estimation.service';
import { PermitFeesController } from './permit-fees.controller';
import { WeatherModule } from '../weather/weather.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [WeatherModule, AuthModule, EventsModule],
  controllers: [LotsController, PermitFeesController],
  providers: [LotsService, PenetrationEstimationService],
  exports: [LotsService, PenetrationEstimationService],
})
export class LotsModule {}
