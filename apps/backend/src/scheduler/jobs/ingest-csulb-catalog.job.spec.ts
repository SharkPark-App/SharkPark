/**
 * Tests for the ML wrapper job that spawns
 * `services/ml/scripts/ingest_csulb_catalog.py` weekly.
 *
 * Mirrors the recompute-penetration-rates spec — the Python spawn is
 * mocked so this stays a unit test and only asserts the JS wrapper
 * contract: spawn shape, error propagation, ML_RESULT parsing,
 * and stderr → logger.warn routing.
 */
import { IngestCsulbCatalogJob } from './ingest-csulb-catalog.job';

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

describe('IngestCsulbCatalogJob', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('spawns the Python module with the correct entrypoint', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdoutTail:
        'ML_RESULT: {"task":"ingest_csulb_catalog","term":"spring","year":2026,"rows_inserted":1234}\n',
      stderrTail: '',
    });
    const runner = makeRunner();
    const job = new IngestCsulbCatalogJob(runner as never, makeLogger());

    await job.handle();
    expect(mockSpawn).toHaveBeenCalledWith(
      'scripts.ingest_csulb_catalog',
      [],
      expect.objectContaining({ timeoutMs: expect.any(Number), onLog: expect.any(Function) }),
    );
    expect(runner.run).toHaveBeenCalledWith('ingest-csulb-catalog', expect.any(Function));
  });

  it('throws when the Python process exits non-zero', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 2,
      stdoutTail: '',
      stderrTail: 'Traceback... HTTPError: 503 Service Unavailable',
    });
    const job = new IngestCsulbCatalogJob(makeRunner() as never, makeLogger());

    await expect(job.handle()).rejects.toThrow(/exited 2/);
    await expect(job.handle()).rejects.toThrow(/503/);
  });

  it('inner work fn returns parsed ML_RESULT for runner metadata', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdoutTail:
        'ML_RESULT: {"rows_inserted":50,"rows_updated":5,"enrollment_source_counts":{"room":40,"online":10,"type":5}}\n',
      stderrTail: '',
    });
    let captured: unknown;
    const runner: RunnerLike = {
      run: jest.fn(async (_name, work) => {
        captured = await work();
        return captured;
      }),
    };
    const job = new IngestCsulbCatalogJob(runner as never, makeLogger());

    await job.handle();
    expect(captured).toEqual({
      rows_inserted: 50,
      rows_updated: 5,
      enrollment_source_counts: { room: 40, online: 10, type: 5 },
    });
  });

  it('routes stderr lines to logger.warn and stdout lines to logger.log', async () => {
    let onLogFn: ((stream: 'stdout' | 'stderr', line: string) => void) | undefined;
    mockSpawn.mockImplementation(async (_module, _args, opts) => {
      onLogFn = opts?.onLog;
      return { exitCode: 0, stdoutTail: 'ML_RESULT: {}\n', stderrTail: '' };
    });
    const logger = makeLogger() as unknown as {
      log: jest.Mock;
      warn: jest.Mock;
      error: jest.Mock;
    };
    const job = new IngestCsulbCatalogJob(makeRunner() as never, logger as never);

    await job.handle();
    onLogFn!('stdout', 'fetched ECS.html');
    onLogFn!('stderr', 'no anchor matched in row 42');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('fetched ECS.html'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no anchor matched'));
  });
});
