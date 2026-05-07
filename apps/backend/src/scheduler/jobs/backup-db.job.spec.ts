import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { setImmediate } from 'node:timers';

const mockUploadDone = jest.fn().mockResolvedValue({ ETag: '"abc"' });
const MockUploadCtor = jest.fn().mockImplementation(() => ({ done: mockUploadDone }));
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: MockUploadCtor,
}));

const MockS3Ctor = jest.fn().mockImplementation(() => ({}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: MockS3Ctor,
}));

const mockSpawn = jest.fn();
jest.mock('node:child_process', () => ({ spawn: mockSpawn }));

import { BackupDbJob } from './backup-db.job';

const REQUIRED_ENV = {
  DIRECT_URL: 'postgres://u:p@host/db',
  R2_ACCOUNT_ID: 'acct',
  BACKUP_R2_ACCESS_KEY_ID: 'ak',
  BACKUP_R2_SECRET_ACCESS_KEY: 'sk',
  R2_BACKUPS_BUCKET: 'bucket',
};

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function makePgDump(exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  setImmediate(() => {
    (proc.stdout as PassThrough).end();
    proc.emit('exit', exitCode);
  });
  return proc;
}

function makeRunner() {
  return {
    run: jest.fn(async (_name: string, work: () => Promise<void>) => {
      await work();
    }),
  };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

describe('BackupDbJob', () => {
  const original = { ...process.env };

  beforeEach(() => {
    mockSpawn.mockReset();
    MockUploadCtor.mockClear();
    MockS3Ctor.mockClear();
    mockUploadDone.mockClear().mockResolvedValue({ ETag: '"abc"' });
    setEnv(REQUIRED_ENV);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it.each(Object.keys(REQUIRED_ENV))('throws when %s is missing', async (key) => {
    setEnv({ [key]: undefined });
    const job = new BackupDbJob(makeRunner() as never, makeLogger());
    await expect(job.handle()).rejects.toThrow(/missing one of/);
  });

  it('spawns pg_dump and streams it through gzip into an S3 multipart upload', async () => {
    mockSpawn.mockReturnValue(makePgDump(0));
    const job = new BackupDbJob(makeRunner() as never, makeLogger());

    await job.handle();

    expect(mockSpawn).toHaveBeenCalledWith(
      'pg_dump',
      expect.arrayContaining(['--format=custom', REQUIRED_ENV.DIRECT_URL]),
      expect.any(Object),
    );
    expect(MockS3Ctor).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: `https://${REQUIRED_ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      }),
    );
    const uploadParams = MockUploadCtor.mock.calls[0][0];
    expect(uploadParams.params).toMatchObject({
      Bucket: REQUIRED_ENV.R2_BACKUPS_BUCKET,
      ContentEncoding: 'gzip',
    });
    expect(uploadParams.params.Key).toMatch(
      /^daily\/\d{4}-\d{2}-\d{2}\.dump\.gz$/,
    );
    expect(mockUploadDone).toHaveBeenCalled();
  });

  it('rejects when pg_dump exits non-zero', async () => {
    mockSpawn.mockReturnValue(makePgDump(1));
    const job = new BackupDbJob(makeRunner() as never, makeLogger());
    await expect(job.handle()).rejects.toThrow(/pg_dump exited 1/);
  });
});
