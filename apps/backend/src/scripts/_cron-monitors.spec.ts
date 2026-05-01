import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRON_MONITORS, CRON_TIMEZONE } from './_cron-monitors';

/**
 * The Sentry Crons monitor registry MUST stay in lockstep with the actual
 * crontab — if a job is in one but not the other, we either silently miss
 * check-ins or alert on a job that doesn't exist. This spec parses the
 * crontab file and asserts the two sets agree.
 */
describe('CRON_MONITORS', () => {
  const crontabPath = join(__dirname, '..', '..', 'cron', 'crontab');
  const crontabSource = readFileSync(crontabPath, 'utf8');

  /** Parse `cron/crontab` → Map<jobName, scheduleString>. */
  function parseCrontab(): Map<string, string> {
    const jobs = new Map<string, string>();
    const lineRe =
      /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+node\s+\S+\/scripts\/([a-z-]+)\.js\s*$/;
    for (const raw of crontabSource.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = lineRe.exec(line);
      if (m) {
        jobs.set(m[2], m[1].replace(/\s+/g, ' '));
      }
    }
    return jobs;
  }

  it('uses America/Los_Angeles to match the cron container TZ', () => {
    expect(CRON_TIMEZONE).toBe('America/Los_Angeles');
  });

  it('has exactly one entry per script in cron/crontab', () => {
    const crontabJobs = parseCrontab();
    expect([...crontabJobs.keys()].sort()).toEqual(
      Object.keys(CRON_MONITORS).sort(),
    );
  });

  it('schedule strings match the crontab', () => {
    const crontabJobs = parseCrontab();
    for (const [job, cfg] of Object.entries(CRON_MONITORS)) {
      expect(crontabJobs.get(job)).toBe(cfg.schedule);
    }
  });

  it('every entry has a positive checkinMargin and maxRuntime', () => {
    for (const [job, cfg] of Object.entries(CRON_MONITORS)) {
      expect(cfg.checkinMargin).toBeGreaterThan(0);
      expect(cfg.maxRuntime).toBeGreaterThan(0);
      // sanity: maxRuntime should not be hilariously larger than the cadence,
      // catches typos like 600 instead of 60.
      expect(cfg.maxRuntime).toBeLessThanOrEqual(120);
      expect(`${job}:margin`).toBeDefined();
    }
  });
});
