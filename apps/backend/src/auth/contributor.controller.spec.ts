import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { ContributorController } from './contributor.controller';
import { hashDeviceId } from '../occupancy-events/utils/privacy.util';

type PrismaStub = {
  contributorPing: {
    upsert: jest.Mock;
    updateMany: jest.Mock;
  };
};

const buildReq = (deviceId?: string | string[]): Request =>
  ({
    headers: deviceId === undefined ? {} : { 'x-device-id': deviceId },
  }) as unknown as Request;

describe('ContributorController', () => {
  let prisma: PrismaStub;
  let controller: ContributorController;

  beforeEach(() => {
    prisma = {
      contributorPing: {
        upsert: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    controller = new ContributorController(prisma as never);
  });

  describe('POST /contributor/grant', () => {
    it('upserts a ContributorPing with granted_at = now()', async () => {
      const before = Date.now();
      await controller.registerGrant(buildReq('dev-abc'));
      const after = Date.now();

      expect(prisma.contributorPing.upsert).toHaveBeenCalledTimes(1);
      const args = prisma.contributorPing.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ device_hash: hashDeviceId('dev-abc') });
      expect(args.update.granted_at).toBeInstanceOf(Date);
      const grantedAt = (args.update.granted_at as Date).getTime();
      expect(grantedAt).toBeGreaterThanOrEqual(before);
      expect(grantedAt).toBeLessThanOrEqual(after);
      expect(args.create.device_hash).toBe(hashDeviceId('dev-abc'));
    });

    it('throws BG_LOCATION_REQUIRED when x-device-id is missing or empty', async () => {
      await expect(controller.registerGrant(buildReq())).rejects.toThrow(ForbiddenException);
      await expect(controller.registerGrant(buildReq('   '))).rejects.toThrow(ForbiddenException);
      expect(prisma.contributorPing.upsert).not.toHaveBeenCalled();
    });

    it('uses the first value when x-device-id is sent as an array', async () => {
      await controller.registerGrant(buildReq(['dev-array', 'second']));
      expect(prisma.contributorPing.upsert).toHaveBeenCalledTimes(1);
      const args = prisma.contributorPing.upsert.mock.calls[0][0];
      expect(args.where.device_hash).toBe(hashDeviceId('dev-array'));
    });
  });

  describe('POST /contributor/revoke', () => {
    it('clears granted_at and backdates last_seen_at past the ping TTL', async () => {
      await controller.revokeGrant(buildReq('dev-revoke'));

      expect(prisma.contributorPing.updateMany).toHaveBeenCalledTimes(1);
      const args = prisma.contributorPing.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({ device_hash: hashDeviceId('dev-revoke') });
      expect(args.data.granted_at).toBeNull();
      expect(args.data.last_seen_at).toBeInstanceOf(Date);
      expect((args.data.last_seen_at as Date).getTime()).toBe(0);
    });

    it('is a silent no-op when x-device-id is missing (does NOT throw)', async () => {
      await expect(controller.revokeGrant(buildReq())).resolves.toBeUndefined();
      await expect(controller.revokeGrant(buildReq('   '))).resolves.toBeUndefined();
      expect(prisma.contributorPing.updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent — succeeds even when no row exists for the device', async () => {
      prisma.contributorPing.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(controller.revokeGrant(buildReq('dev-unknown'))).resolves.toBeUndefined();
      expect(prisma.contributorPing.updateMany).toHaveBeenCalledTimes(1);
    });
  });
});
