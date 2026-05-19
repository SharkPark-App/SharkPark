import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { CSULB_PERMIT_FEES } from './permit-fees';

/**
 * Returns the static CSULB visitor / permit fee schedule.
 *
 * Fees change at most once per fiscal year (Sep 1) and never per-device, so
 * we cache aggressively at the edge (1 day) and let the mobile client cache
 * locally too. The `check-permit-fee-drift` cron monitors the CSULB source
 * page weekly during the July–August window when CSULB typically posts the
 * new fiscal-year schedule and opens a Sentry warning when the page changes,
 * which triggers a PR to update `permit-fees.ts`.
 */
@Public()
@Controller('permit-fees')
@Throttle({ read: { ttl: 60_000, limit: 600 } })
export class PermitFeesController {
  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=86400, s-maxage=86400')
  getPermitFees() {
    return {
      success: true,
      data: CSULB_PERMIT_FEES,
    };
  }
}
