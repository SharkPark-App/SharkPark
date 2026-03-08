import {
  generateAcademicYear,
  getWeekOfSemester,
  isClassDay,
  getSemesterProgress,
  getSemester,
  isCampusOpen,
  getExpectedCommuters,
  COMMUTER_MAP,
  type AcademicYear,
} from './academic-calendar';

// ─── Helpers ──────────────────────────────────────────────

/** Local-time date (the calendar module reads getFullYear/getMonth/getDate) */
const d = (year: number, month: number, day: number): Date =>
  new Date(year, month - 1, day, 10, 0, 0, 0);

/** Day-of-week helper (0=Sun) for sanity-checking generated dates */
const dow = (date: Date): number => date.getUTCDay();

// ─── Tests ────────────────────────────────────────────────

describe('Academic Calendar', () => {
  // ─── generateAcademicYear ────────────────────────────────

  describe('generateAcademicYear', () => {
    let year2025: AcademicYear;

    beforeAll(() => {
      year2025 = generateAcademicYear(2025);
    });

    it('returns all five semesters', () => {
      expect(year2025.fall).toBeDefined();
      expect(year2025.spring).toBeDefined();
      expect(year2025.winter).toBeDefined();
      expect(year2025.mayIntersession).toBeDefined();
      expect(year2025.summer).toBeDefined();
    });

    it('caches results for the same year', () => {
      const a = generateAcademicYear(2025);
      const b = generateAcademicYear(2025);
      expect(a).toBe(b); // same reference
    });

    // ── Fall semester ──

    describe('Fall 2025', () => {
      it('starts classes on the 4th Monday of August 2025', () => {
        const classesStart = year2025.fall.classesStart;
        expect(classesStart.getUTCMonth()).toBe(7); // August (0-indexed)
        expect(dow(classesStart)).toBe(1); // Monday
        // 4th Monday of Aug 2025 = Aug 25
        expect(classesStart.getUTCDate()).toBe(25);
      });

      it('has orientation week before classes start', () => {
        const diff = year2025.fall.classesStart.getTime() - year2025.fall.semesterStart.getTime();
        expect(diff).toBe(7 * 86_400_000); // 7 days
      });

      it('has finals week', () => {
        expect(year2025.fall.finalsStart).not.toBeNull();
        expect(year2025.fall.finalsEnd).not.toBeNull();
      });

      it('includes Labor Day break', () => {
        const laborDay = year2025.fall.breaks.find(b => b.name === 'Labor Day');
        expect(laborDay).toBeDefined();
        expect(laborDay!.campusClosed).toBe(true);
        expect(dow(laborDay!.dates[0])).toBe(1); // Monday
      });

      it('includes Veterans Day break', () => {
        const vets = year2025.fall.breaks.find(b => b.name === 'Veterans Day');
        expect(vets).toBeDefined();
        expect(vets!.campusClosed).toBe(true);
      });

      it('includes Thanksgiving break (campus closed)', () => {
        const tg = year2025.fall.breaks.find(b => b.name === 'Thanksgiving');
        expect(tg).toBeDefined();
        expect(tg!.campusClosed).toBe(true);
        // Thanksgiving is 4th Thursday of November
        expect(tg!.dates.some(dt => dow(dt) === 4)).toBe(true);
      });

      it('includes Fall Break (campus open)', () => {
        const fb = year2025.fall.breaks.find(b => b.name === 'Fall Break');
        expect(fb).toBeDefined();
        expect(fb!.campusClosed).toBe(false);
        expect(fb!.dates.length).toBe(3);
      });

      it('has a reading day', () => {
        expect(year2025.fall.readingDays.length).toBe(1);
      });
    });

    // ── Spring semester ──

    describe('Spring 2026', () => {
      it('starts the day after MLK Day', () => {
        const classesStart = year2025.spring.classesStart;
        // MLK Day 2026 = 3rd Mon of Jan = Jan 19
        expect(classesStart.getUTCMonth()).toBe(0); // January
        expect(dow(classesStart)).toBe(2); // Tuesday
        expect(classesStart.getUTCDate()).toBe(20);
      });

      it('includes Spring Recess', () => {
        const recess = year2025.spring.breaks.find(b => b.name === 'Spring Recess');
        expect(recess).toBeDefined();
        expect(recess!.dates.length).toBe(7); // full week
        expect(recess!.campusClosed).toBe(false);
      });

      it('includes Cesar Chavez Day (campus closed)', () => {
        const cc = year2025.spring.breaks.find(b => b.name === 'Cesar Chavez Day');
        expect(cc).toBeDefined();
        expect(cc!.campusClosed).toBe(true);
      });

      it('has finals', () => {
        expect(year2025.spring.finalsStart).not.toBeNull();
        expect(year2025.spring.finalsEnd).not.toBeNull();
      });
    });

    // ── Winter intersession ──

    describe('Winter 2026', () => {
      it('starts on or after January 2', () => {
        const start = year2025.winter.classesStart;
        expect(start.getUTCMonth()).toBe(0);
        expect(start.getUTCDate()).toBeGreaterThanOrEqual(2);
        // Should be a weekday
        expect(dow(start)).toBeGreaterThanOrEqual(1);
        expect(dow(start)).toBeLessThanOrEqual(5);
      });

      it('ends on MLK Day', () => {
        const mlk = year2025.winter.semesterEnd;
        expect(dow(mlk)).toBe(1); // Monday
        expect(mlk.getUTCMonth()).toBe(0); // January
      });

      it('has no finals', () => {
        expect(year2025.winter.finalsStart).toBeNull();
        expect(year2025.winter.finalsEnd).toBeNull();
      });

      it('includes MLK Day break', () => {
        const mlkBreak = year2025.winter.breaks.find(b =>
          b.name.includes('Martin Luther King'),
        );
        expect(mlkBreak).toBeDefined();
        expect(mlkBreak!.campusClosed).toBe(true);
      });
    });

    // ── May intersession ──

    describe('May Intersession 2026', () => {
      it('starts after spring finals on a Monday', () => {
        const start = year2025.mayIntersession.classesStart;
        expect(dow(start)).toBe(1); // Monday
        // Must be after spring finals
        expect(start.getTime()).toBeGreaterThan(year2025.spring.finalsEnd!.getTime());
      });

      it('lasts about 3 weeks', () => {
        const { classesStart, classesEnd } = year2025.mayIntersession;
        const days = Math.round(
          (classesEnd.getTime() - classesStart.getTime()) / 86_400_000,
        );
        expect(days).toBe(18);
      });

      it('has no finals', () => {
        expect(year2025.mayIntersession.finalsStart).toBeNull();
      });
    });

    // ── Summer session ──

    describe('Summer 2026', () => {
      it('starts the day after May intersession ends', () => {
        const expected = new Date(
          year2025.mayIntersession.semesterEnd.getTime() + 86_400_000,
        );
        expect(year2025.summer.classesStart.getTime()).toBe(expected.getTime());
      });

      it('lasts about 10 weeks', () => {
        const { classesStart, classesEnd } = year2025.summer;
        const days = Math.round(
          (classesEnd.getTime() - classesStart.getTime()) / 86_400_000,
        );
        expect(days).toBe(69);
      });

      it('includes Juneteenth if in session', () => {
        const jt = year2025.summer.breaks.find(b => b.name === 'Juneteenth');
        if (jt) {
          expect(jt.campusClosed).toBe(true);
        }
      });

      it('includes Independence Day if in session', () => {
        const id4 = year2025.summer.breaks.find(b => b.name === 'Independence Day');
        if (id4) {
          expect(id4.campusClosed).toBe(true);
        }
      });
    });
  });

  // ─── getSemester ─────────────────────────────────────────

  describe('getSemester', () => {
    it('classifies a fall class day as fall', () => {
      // Sept 15 2025 is clearly in fall
      expect(getSemester(d(2025, 9, 15))).toBe('fall');
    });

    it('classifies a spring class day as spring', () => {
      // March 10 2026 is in spring
      expect(getSemester(d(2026, 3, 10))).toBe('spring');
    });

    it('classifies July as summer', () => {
      expect(getSemester(d(2026, 7, 1))).toBe('summer');
    });

    it('classifies winter intersession as session', () => {
      // Jan 5 2026 should be winter intersession
      expect(getSemester(d(2026, 1, 5))).toBe('session');
    });

    it('classifies a date between semesters as break', () => {
      // Late December — between fall and winter
      expect(getSemester(d(2025, 12, 28))).toBe('break');
    });
  });

  // ─── isClassDay ──────────────────────────────────────────

  describe('isClassDay', () => {
    it('returns true for a normal Monday during spring', () => {
      // Mon March 9 2026 — regular spring day
      expect(isClassDay(d(2026, 3, 9))).toBe(true);
    });

    it('returns false for Saturday', () => {
      expect(isClassDay(d(2026, 3, 14))).toBe(false);
    });

    it('returns false for Sunday', () => {
      expect(isClassDay(d(2026, 3, 15))).toBe(false);
    });

    it('returns false for a campus holiday (Labor Day 2025)', () => {
      // Labor Day 2025 = Sep 1
      expect(isClassDay(d(2025, 9, 1))).toBe(false);
    });

    it('returns false for a date outside any semester', () => {
      expect(isClassDay(d(2025, 12, 28))).toBe(false);
    });

    it('returns false during Spring Recess', () => {
      // Spring Recess includes week of March 31
      const year = generateAcademicYear(2025);
      const recessDate = year.spring.breaks.find(
        b => b.name === 'Spring Recess',
      )!.dates[2]; // a weekday in recess (not Cesar Chavez Day)
      // Convert UTC date to local params for d()
      expect(
        isClassDay(
          d(recessDate.getUTCFullYear(), recessDate.getUTCMonth() + 1, recessDate.getUTCDate()),
        ),
      ).toBe(false);
    });
  });

  // ─── getWeekOfSemester ───────────────────────────────────

  describe('getWeekOfSemester', () => {
    it('returns [0, "break"] for a date outside any semester', () => {
      expect(getWeekOfSemester(d(2025, 12, 28))).toEqual([0, 'break']);
    });

    it('returns week 1, "early" for the first day of fall classes', () => {
      const year = generateAcademicYear(2025);
      const cs = year.fall.classesStart;
      const result = getWeekOfSemester(
        d(cs.getUTCFullYear(), cs.getUTCMonth() + 1, cs.getUTCDate()),
      );
      expect(result[0]).toBe(1);
      expect(result[1]).toBe('early');
    });

    it('returns "midterms" around week 8-9', () => {
      const year = generateAcademicYear(2025);
      const cs = year.fall.classesStart;
      // 7 weeks * 7 days = 49 days → week 8
      const midtermDate = new Date(cs.getTime() + 49 * 86_400_000);
      const result = getWeekOfSemester(
        d(midtermDate.getUTCFullYear(), midtermDate.getUTCMonth() + 1, midtermDate.getUTCDate()),
      );
      expect(result[0]).toBe(8);
      expect(result[1]).toBe('midterms');
    });

    it('returns "finals" during finals week', () => {
      const year = generateAcademicYear(2025);
      const fs = year.fall.finalsStart!;
      const result = getWeekOfSemester(
        d(fs.getUTCFullYear(), fs.getUTCMonth() + 1, fs.getUTCDate()),
      );
      expect(result[1]).toBe('finals');
    });

    it('returns "break" for an in-semester break day', () => {
      const year = generateAcademicYear(2025);
      const laborDay = year.fall.breaks.find(b => b.name === 'Labor Day')!.dates[0];
      const result = getWeekOfSemester(
        d(laborDay.getUTCFullYear(), laborDay.getUTCMonth() + 1, laborDay.getUTCDate()),
      );
      expect(result[1]).toBe('break');
    });

    it('returns "regular" for intersession even on week 1', () => {
      const year = generateAcademicYear(2025);
      const cs = year.winter.classesStart;
      const result = getWeekOfSemester(
        d(cs.getUTCFullYear(), cs.getUTCMonth() + 1, cs.getUTCDate()),
      );
      expect(result[1]).toBe('regular');
    });
  });

  // ─── getSemesterProgress ─────────────────────────────────

  describe('getSemesterProgress', () => {
    it('returns 0 for a date outside any semester', () => {
      expect(getSemesterProgress(d(2025, 12, 28))).toBe(0);
    });

    it('returns 0 at classesStart', () => {
      const year = generateAcademicYear(2025);
      const cs = year.fall.classesStart;
      expect(
        getSemesterProgress(
          d(cs.getUTCFullYear(), cs.getUTCMonth() + 1, cs.getUTCDate()),
        ),
      ).toBe(0);
    });

    it('returns ~0.5 near midpoint', () => {
      const year = generateAcademicYear(2025);
      const cs = year.fall.classesStart;
      const fe = year.fall.finalsEnd!;
      const total = (fe.getTime() - cs.getTime()) / 86_400_000;
      const mid = new Date(cs.getTime() + Math.floor(total / 2) * 86_400_000);
      const progress = getSemesterProgress(
        d(mid.getUTCFullYear(), mid.getUTCMonth() + 1, mid.getUTCDate()),
      );
      expect(progress).toBeGreaterThan(0.4);
      expect(progress).toBeLessThan(0.6);
    });

    it('returns 1 after finalsEnd', () => {
      const year = generateAcademicYear(2025);
      const fe = year.fall.finalsEnd!;
      const after = new Date(fe.getTime() + 2 * 86_400_000);
      const progress = getSemesterProgress(
        d(after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate()),
      );
      // Still in semester but past finalsEnd → 1.0
      expect(progress).toBe(1);
    });
  });

  // ─── isCampusOpen ────────────────────────────────────────

  describe('isCampusOpen', () => {
    it('returns true for a normal class day', () => {
      expect(isCampusOpen(d(2026, 3, 10))).toBe(true);
    });

    it('returns false on Labor Day', () => {
      // Labor Day 2025 = Sep 1
      expect(isCampusOpen(d(2025, 9, 1))).toBe(false);
    });

    it('returns false on Thanksgiving', () => {
      const year = generateAcademicYear(2025);
      const tg = year.fall.breaks.find(b => b.name === 'Thanksgiving')!.dates[0];
      expect(
        isCampusOpen(
          d(tg.getUTCFullYear(), tg.getUTCMonth() + 1, tg.getUTCDate()),
        ),
      ).toBe(false);
    });

    it('returns true on Spring Recess (campus open, no classes)', () => {
      const year = generateAcademicYear(2025);
      const recess = year.spring.breaks.find(
        b => b.name === 'Spring Recess',
      )!.dates[0]; // Monday of recess week (not Cesar Chavez Day)
      expect(
        isCampusOpen(
          d(recess.getUTCFullYear(), recess.getUTCMonth() + 1, recess.getUTCDate()),
        ),
      ).toBe(true);
    });

    it('returns false on Cesar Chavez Day', () => {
      const year = generateAcademicYear(2025);
      const cc = year.spring.breaks.find(b => b.name === 'Cesar Chavez Day')!.dates[0];
      expect(
        isCampusOpen(
          d(cc.getUTCFullYear(), cc.getUTCMonth() + 1, cc.getUTCDate()),
        ),
      ).toBe(false);
    });

    it('returns true for a date between semesters', () => {
      expect(isCampusOpen(d(2025, 12, 28))).toBe(true);
    });
  });

  // ─── getExpectedCommuters ────────────────────────────────

  describe('getExpectedCommuters', () => {
    it('returns fall commuters for a regular fall day', () => {
      expect(getExpectedCommuters(d(2025, 9, 15))).toBe(COMMUTER_MAP.fall); // 35,000
    });

    it('returns spring commuters for a regular spring day', () => {
      expect(getExpectedCommuters(d(2026, 3, 10))).toBe(COMMUTER_MAP.spring); // 34,000
    });

    it('returns summer commuters for a summer day', () => {
      const year = generateAcademicYear(2025);
      const summerDay = new Date(
        year.summer.classesStart.getTime() + 7 * 86_400_000,
      );
      expect(
        getExpectedCommuters(
          d(summerDay.getUTCFullYear(), summerDay.getUTCMonth() + 1, summerDay.getUTCDate()),
        ),
      ).toBe(COMMUTER_MAP.summer); // 8,000
    });

    it('returns session commuters for winter intersession', () => {
      expect(getExpectedCommuters(d(2026, 1, 5))).toBe(COMMUTER_MAP.session); // 3,000
    });

    it('returns break commuters between semesters', () => {
      expect(getExpectedCommuters(d(2025, 12, 28))).toBe(COMMUTER_MAP.break); // 1,500
    });

    it('returns break commuters on campus-closed holidays', () => {
      // Labor Day 2025 = Sep 1
      expect(getExpectedCommuters(d(2025, 9, 1))).toBe(COMMUTER_MAP.break); // 1,500
    });

    it('returns 10% of normal on in-semester break days (Spring Recess)', () => {
      const year = generateAcademicYear(2025);
      const recess = year.spring.breaks.find(
        b => b.name === 'Spring Recess',
      )!.dates[0]; // Monday of recess week (not Cesar Chavez Day)
      const result = getExpectedCommuters(
        d(recess.getUTCFullYear(), recess.getUTCMonth() + 1, recess.getUTCDate()),
      );
      // Spring = 34,000 × 0.10 = 3,400
      expect(result).toBe(Math.round(COMMUTER_MAP.spring * 0.1));
    });

    it('returns 10% of normal on Fall Break days', () => {
      const year = generateAcademicYear(2025);
      const fb = year.fall.breaks.find(b => b.name === 'Fall Break')!.dates[0];
      const result = getExpectedCommuters(
        d(fb.getUTCFullYear(), fb.getUTCMonth() + 1, fb.getUTCDate()),
      );
      // Fall = 35,000 × 0.10 = 3,500
      expect(result).toBe(Math.round(COMMUTER_MAP.fall * 0.1));
    });
  });

  // ─── Observed-holiday edge cases ─────────────────────────

  describe('Federal observed-holiday rules', () => {
    it('moves Veterans Day from Saturday to Friday', () => {
      // Find a year where Nov 11 is Saturday
      // 2023: Nov 11 = Saturday
      const year = generateAcademicYear(2023);
      const vets = year.fall.breaks.find(b => b.name === 'Veterans Day');
      expect(vets).toBeDefined();
      // Should be observed Friday Nov 10
      expect(vets!.dates[0].getUTCDate()).toBe(10);
      expect(dow(vets!.dates[0])).toBe(5); // Friday
    });

    it('moves Veterans Day from Sunday to Monday', () => {
      // 2018: Nov 11 = Sunday
      const year = generateAcademicYear(2018);
      const vets = year.fall.breaks.find(b => b.name === 'Veterans Day');
      expect(vets).toBeDefined();
      // Should be observed Monday Nov 12
      expect(vets!.dates[0].getUTCDate()).toBe(12);
      expect(dow(vets!.dates[0])).toBe(1); // Monday
    });
  });

  // ─── Multi-year consistency ──────────────────────────────

  describe('Multi-year consistency', () => {
    const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027];

    it.each(years)('year %d: fall classes start on a Monday in August', (y) => {
      const year = generateAcademicYear(y);
      expect(dow(year.fall.classesStart)).toBe(1); // Monday
      expect(year.fall.classesStart.getUTCMonth()).toBe(7); // August
    });

    it.each(years)('year %d: spring classes start on a Tuesday', (y) => {
      const year = generateAcademicYear(y);
      expect(dow(year.spring.classesStart)).toBe(2); // Tuesday
    });

    it.each(years)('year %d: all semesters have valid date ranges', (y) => {
      const year = generateAcademicYear(y);
      for (const key of ['fall', 'spring', 'winter', 'mayIntersession', 'summer'] as const) {
        const sem = year[key];
        expect(sem.semesterStart.getTime()).toBeLessThanOrEqual(sem.semesterEnd.getTime());
        expect(sem.classesStart.getTime()).toBeLessThanOrEqual(sem.classesEnd.getTime());
      }
    });
  });
});
