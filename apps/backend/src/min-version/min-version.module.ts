import { Module } from '@nestjs/common';
import { MinVersionController } from './min-version.controller';
import { MinVersionService } from './min-version.service';

@Module({
  controllers: [MinVersionController],
  providers: [MinVersionService],
})
export class MinVersionModule {}
