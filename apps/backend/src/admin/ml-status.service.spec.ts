import { MlStatusService } from './ml-status.service';

interface FakeRow {
  id: string;
  job_name: string;
  started_at: Date;
  completed_at: Date | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  duration_ms: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
}

function row(overrides: Partial<FakeRow>): FakeRow {
  return {
    id: 'row-' + Math.random().toString(36).slice(2, 8),
    job_name: 'predict-short-term',
    started_at: new Date('2026-05-06T10:00:00Z'),
    completed_at: new Date('2026-05-06T10:00:05Z'),
    status: 'SUCCESS',
    duration_ms: 5000,
    error_message: null,
    metadata: null,
    ...overrides,
  };
}

function makePrisma(rows: FakeRow[]): never {
  return {
    mlCronRun: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  } as never;
}

describe('MlStatusService', () => {
  it('returns empty rollup when no rows match the window', async () => {
    const svc = new MlStatusService(makePrisma([]));
    const result = await svc.getStatus({ windowHours: 24, recentLimit: 50 });
    expect(result.jobs).toEqual([]);
    expect(result.recentRuns).toEqual([]);
    expect(result.windowHours).toBe(24);
  });

  it('aggregates per-job counts and computes success rate over completed runs only', async () => {
    const rows = [
      // newest first
      row({ status: 'SUCCESS', started_at: new Date('2026-05-06T11:00Z') }),
      row({ status: 'FAILED', started_at: new Date('2026-05-06T10:45Z'), error_message: 'boom' }),
      row({ status: 'SUCCESS', started_at: new Date('2026-05-06T10:30Z') }),
      row({ status: 'SKIPPED', started_at: new Date('2026-05-06T10:15Z') }),
      row({ status: 'RUNNING', started_at: new Date('2026-05-06T10:00Z') }),
    ];
    const svc = new MlStatusService(makePrisma(rows));
    const result = await svc.getStatus({ windowHours: 24, recentLimit: 10 });

    expect(result.jobs).toHaveLength(1);
    const job = result.jobs[0];
    expect(job.jobName).toBe('predict-short-term');
    expect(job.total).toBe(5);
    expect(job.successCount).toBe(2);
    expect(job.failedCount).toBe(1);
    expect(job.skippedCount).toBe(1);
    expect(job.runningCount).toBe(1);
    // 2 success / (2 success + 1 failed) = 0.6667
    expect(job.successRate).toBeCloseTo(2 / 3, 4);
    expect(job.lastRunAt).toBe('2026-05-06T11:00:00.000Z');
    expect(job.lastSuccessAt).toBe('2026-05-06T11:00:00.000Z');
    expect(job.lastFailureAt).toBe('2026-05-06T10:45:00.000Z');
    expect(job.lastFailureMessage).toBe('boom');
  });

  it('sorts jobs alphabetically and slices recentRuns to the limit', async () => {
    const rows = [
      row({ job_name: 'predict-short-term', started_at: new Date('2026-05-06T11:00Z') }),
      row({ job_name: 'predict-long-term', started_at: new Date('2026-05-06T01:05Z') }),
      row({ job_name: 'predict-short-term', started_at: new Date('2026-05-06T10:45Z') }),
    ];
    const svc = new MlStatusService(makePrisma(rows));
    const result = await svc.getStatus({ windowHours: 24, recentLimit: 2 });

    expect(result.jobs.map((j) => j.jobName)).toEqual([
      'predict-long-term',
      'predict-short-term',
    ]);
    expect(result.recentRuns).toHaveLength(2);
    expect(result.recentRuns[0].jobName).toBe('predict-short-term');
  });

  it('exposes parsed ML_RESULT metadata in recentRuns', async () => {
    const rows = [
      row({
        metadata: { model_version: 'v7', predictions_written: 28 },
      }),
    ];
    const svc = new MlStatusService(makePrisma(rows));
    const result = await svc.getStatus({ windowHours: 24, recentLimit: 1 });
    expect(result.recentRuns[0].metadata).toEqual({
      model_version: 'v7',
      predictions_written: 28,
    });
  });

  it('reports successRate=0 when no completed runs exist (only RUNNING/SKIPPED)', async () => {
    const rows = [
      row({ status: 'RUNNING', completed_at: null, duration_ms: null }),
      row({ status: 'SKIPPED' }),
    ];
    const svc = new MlStatusService(makePrisma(rows));
    const result = await svc.getStatus({ windowHours: 24, recentLimit: 10 });
    expect(result.jobs[0].successRate).toBe(0);
  });
});
