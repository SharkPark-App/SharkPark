import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { TierThrottlerGuard } from './tier-throttler.guard';
import { ContributorService } from '../../auth/contributor.service';

const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const THROTTLER_SKIP = 'THROTTLER:SKIP';

type FakeReq = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
};

function makeContext(req: FakeReq): ExecutionContext {
  const handler = () => undefined;
  class FakeController {}
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ header: () => undefined, setHeader: () => undefined }),
    }),
    getHandler: () => handler,
    getClass: () => FakeController,
    getType: () => 'http',
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
  } as unknown as ExecutionContext;
}

const buckets: ThrottlerModuleOptions = [
  { name: 'default', ttl: 10_000, limit: 20 },
  { name: 'read', ttl: 60_000, limit: 600 },
  { name: 'tier-public', ttl: 60_000, limit: 120 },
  { name: 'tier-contributor', ttl: 60_000, limit: 600 },
  { name: 'tier-authed', ttl: 60_000, limit: 1200 },
];

function makeStorage(): ThrottlerStorage {
  return {
    increment: jest.fn().mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  } as unknown as ThrottlerStorage;
}

class StubReflector {
  private map = new Map<string, unknown>();
  set(key: string, value: unknown) {
    this.map.set(key, value);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getAllAndOverride<T>(key: string, _targets: unknown[]): T | undefined {
    return this.map.get(key) as T | undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getAllAndMerge<T>(_key: string, _targets: unknown[]): T {
    return [] as unknown as T;
  }
}

function buildGuard(opts: {
  isContributor?: boolean;
  reflector?: StubReflector;
} = {}) {
  const reflector = opts.reflector ?? new StubReflector();
  const contributor = {
    isContributor: jest.fn().mockResolvedValue(opts.isContributor ?? false),
  } as unknown as ContributorService;
  const guard = new TierThrottlerGuard(
    buckets,
    makeStorage(),
    reflector as unknown as Reflector,
    contributor,
  );
  // The parent ThrottlerGuard normally populates `this.throttlers` in its
  // onApplicationBootstrap hook (Nest lifecycle), so mirror that here.
  (guard as unknown as { throttlers: unknown[] }).throttlers = (
    buckets as unknown as Array<Record<string, unknown>>
  ).map((b) => ({ ...b }));
  // Same for commonOptions (used for skipIf and generateKey defaults).
  (guard as unknown as { commonOptions: Record<string, unknown> }).commonOptions = {
    skipIf: undefined,
    generateKey: (_ctx: unknown, key: string, name: string) => `${name}:${key}`,
  };
  // Stub handleRequest to record which buckets ran with which tracker key.
  const calls: Array<{ name: string; key: string; limit: number; ttl: number }> = [];
  (guard as unknown as { handleRequest: jest.Mock }).handleRequest = jest.fn(
    async (info: {
      throttler: { name: string };
      limit: number;
      ttl: number;
      context: ExecutionContext;
      getTracker: (req: unknown, ctx: ExecutionContext) => Promise<string>;
    }) => {
      const key = await info.getTracker(info.context.switchToHttp().getRequest(), info.context);
      calls.push({
        name: info.throttler.name,
        key,
        limit: info.limit,
        ttl: info.ttl,
      });
      return true;
    },
  );
  return { guard, contributor, reflector, calls };
}

describe('TierThrottlerGuard', () => {
  describe('resolveTier (server-side, ignores x-app-mode)', () => {
    it('uses tier-public when x-app-mode=authed is spoofed without a bearer token', async () => {
      const { guard, calls, contributor } = buildGuard();
      await guard.canActivate(
        makeContext({ headers: { 'x-app-mode': 'authed', 'x-device-id': 'dev-1' }, ip: '1.2.3.4' }),
      );
      expect(contributor.isContributor).toHaveBeenCalledWith('dev-1');
      const tierBuckets = calls.filter((c) => c.name.startsWith('tier-'));
      expect(tierBuckets).toHaveLength(1);
      expect(tierBuckets[0].name).toBe('tier-public');
    });

    it('uses tier-authed when Authorization: Bearer is present (case-insensitive)', async () => {
      const { guard, calls } = buildGuard();
      await guard.canActivate(
        makeContext({ headers: { authorization: 'bearer abc.def.ghi' }, ip: '1.2.3.4' }),
      );
      const tierBuckets = calls.filter((c) => c.name.startsWith('tier-'));
      expect(tierBuckets).toHaveLength(1);
      expect(tierBuckets[0].name).toBe('tier-authed');
      expect(tierBuckets[0].limit).toBe(1200);
    });

    it('uses tier-contributor when ContributorService confirms a fresh ping', async () => {
      const { guard, calls } = buildGuard({ isContributor: true });
      await guard.canActivate(
        makeContext({ headers: { 'x-device-id': 'dev-fresh' }, ip: '1.2.3.4' }),
      );
      const tierBuckets = calls.filter((c) => c.name.startsWith('tier-'));
      expect(tierBuckets).toHaveLength(1);
      expect(tierBuckets[0].name).toBe('tier-contributor');
      expect(tierBuckets[0].limit).toBe(600);
    });

    it('falls back to tier-public when no auth and no contributor signal', async () => {
      const { guard, calls } = buildGuard();
      await guard.canActivate(
        makeContext({ headers: {}, ip: '1.2.3.4' }),
      );
      const tierBuckets = calls.filter((c) => c.name.startsWith('tier-'));
      expect(tierBuckets).toHaveLength(1);
      expect(tierBuckets[0].name).toBe('tier-public');
      expect(tierBuckets[0].limit).toBe(120);
    });
  });

  describe('bucket selection', () => {
    it('runs the default bucket on every (non-skipped) request', async () => {
      const { guard, calls } = buildGuard();
      await guard.canActivate(makeContext({ headers: {}, ip: '1.1.1.1' }));
      expect(calls.find((c) => c.name === 'default')).toBeDefined();
    });

    it('does NOT run the read bucket when no @Throttle({ read }) decorator is present', async () => {
      const { guard, calls } = buildGuard();
      await guard.canActivate(makeContext({ headers: {}, ip: '1.1.1.1' }));
      expect(calls.find((c) => c.name === 'read')).toBeUndefined();
    });

    it('runs the read bucket when the route declares @Throttle({ read: ... })', async () => {
      const reflector = new StubReflector();
      reflector.set(THROTTLER_LIMIT + 'read', 600);
      reflector.set(THROTTLER_TTL + 'read', 60_000);
      const { guard, calls } = buildGuard({ reflector });
      await guard.canActivate(makeContext({ headers: {}, ip: '1.1.1.1' }));
      const read = calls.find((c) => c.name === 'read');
      expect(read).toBeDefined();
      expect(read?.limit).toBe(600);
    });

    it('honours per-route @Throttle({ default: ... }) overrides for tighter write limits', async () => {
      const reflector = new StubReflector();
      reflector.set(THROTTLER_LIMIT + 'default', 5);
      reflector.set(THROTTLER_TTL + 'default', 60_000);
      const { guard, calls } = buildGuard({ reflector });
      await guard.canActivate(makeContext({ headers: {}, ip: '1.1.1.1' }));
      const def = calls.find((c) => c.name === 'default');
      expect(def?.limit).toBe(5);
      expect(def?.ttl).toBe(60_000);
    });

    it('skips ALL buckets when @SkipThrottle() (no args) is on the handler', async () => {
      const reflector = new StubReflector();
      reflector.set(THROTTLER_SKIP + 'default', true);
      const { guard, calls } = buildGuard({ reflector });
      const ok = await guard.canActivate(makeContext({ headers: {}, ip: '1.1.1.1' }));
      expect(ok).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });

  describe('per-device tracker', () => {
    it('keys on x-device-id when present so two devices behind one NAT do not share a budget', async () => {
      const { guard, calls } = buildGuard();
      await guard.canActivate(
        makeContext({ headers: { 'x-device-id': 'phone-A' }, ip: '10.0.0.1' }),
      );
      await guard.canActivate(
        makeContext({ headers: { 'x-device-id': 'phone-B' }, ip: '10.0.0.1' }),
      );
      const keys = new Set(calls.map((c) => c.key));
      expect(keys.has('dev:phone-A')).toBe(true);
      expect(keys.has('dev:phone-B')).toBe(true);
    });

    it('falls back to ip when x-device-id is absent', async () => {
      const { guard, calls } = buildGuard();
      await guard.canActivate(makeContext({ headers: {}, ip: '203.0.113.7' }));
      expect(calls.every((c) => c.key === 'ip:203.0.113.7')).toBe(true);
    });
  });
});
