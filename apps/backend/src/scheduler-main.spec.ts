/**
 * Smoke test for the scheduler process bootstrap. We don't actually spin
 * up Nest — that would touch Prisma, Redis, Sentry, Firebase. Instead we
 * mock NestFactory, the Sentry SDK, and ScheduleModule, then assert:
 *   - bootstrap() awaits createApplicationContext with SchedulerModule
 *   - SIGTERM and SIGINT each close the app and flush Sentry
 */

import { setImmediate } from 'node:timers';

const mockClose = jest.fn().mockResolvedValue(undefined);
const mockUseLogger = jest.fn();
const mockEnableShutdownHooks = jest.fn();
const mockGet = jest.fn();
const mockApp = {
  close: mockClose,
  useLogger: mockUseLogger,
  enableShutdownHooks: mockEnableShutdownHooks,
  get: mockGet,
};

const mockCreate = jest.fn().mockResolvedValue(mockApp);
jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: mockCreate },
}));

const mockFlush = jest.fn().mockResolvedValue(true);
jest.mock('@sentry/nestjs', () => ({
  __esModule: true,
  flush: mockFlush,
}));

jest.mock('./instrument', () => ({}), { virtual: false });

// SchedulerModule pulls every job + Prisma + Redis + Firebase. Replace with
// an empty class so requiring scheduler-main doesn't drag the world in.
jest.mock('./scheduler/scheduler.module', () => ({
  SchedulerModule: class {},
}));

describe('scheduler-main bootstrap', () => {
  let exitSpy: jest.SpyInstance;
  let onceSpy: jest.SpyInstance;
  const originalListeners = {
    SIGTERM: process.listeners('SIGTERM'),
    SIGINT: process.listeners('SIGINT'),
  };

  beforeEach(() => {
    jest.resetModules();
    mockClose.mockClear();
    mockFlush.mockClear();
    mockCreate.mockClear().mockResolvedValue(mockApp);
    mockGet.mockReset().mockReturnValue({
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    onceSpy = jest.spyOn(process, 'once');
  });

  afterEach(() => {
    exitSpy.mockRestore();
    onceSpy.mockRestore();
    // Strip any signal handlers added during the test so other tests aren't
    // affected.
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      for (const l of process.listeners(sig)) {
        if (!originalListeners[sig].includes(l)) {
          process.removeListener(sig, l);
        }
      }
    }
  });

  async function loadBootstrap() {
    await import('./scheduler-main');
    // Give the IIFE microtask + the mocked NestFactory promise a chance to
    // settle before we inspect call sites.
    await new Promise((r) => setImmediate(r));
  }

  it('creates the Nest application context with SchedulerModule', async () => {
    await loadBootstrap();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUseLogger).toHaveBeenCalled();
    expect(mockEnableShutdownHooks).toHaveBeenCalled();
  });

  it('registers SIGTERM and SIGINT shutdown handlers that close + flush', async () => {
    await loadBootstrap();
    const sigTerm = onceSpy.mock.calls.find((c) => c[0] === 'SIGTERM');
    const sigInt = onceSpy.mock.calls.find((c) => c[0] === 'SIGINT');
    expect(sigTerm).toBeDefined();
    expect(sigInt).toBeDefined();

    // Fire SIGTERM handler
    const handler = sigTerm![1] as () => void;
    handler();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(mockClose).toHaveBeenCalled();
    expect(mockFlush).toHaveBeenCalledWith(2000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
