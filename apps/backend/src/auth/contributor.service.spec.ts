import { ContributorService } from './contributor.service';
import { hashDeviceId } from '../occupancy-events/utils/privacy.util';

describe('ContributorService.isContributor', () => {
  // Distant-past sentinel so a row with only a granted_at can be modeled
  // without inadvertently satisfying the last_seen_at check.
  const ANCIENT = new Date(0);

  type PingShape = { last_seen_at: Date; granted_at: Date | null } | null;
  const makePrisma = (ping: PingShape) => ({
    contributorPing: {
      findUnique: jest.fn().mockResolvedValue(ping),
    },
  });

  it('returns false when the header is missing', async () => {
    const svc = new ContributorService(makePrisma(null) as never);
    await expect(svc.isContributor(undefined)).resolves.toBe(false);
  });

  it('returns false when the header is empty/whitespace', async () => {
    const svc = new ContributorService(makePrisma(null) as never);
    await expect(svc.isContributor('   ')).resolves.toBe(false);
  });

  it('returns false when the device has never contributed and never granted (no row)', async () => {
    const prisma = makePrisma(null);
    const svc = new ContributorService(prisma as never);
    await expect(svc.isContributor('dev-abc')).resolves.toBe(false);
    expect(prisma.contributorPing.findUnique).toHaveBeenCalledWith({
      where: { device_hash: hashDeviceId('dev-abc') },
      select: { last_seen_at: true, granted_at: true },
    });
  });

  it('returns false when both last_seen_at and granted_at are stale', async () => {
    const stalePing = new Date(Date.now() - 31 * 60 * 1000);
    const staleGrant = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const svc = new ContributorService(
      makePrisma({ last_seen_at: stalePing, granted_at: staleGrant }) as never,
    );
    await expect(svc.isContributor('dev-abc')).resolves.toBe(false);
  });

  it('returns false when ping is stale and granted_at is null', async () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000);
    const svc = new ContributorService(
      makePrisma({ last_seen_at: stale, granted_at: null }) as never,
    );
    await expect(svc.isContributor('dev-abc')).resolves.toBe(false);
  });

  it('returns true when the device has a recent ping', async () => {
    const fresh = new Date(Date.now() - 60_000);
    const svc = new ContributorService(
      makePrisma({ last_seen_at: fresh, granted_at: null }) as never,
    );
    await expect(svc.isContributor('dev-abc')).resolves.toBe(true);
  });

  it('returns true when only granted_at is fresh (no contribution yet)', async () => {
    const freshGrant = new Date(Date.now() - 60 * 60 * 1000);
    const svc = new ContributorService(
      makePrisma({ last_seen_at: ANCIENT, granted_at: freshGrant }) as never,
    );
    await expect(svc.isContributor('dev-abc')).resolves.toBe(true);
  });

  it('honors CONTRIBUTOR_PING_TTL_MS override', async () => {
    const original = process.env.CONTRIBUTOR_PING_TTL_MS;
    process.env.CONTRIBUTOR_PING_TTL_MS = '5000';
    try {
      const tenSecondsAgo = new Date(Date.now() - 10_000);
      const svc = new ContributorService(
        makePrisma({ last_seen_at: tenSecondsAgo, granted_at: null }) as never,
      );
      await expect(svc.isContributor('dev-abc')).resolves.toBe(false);
    } finally {
      process.env.CONTRIBUTOR_PING_TTL_MS = original;
    }
  });

  it('honors CONTRIBUTOR_GRANT_TTL_MS override', async () => {
    const original = process.env.CONTRIBUTOR_GRANT_TTL_MS;
    process.env.CONTRIBUTOR_GRANT_TTL_MS = '5000';
    try {
      const tenSecondsAgo = new Date(Date.now() - 10_000);
      const svc = new ContributorService(
        makePrisma({ last_seen_at: ANCIENT, granted_at: tenSecondsAgo }) as never,
      );
      await expect(svc.isContributor('dev-abc')).resolves.toBe(false);
    } finally {
      process.env.CONTRIBUTOR_GRANT_TTL_MS = original;
    }
  });

  it('uses the first value when x-device-id is sent as an array (proxy chains)', async () => {
    const fresh = new Date(Date.now() - 60_000);
    const prisma = makePrisma({ last_seen_at: fresh, granted_at: null });
    const svc = new ContributorService(prisma as never);
    await expect(svc.isContributor(['dev-first', 'dev-second'])).resolves.toBe(true);
    expect(prisma.contributorPing.findUnique).toHaveBeenCalledWith({
      where: { device_hash: hashDeviceId('dev-first') },
      select: { last_seen_at: true, granted_at: true },
    });
  });
});
