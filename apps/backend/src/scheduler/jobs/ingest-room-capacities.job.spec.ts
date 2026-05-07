/**
 * Tests for the ML wrapper job that spawns
 * `services/ml/scripts/ingest_room_capacities.py` weekly.
 *
 * Mirrors `ingest-csulb-catalog.job.spec.ts` — the Python spawn is
 * mocked so this stays a unit test asserting only the JS wrapper
 * contract (spawn shape, error propagation, ML_RESULT parsing,
 * stderr → logger.warn routing).
 */
import { IngestRoomCapacitiesJob } from './ingest-room-capacities.job';

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

describe('IngestRoomCapacitiesJob', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('spawns the Python module with the correct entrypoint', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdoutTail:
        'ML_RESULT: {"task":"ingest_room_capacities","semester":"spring","rows_inserted":231,"rows_updated":0,"pages_failed":[]}\n',
      stderrTail: '',
    });
    const runner = makeRunner();
    const job = new IngestRoomCapacitiesJob(runner as never, makeLogger());

    await job.handle();
    expect(mockSpawn).toHaveBeenCalledWith(
      'scripts.ingest_room_capacities',
      [],
      expect.objectContaining({ timeoutMs: expect.any(Number), onLog: expect.any(Function) }),
    );
    expect(runner.run).toHaveBeenCalledWith('ingest-room-capacities', expect.any(Function));
  });

  it('throws when the Python process exits non-zero', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 1,
      stdoutTail: '',
      stderrTail: 'All source pages failed; no rows persisted.',
    });
    const job = new IngestRoomCapacitiesJob(makeRunner() as never, makeLogger());

    await expect(job.handle()).rejects.toThrow(/exited 1/);
    await expect(job.handle()).rejects.toThrow(/All source pages failed/);
  });

  it('inner work fn returns parsed ML_RESULT for runner metadata', async () => {
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdoutTail:
        'ML_RESULT: {"rows_inserted":12,"rows_updated":219,"building_aliases_added":2,"building_profiles_updated":7,"pages_failed":[],"rows_by_source":{"auditorium":25,"lecture-allocation":167}}\n',
      stderrTail: '',
    });
    let captured: unknown;
    const runner: RunnerLike = {
      run: jest.fn(async (_name, work) => {
        captured = await work();
        return captured;
      }),
    };
    const job = new IngestRoomCapacitiesJob(runner as never, makeLogger());

    await job.handle();
    expect(captured).toEqual({
      rows_inserted: 12,
      rows_updated: 219,
      building_aliases_added: 2,
      building_profiles_updated: 7,
      pages_failed: [],
      rows_by_source: { auditorium: 25, 'lecture-allocation': 167 },
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
    const job = new IngestRoomCapacitiesJob(makeRunner() as never, logger as never);

    await job.handle();
    onLogFn!('stdout', 'Parsed 25 rows from auditorium table');
    onLogFn!('stderr', '404 at https://www.csulb.edu/...spring-lecture-room-allocations');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Parsed 25 rows'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('404 at'));
  });
});
