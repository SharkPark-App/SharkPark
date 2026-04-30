import { Module } from '@nestjs/common';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { PenetrationEstimationService } from './penetration-estimation.service';
import { EventsModule } from '../events/events.module';
import { WeatherModule } from '../weather/weather.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [EventsModule, WeatherModule, AuthModule],
  controllers: [LotsController],
  providers: [LotsService, PenetrationEstimationService],
  exports: [LotsService, PenetrationEstimationService],
})
export class LotsModule {}
