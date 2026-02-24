import { Module } from '@nestjs/common';
import { ParkingValidationService } from './parking-validation.service';
import { ParkingValidationController } from './parking-validation.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ParkingValidationController],
  providers: [ParkingValidationService],
  exports: [ParkingValidationService], // Export service so other modules can use it
})
export class ParkingValidationModule {}
