import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ContributorGuard } from './contributor.guard';
import type { ContributorService } from './contributor.service';

describe('ContributorGuard', () => {
  const buildCtx = (
    headers: Record<string, string | string[] | undefined>,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  const makeService = (allowed: boolean): ContributorService =>
    ({
      isContributor: jest.fn().mockResolvedValue(allowed),
    }) as unknown as ContributorService;

  it('allows the request when the service says the device is a contributor', async () => {
    const svc = makeService(true);
    const guard = new ContributorGuard(svc);
    await expect(
      guard.canActivate(buildCtx({ 'x-device-id': 'dev-abc' })),
    ).resolves.toBe(true);
    expect(svc.isContributor).toHaveBeenCalledWith('dev-abc');
  });

  it('throws 403 BG_LOCATION_REQUIRED when the service returns false', async () => {
    const guard = new ContributorGuard(makeService(false));
    await expect(
      guard.canActivate(buildCtx({ 'x-device-id': 'dev-abc' })),
    ).rejects.toThrow(ForbiddenException);

    try {
      await new ContributorGuard(makeService(false)).canActivate(buildCtx({}));
    } catch (e) {
      const err = e as ForbiddenException;
      expect((err.getResponse() as { code: string }).code).toBe('BG_LOCATION_REQUIRED');
    }
  });

  it('passes the raw header through (no normalization in the guard layer)', async () => {
    const svc = makeService(true);
    const guard = new ContributorGuard(svc);
    await guard.canActivate(buildCtx({ 'x-device-id': ['dev-first', 'dev-second'] }));
    expect(svc.isContributor).toHaveBeenCalledWith(['dev-first', 'dev-second']);
  });
});
