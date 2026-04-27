import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ContributorGuard } from './contributor.guard';
import { hashDeviceId } from '../occupancy-events/utils/privacy.util';

describe('ContributorGuard', () => {
  const buildCtx = (headers: Record<string, string | string[] | undefined>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  const makePrisma = (last_seen_at: Date | null) => ({
    contributorPing: {
      findUnique: jest.fn().mockResolvedValue(last_seen_at ? { last_seen_at } : null),
    },
  });

  it('rejects with BG_LOCATION_REQUIRED when x-device-id is missing', async () => {
    const guard = new ContributorGuard(makePrisma(null) as never);
    await expect(guard.canActivate(buildCtx({}))).rejects.toThrow(ForbiddenException);

    const guard2 = new ContributorGuard(makePrisma(null) as never);
    try {
      await guard2.canActivate(buildCtx({}));
    } catch (e) {
      const err = e as ForbiddenException;
      expect((err.getResponse() as { code: string }).code).toBe('BG_LOCATION_REQUIRED');
    }
  });

  it('rejects when x-device-id is empty/whitespace', async () => {
    const guard = new ContributorGuard(makePrisma(null) as never);
    await expect(guard.canActivate(buildCtx({ 'x-device-id': '   ' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the device has never contributed (no ping row)', async () => {
    const prisma = makePrisma(null);
    const guard = new ContributorGuard(prisma as never);
    await expect(
      guard.canActivate(buildCtx({ 'x-device-id': 'dev-abc' })),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.contributorPing.findUnique).toHaveBeenCalledWith({
      where: { device_hash: hashDeviceId('dev-abc') },
      select: { last_seen_at: true },
    });
  });

  it('rejects when the most recent ping is older than the TTL', async () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000); // 31 minutes ago
    const guard = new ContributorGuard(makePrisma(stale) as never);
    await expect(
      guard.canActivate(buildCtx({ 'x-device-id': 'dev-abc' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows the request when the device has a recent ping', async () => {
    const fresh = new Date(Date.now() - 60_000); // 1 minute ago
    const guard = new ContributorGuard(makePrisma(fresh) as never);
    await expect(
      guard.canActivate(buildCtx({ 'x-device-id': 'dev-abc' })),
    ).resolves.toBe(true);
  });

  it('honors CONTRIBUTOR_PING_TTL_MS override', async () => {
    const original = process.env.CONTRIBUTOR_PING_TTL_MS;
    process.env.CONTRIBUTOR_PING_TTL_MS = '5000'; // 5 seconds
    try {
      const tenSecondsAgo = new Date(Date.now() - 10_000);
      const guard = new ContributorGuard(makePrisma(tenSecondsAgo) as never);
      await expect(
        guard.canActivate(buildCtx({ 'x-device-id': 'dev-abc' })),
      ).rejects.toThrow(ForbiddenException);
    } finally {
      process.env.CONTRIBUTOR_PING_TTL_MS = original;
    }
  });

  it('uses the first value when x-device-id is sent as an array (proxy chains)', async () => {
    const fresh = new Date(Date.now() - 60_000);
    const prisma = makePrisma(fresh);
    const guard = new ContributorGuard(prisma as never);
    await expect(
      guard.canActivate(buildCtx({ 'x-device-id': ['dev-first', 'dev-second'] })),
    ).resolves.toBe(true);
    expect(prisma.contributorPing.findUnique).toHaveBeenCalledWith({
      where: { device_hash: hashDeviceId('dev-first') },
      select: { last_seen_at: true },
    });
  });
});
