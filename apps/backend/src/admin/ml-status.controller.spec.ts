import { BadRequestException } from '@nestjs/common';

import { MlStatusController } from './ml-status.controller';

describe('MlStatusController', () => {
  function makeService(
    response: Awaited<ReturnType<MlStatusController['get']>>,
  ): {
    service: { getStatus: jest.Mock };
    controller: MlStatusController;
  } {
    const service = { getStatus: jest.fn().mockResolvedValue(response) };
    const penetrationService = { listAllLots: jest.fn().mockResolvedValue([]) };
    const controller = new MlStatusController(
      service as never,
      penetrationService as never,
    );
    return { service, controller };
  }

  const sample = {
    generatedAt: '2026-05-06T12:00:00.000Z',
    windowHours: 24,
    jobs: [],
    recentRuns: [],
  };

  it('uses default windowHours=24 and limit=50 when query params absent', async () => {
    const { service, controller } = makeService(sample);
    await controller.get(undefined, undefined);
    expect(service.getStatus).toHaveBeenCalledWith({
      windowHours: 24,
      recentLimit: 50,
    });
  });

  it('parses valid integer query params', async () => {
    const { service, controller } = makeService(sample);
    await controller.get('48', '100');
    expect(service.getStatus).toHaveBeenCalledWith({
      windowHours: 48,
      recentLimit: 100,
    });
  });

  it('rejects non-integer windowHours', async () => {
    const { controller } = makeService(sample);
    await expect(controller.get('not-a-number', undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['0', undefined],
    ['169', undefined],
    [undefined, '0'],
    [undefined, '201'],
  ])('rejects out-of-range params (windowHours=%s, limit=%s)', async (w, l) => {
    const { controller } = makeService(sample);
    await expect(controller.get(w, l)).rejects.toThrow(BadRequestException);
  });
});
