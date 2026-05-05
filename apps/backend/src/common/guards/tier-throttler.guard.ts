import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { ContributorService } from '../../auth/contributor.service';

// These metadata keys are not exported from the @nestjs/throttler public API
// but are stable in v6. See throttler.constants.js in the package dist.
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const THROTTLER_SKIP = 'THROTTLER:SKIP';

const TIER_PREFIX = 'tier-';
const TIER_PUBLIC = 'tier-public';
const TIER_CONTRIBUTOR = 'tier-contributor';
const TIER_AUTHED = 'tier-authed';

type TierName = typeof TIER_PUBLIC | typeof TIER_CONTRIBUTOR | typeof TIER_AUTHED;

/**
 * Replaces the stock ThrottlerGuard as the global APP_GUARD.
 *
 * # Tier selection
 *
 * Tier is derived **server-side** — the `x-app-mode` header from the client
 * is intentionally ignored, because trusting it would let any caller claim
 * the highest-tier rate budget by spoofing one header. Resolution order:
 *
 *   1. `Authorization: Bearer <token>` present  → `tier-authed` (1200 req/min)
 *      The bearer is NOT verified here; AzureAdGuard runs after this guard
 *      and rejects forged tokens. We only use the header's presence as a
 *      hint that this *client* intends to use the authed budget. A spoofed
 *      bearer therefore costs the spoofer their own per-device budget on
 *      requests that ultimately 401 — it cannot help them DoS others.
 *   2. `x-device-id` resolves to a current `ContributorPing` → `tier-contributor`
 *      (600 req/min). Uses the same freshness check as the read-redaction
 *      pipeline, so contributor budget appears the moment redaction would
 *      lift — no race between the two systems.
 *   3. Otherwise                                → `tier-public` (120 req/min).
 *
 * # Bucket model
 *
 * - `default`           — global burst safety (20 req / 10 s). Runs on every
 *                         request unless `@SkipThrottle()` is set. Per-route
 *                         `@Throttle({ default: ... })` overrides are honoured.
 * - `read`              — opt-in hot-read bucket. Only enforced when a route
 *                         declares `@Throttle({ read: ... })` (e.g. LotsController).
 * - `tier-{public|contributor|authed}` — sustained per-tier limits. Only the
 *                         single bucket matching the server-derived tier runs.
 *
 * # Tracking key
 *
 * All buckets are keyed by `device:<x-device-id>` when the header is present,
 * falling back to the request IP. This prevents shared-NAT pools (e.g. campus
 * Wi-Fi) from collectively exhausting one budget.
 *
 * # Skip semantics
 *
 * `@SkipThrottle()` (no args) writes `THROTTLER:SKIPdefault = true`. We honour
 * it as the conventional "skip everything" marker (matches stock NestJS).
 * `@SkipThrottle({ name: true })` continues to skip only the named bucket.
 */
@Injectable()
export class TierThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly contributorService: ContributorService,
  ) {
    super(options, storageService, reflector);
  }

  override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return (
      this.reflector.getAllAndOverride<boolean>(THROTTLER_SKIP + 'default', [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (await this.shouldSkip(context)) return true;

    const handler = context.getHandler();
    const classRef = context.getClass();
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();

    const tierName = await this.resolveTier(req);

    type NamedThrottler = (typeof this.throttlers)[number] & { name: string };
    const throttlers = this.throttlers as NamedThrottler[];

    const continues: boolean[] = [];
    for (const namedThrottler of throttlers) {
      const isTier = namedThrottler.name.startsWith(TIER_PREFIX);

      // Run only the matching tier bucket; skip the others.
      if (isTier && namedThrottler.name !== tierName) {
        continues.push(true);
        continue;
      }

      const skip = this.reflector.getAllAndOverride<boolean>(
        THROTTLER_SKIP + namedThrottler.name,
        [handler, classRef],
      );
      const skipIf = namedThrottler.skipIf ?? this.commonOptions.skipIf;
      if (skip || skipIf?.(context)) {
        continues.push(true);
        continue;
      }

      const routeLimit = this.reflector.getAllAndOverride<number>(
        THROTTLER_LIMIT + namedThrottler.name,
        [handler, classRef],
      );
      const routeTtl = this.reflector.getAllAndOverride<number>(
        THROTTLER_TTL + namedThrottler.name,
        [handler, classRef],
      );

      // `read` is opt-in per route — skip unless a route declared @Throttle({ read: ... }).
      if (namedThrottler.name === 'read' && routeLimit === undefined) {
        continues.push(true);
        continue;
      }

      const resolvedLimit =
        typeof namedThrottler.limit === 'function'
          ? await namedThrottler.limit(context)
          : namedThrottler.limit;
      const resolvedTtl =
        typeof namedThrottler.ttl === 'function'
          ? await namedThrottler.ttl(context)
          : namedThrottler.ttl;
      const resolvedBlockDuration =
        typeof namedThrottler.blockDuration === 'function'
          ? await namedThrottler.blockDuration(context)
          : namedThrottler.blockDuration;

      const limit = routeLimit ?? resolvedLimit ?? 0;
      const ttl = routeTtl ?? resolvedTtl ?? 0;
      const blockDuration = resolvedBlockDuration ?? ttl;

      continues.push(
        await this.handleRequest({
          context,
          limit,
          ttl,
          throttler: namedThrottler,
          blockDuration,
          getTracker: this.deviceOrIpTracker,
          generateKey: this.commonOptions.generateKey!,
        }),
      );
    }
    return continues.every((c) => c);
  }

  /**
   * Server-side tier derivation. NEVER trust `x-app-mode` for budget grant.
   * Order: bearer presence → contributor freshness → public.
   */
  private async resolveTier(req: {
    headers: Record<string, string | string[] | undefined>;
  }): Promise<TierName> {
    const auth = req.headers.authorization;
    const authStr = Array.isArray(auth) ? auth[0] : auth;
    if (typeof authStr === 'string' && authStr.toLowerCase().startsWith('bearer ')) {
      return TIER_AUTHED;
    }
    const isContributor = await this.contributorService.isContributor(
      req.headers['x-device-id'],
    );
    return isContributor ? TIER_CONTRIBUTOR : TIER_PUBLIC;
  }

  /**
   * Per-device tracker so shared NAT (campus Wi-Fi) doesn't pool one budget
   * across hundreds of phones. Falls back to IP for callers that don't send
   * `x-device-id` (which is the same set we want IP-rate-limited anyway).
   */
  private deviceOrIpTracker = async (req: {
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
    socket?: { remoteAddress?: string };
  }): Promise<string> => {
    const raw = req.headers?.['x-device-id'];
    const device = Array.isArray(raw) ? raw[0] : raw;
    if (typeof device === 'string' && device.trim().length > 0) {
      return `dev:${device.trim()}`;
    }
    return `ip:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;
  };
}
