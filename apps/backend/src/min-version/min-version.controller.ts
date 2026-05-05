import { Controller, Get, Headers } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { MinVersionService } from './min-version.service';

/**
 * GET /api/v1/min-version
 *
 * Returned envelope is unwrapped by the mobile `apiService` (PR #160), so the
 * inner `data` shape MUST stay `{ minSupportedVersion: string }` — that is the
 * field the force-update gate in `apps/mobile/App.tsx` reads. Do NOT change the
 * shape without coordinating a mobile release; the mobile gate fail-opens on a
 * parse miss, which would silently disable force-update for every user.
 *
 * The per-platform floor is resolved server-side from the `x-platform` request
 * header (sent by mobile via `API_CONFIG.DEFAULT_HEADERS`). Old clients that
 * pre-date the header just get the global floor — see MinVersionService for
 * the resolution order. Keeping the response shape platform-agnostic means
 * mobile never has to know per-platform floors exist; the backend can change
 * the resolution logic without a coordinated mobile release.
 *
 * Public + skip throttle: this endpoint is the very first request the app makes
 * on launch (before auth), and a 429 here would block the user from entering
 * the app at all.
 */
@Public()
@SkipThrottle()
@Controller('min-version')
export class MinVersionController {
  constructor(private readonly minVersionService: MinVersionService) {}

  @Get()
  getMinVersion(
    @Headers('x-platform') platform?: string,
  ): { success: true; data: { minSupportedVersion: string } } {
    return {
      success: true,
      data: {
        minSupportedVersion: this.minVersionService.getMinSupportedVersion(platform),
      },
    };
  }
}
