/**
 * Tests for the ML wrapper job that spawns
 * `services/ml/scripts/build_proximity_matrix.py` weekly.
 *
 * Mirrors `ingest-room-capacities.job.spec.ts` — the Python spawn is
 * mocked so this stays a unit test asserting only the JS wrapper
 * contract (spawn shape, error propagation, ML_RESULT parsing,
 * stderr → logger.warn routing).
 */
import { BuildProximityMatrixJob } from './build-proximity-matrix.job';

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

describe('BuildProximityMatrixJob', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('spawns the Python module with the correct entrypoint', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdoutTail:
        'ML_RESULT: {"task":"build_proximity_matrix","schools_processed":1,"pairs_total":842,"rows_inserted":12,"rows_updated":830,"rows_deleted":0,"per_school":[]}\n',
      stderrTail: '',
    });
    const runner = makeRunner();
    const job = new BuildProximityMatrixJob(runner as never, makeLogger());

    await job.handle();
    expect(mockSpawn).toHaveBeenCalledWith(
      'scripts.build_proximity_matrix',
      [],
      expect.objectContaining({ timeoutMs: expect.any(Number), onLog: expect.any(Function) }),
    );
    expect(runner.run).toHaveBeenCalledWith('build-proximity-matrix', expect.any(Function));
  });

  it('throws when the Python process exits non-zero', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 2,
      stdoutTail: '',
      stderrTail: 'psycopg2.OperationalError: connection refused',
    });
    const job = new BuildProximityMatrixJob(makeRunner() as never, makeLogger());

    await expect(job.handle()).rejects.toThrow(/exited 2/);
    await expect(job.handle()).rejects.toThrow(/connection refused/);
  });

  it('inner work fn returns parsed ML_RESULT for runner metadata', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdoutTail:
        'ML_RESULT: {"task":"build_proximity_matrix","schools_processed":1,"pairs_total":842,"rows_inserted":4,"rows_updated":836,"rows_deleted":2,"per_school":[{"school":"CSULB","lots":68,"buildings":143,"pairs":842,"rows_inserted":4,"rows_updated":836,"rows_deleted":2}]}\n',
      stderrTail: '',
    });
    let captured: unknown;
    const runner: RunnerLike = {
      run: jest.fn(async (_name, work) => {
        captured = await work();
        return captured;
      }),
    };
    const job = new BuildProximityMatrixJob(runner as never, makeLogger());

    await job.handle();
    expect(captured).toEqual({
      task: 'build_proximity_matrix',
      schools_processed: 1,
      pairs_total: 842,
      rows_inserted: 4,
      rows_updated: 836,
      rows_deleted: 2,
      per_school: [
        {
          school: 'CSULB',
          lots: 68,
          buildings: 143,
          pairs: 842,
          rows_inserted: 4,
          rows_updated: 836,
          rows_deleted: 2,
        },
      ],
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
    const job = new BuildProximityMatrixJob(makeRunner() as never, logger as never);

    await job.handle();
    onLogFn!('stdout', '[CSULB] lots=68 buildings=143 pairs=842 (+4 ~836 -2)');
    onLogFn!('stderr', 'WARNING: building B-XYZ has null centroid; skipping');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('lots=68 buildings=143'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('null centroid'));
  });
});
