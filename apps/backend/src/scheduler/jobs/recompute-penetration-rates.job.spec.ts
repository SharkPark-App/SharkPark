/**
 * Tests for the ML wrapper job that spawns
 * `services/ml/scripts/recompute_penetration_rates.py` daily.
 *
 * We mock the Python spawn so the test stays unit-scoped and asserts:
 *   1. delegates to runner.run with the correct cron name,
 *   2. throws when the Python process exits non-zero,
 *   3. parses ML_RESULT JSON from stdout into the runner metadata.
 */
import { RecomputePenetrationRatesJob } from './recompute-penetration-rates.job';

jest.mock('./_ml-runner', () => ({
  spawnPythonModule: jest.fn(),
}));

import { spawnPythonModule } from './_ml-runner';

const mockSpawn = spawnPythonModule as jest.MockedFunction<typeof spawnPythonModule>;

type RunnerLike = {
  run: jest.Mock<Promise<unknown>, [string, () => Promise<unknown>]>;
};

function makeRunner(): RunnerLike {
  return {
    run: jest.fn(async (_name: string, work: () => Promise<unknown>) => work()),
  };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

describe('RecomputePenetrationRatesJob', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('spawns the Python module with the correct entrypoint and returns parsed metadata', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdoutTail:
        'some log line\nML_RESULT: {"task":"recompute_penetration_rates","buckets_updated":42}\n',
      stderrTail: '',
    });
    const runner = makeRunner();
    const job = new RecomputePenetrationRatesJob(runner as never, makeLogger());

    const metadata = await runner.run.getMockImplementation()!(
      'recompute-penetration-rates',
      async () => {
        await job.handle();
      },
    );
    void metadata;

    // The handle() method itself returns void; we instead assert the spawn
    // call shape and the value returned by the inner work fn.
    await job.handle();
    expect(mockSpawn).toHaveBeenCalledWith(
      'scripts.recompute_penetration_rates',
      [],
      expect.objectContaining({ timeoutMs: expect.any(Number), onLog: expect.any(Function) }),
    );
    expect(runner.run).toHaveBeenCalledWith(
      'recompute-penetration-rates',
      expect.any(Function),
    );
  });

  it('throws when the Python process exits non-zero', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 2,
      stdoutTail: '',
      stderrTail: 'Traceback... ValueError: bad stuff',
    });
    const runner = makeRunner();
    const job = new RecomputePenetrationRatesJob(runner as never, makeLogger());

    await expect(job.handle()).rejects.toThrow(/exited 2/);
    await expect(job.handle()).rejects.toThrow(/bad stuff/);
  });

  it('inner work fn returns parsed ML_RESULT for runner metadata', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdoutTail: 'ML_RESULT: {"buckets_updated":7,"alpha":0.1}\n',
      stderrTail: '',
    });
    let captured: unknown;
    const runner: RunnerLike = {
      run: jest.fn(async (_name, work) => {
        captured = await work();
        return captured;
      }),
    };
    const job = new RecomputePenetrationRatesJob(runner as never, makeLogger());

    await job.handle();
    expect(captured).toEqual({ buckets_updated: 7, alpha: 0.1 });
  });

  it('routes stderr lines to logger.warn and stdout lines to logger.log', async () => {
    let onLogFn: ((stream: 'stdout' | 'stderr', line: string) => void) | undefined;
    mockSpawn.mockImplementation(async (_module, _args, opts) => {
      onLogFn = opts?.onLog;
      return { exitCode: 0, stdoutTail: 'ML_RESULT: {}\n', stderrTail: '' };
    });
    const runner = makeRunner();
    const logger = makeLogger() as unknown as {
      log: jest.Mock;
      warn: jest.Mock;
      error: jest.Mock;
    };
    const job = new RecomputePenetrationRatesJob(runner as never, logger as never);

    await job.handle();
    onLogFn!('stdout', 'hello');
    onLogFn!('stderr', 'careful');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('hello'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('careful'));
  });
});
