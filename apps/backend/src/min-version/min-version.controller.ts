import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';

@Public()
@Controller('min-version')
@SkipThrottle()
export class MinVersionController {
  @Get()
  getMinVersion() {
    return {
      success: true,
      data: {
        ios: { min: '1.0.0', current: '1.0.0' },
        android: { min: '1.0.0', current: '1.0.0' },
      },
    };
  }
}
