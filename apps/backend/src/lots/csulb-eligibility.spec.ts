import { studentEligibleLotTypes } from './csulb-eligibility';

describe('studentEligibleLotTypes', () => {
  const TZ = 'America/Los_Angeles';

  it('returns STUDENT-only on weekday morning', () => {
    // 2026-03-09T17:00:00Z = Monday 09:00 PST in LA (UTC-8 in March before DST flip on 03-09... actually DST starts 03-08 in 2026)
    // Use a clear morning UTC: 2026-03-10T18:00:00Z = Tuesday 11:00 PDT
    const now = new Date('2026-03-10T18:00:00Z');
    const result = studentEligibleLotTypes(now, TZ);
    expect(Array.from(result).sort()).toEqual(['STUDENT']);
  });

  it('adds EMPLOYEE after 17:30 weekday', () => {
    // 2026-03-11T01:00:00Z = Tuesday 18:00 PDT
    const now = new Date('2026-03-11T01:00:00Z');
    const result = studentEligibleLotTypes(now, TZ);
    expect(Array.from(result).sort()).toEqual(['EMPLOYEE', 'STUDENT']);
  });

  it('adds EMPLOYEE all day Saturday', () => {
    // 2026-03-14T17:00:00Z = Saturday 10:00 PDT
    const now = new Date('2026-03-14T17:00:00Z');
    const result = studentEligibleLotTypes(now, TZ);
    expect(Array.from(result).sort()).toEqual(['EMPLOYEE', 'STUDENT']);
  });

  it('adds EMPLOYEE all day Sunday', () => {
    // 2026-03-15T17:00:00Z = Sunday 10:00 PDT
    const now = new Date('2026-03-15T17:00:00Z');
    const result = studentEligibleLotTypes(now, TZ);
    expect(Array.from(result).sort()).toEqual(['EMPLOYEE', 'STUDENT']);
  });

  it('exactly 17:30 is after-hours', () => {
    // 2026-03-11T00:30:00Z = Tuesday 17:30 PDT
    const now = new Date('2026-03-11T00:30:00Z');
    const result = studentEligibleLotTypes(now, TZ);
    expect(result.has('EMPLOYEE')).toBe(true);
  });

  it('17:29 is still STUDENT-only on a weekday', () => {
    // 2026-03-11T00:29:00Z = Tuesday 17:29 PDT
    const now = new Date('2026-03-11T00:29:00Z');
    const result = studentEligibleLotTypes(now, TZ);
    expect(result.has('EMPLOYEE')).toBe(false);
  });
});
