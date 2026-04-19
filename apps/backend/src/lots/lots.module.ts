import { Module } from '@nestjs/common';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { PenetrationEstimationService } from './penetration-estimation.service';
import { EventsModule } from '../events/events.module';
import { WeatherModule } from '../weather/weather.module';

@Module({
  imports: [EventsModule, WeatherModule],
  controllers: [LotsController],
  providers: [LotsService, PenetrationEstimationService],
  exports: [LotsService, PenetrationEstimationService],
})
export class LotsModule {}
