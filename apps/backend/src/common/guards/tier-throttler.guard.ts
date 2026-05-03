import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

// These metadata keys are not exported from the @nestjs/throttler public API
// but are stable in v6. See throttler.constants.js in the package dist.
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const THROTTLER_SKIP = 'THROTTLER:SKIP';

const TIER_NAMES = new Set(['tier-public', 'tier-contributor', 'tier-authed']);

/**
 * Replaces the default ThrottlerGuard as the global APP_GUARD.
 *
 * Tier selection (from x-app-mode header):
 *   'public'      → 60 req/min
 *   'contributor' → 300 req/min
 *   'authed'      → 600 req/min
 *
 * Routes that declare an explicit @Throttle({ read: {...} }) override are
 * treated as having their own budget — tier throttlers are skipped for them
 * and only the declared throttler(s) run. This preserves the existing
 * @Throttle({ read: ... }) behaviour on LotsController.
 */
@Injectable()
export class TierThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (await this.shouldSkip(context)) return true;

    const handler = context.getHandler();
    const classRef = context.getClass();
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[]> }>();

    const rawMode = req.headers['x-app-mode'];
    const mode = Array.isArray(rawMode) ? rawMode[0] : rawMode;
    const tierName =
      mode === 'authed'
        ? 'tier-authed'
        : mode === 'contributor'
          ? 'tier-contributor'
          : 'tier-public';

    // Detect whether the route carries an explicit @Throttle() for any
    // non-tier throttler (e.g. 'read'). If so, those limits apply and the
    // tier throttlers are bypassed — the route is already self-budgeted.
    // onModuleInit guarantees name is set (falls back to 'default'); the cast
    // avoids repetitive non-null assertions throughout the loop below.
    type NamedThrottler = (typeof this.throttlers)[number] & { name: string };
    const throttlers = this.throttlers as NamedThrottler[];

    const hasExplicitThrottle = throttlers
      .filter((t) => !TIER_NAMES.has(t.name))
      .some(
        (t) =>
          this.reflector.getAllAndOverride<number | undefined>(
            THROTTLER_LIMIT + t.name,
            [handler, classRef],
          ) !== undefined,
      );

    const continues: boolean[] = [];
    for (const namedThrottler of throttlers) {
      const isTier = TIER_NAMES.has(namedThrottler.name);

      if (isTier) {
        // Only apply the tier that matches x-app-mode; skip all others.
        // Also skip tier throttlers entirely when the route has @Throttle().
        if (hasExplicitThrottle || namedThrottler.name !== tierName) {
          continues.push(true);
          continue;
        }
      } else {
        // Non-tier throttler (e.g. 'read'): skip unless the route declared it.
        if (!hasExplicitThrottle) {
          continues.push(true);
          continue;
        }
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
          getTracker: this.commonOptions.getTracker!,
          generateKey: this.commonOptions.generateKey!,
        }),
      );
    }
    return continues.every((c) => c);
  }
}
