import { Module } from '@nestjs/common';
import { MinVersionController } from './min-version.controller';

@Module({
  controllers: [MinVersionController],
})
export class MinVersionModule {}
