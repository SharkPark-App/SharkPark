import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ContributorService } from './contributor.service';

/**
 * Reciprocity gate: a request can read live-occupancy / forecast data only if
 * the device behind it is *currently contributing* OR is inside its first-run
 * grace window after granting location permissions. The client identifies
 * itself with the `x-device-id` header (same opaque identifier it uses in
 * POST /occupancy-events).
 *
 * The actual freshness logic lives in {@link ContributorService.isContributor}
 * — this guard is a thin "translate `false` into 403" wrapper so that Public
 * endpoints that need the same boolean for *redaction* (rather than
 * rejection) can share one definition.
 *
 * Failure shape (mobile maps `code === 'BG_LOCATION_REQUIRED'` to the
 * soft-ask UX, NOT a generic error):
 *
 *   403 { code: 'BG_LOCATION_REQUIRED', message: '...' }
 *
 * This guard is opt-in per controller/handler with @UseGuards(ContributorGuard);
 * it does NOT replace AzureAdGuard. Endpoints that are also auth-gated will
 * stack both guards.
 */
@Injectable()
export class ContributorGuard implements CanActivate {
  private readonly logger = new Logger(ContributorGuard.name);

  constructor(private readonly contributorService: ContributorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const rawHeader = req.headers['x-device-id'];

    const allowed = await this.contributorService.isContributor(rawHeader);
    if (allowed) return true;

    throw new ForbiddenException({
      code: 'BG_LOCATION_REQUIRED',
      message:
        'This endpoint requires an active contributor device. Send the x-device-id header and ensure the device has granted location permissions.',
    });
  }
}
