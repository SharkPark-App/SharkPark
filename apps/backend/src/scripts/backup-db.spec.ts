import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { setImmediate } from 'node:timers';

jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

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

import { runCronJob } from './_bootstrap';
import './backup-db';

type WorkFn = (ctx: { logger: { log: jest.Mock } }) => Promise<void>;

const REQUIRED_ENV = {
  DIRECT_URL: 'postgres://u:p@host/db',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
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
  // schedule exit on next tick so the script has time to wire pipes
  setImmediate(() => {
    (proc.stdout as PassThrough).end();
    proc.emit('exit', exitCode);
  });
  return proc;
}

describe('backup-db cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];
  const work = call[2] as WorkFn;
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

  it('registers as backup-db with no extra feature modules', () => {
    expect(call[0]).toBe('backup-db');
    expect(call[1]).toEqual([]);
  });

  it.each(Object.keys(REQUIRED_ENV))('throws when %s is missing', async (key) => {
    setEnv({ [key]: undefined });
    const logger = { log: jest.fn() };
    await expect(work({ logger })).rejects.toThrow(/missing one of/);
  });

  it('spawns pg_dump and streams it through gzip into an S3 multipart upload', async () => {
    mockSpawn.mockReturnValue(makePgDump(0));
    const logger = { log: jest.fn() };

    await work({ logger });

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
    expect(uploadParams.params.Key).toMatch(/^daily\/\d{4}-\d{2}-\d{2}\.dump\.gz$/);
    expect(mockUploadDone).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('uploaded daily/'));
  });

  it('rejects when pg_dump exits non-zero', async () => {
    mockSpawn.mockReturnValue(makePgDump(1));
    await expect(work({ logger: { log: jest.fn() } })).rejects.toThrow(
      /pg_dump exited 1/,
    );
  });
});
