/**
 * CSULB Academic Calendar — Rule-Based Heuristics
 *
 * TypeScript port of services/ml/src/academic_calendar.py
 *
 * Computes semester dates dynamically for any academic year using
 * CSULB's predictable calendar patterns. No database tables or hardcoded
 * per-year data needed.
 *
 * Heuristic rules:
 *   - Fall: classes start on the 4th Monday of August (~16-week semester)
 *   - Spring: classes start the Tuesday after MLK Day (3rd Monday of January)
 *   - Winter intersession: first weekday on/after January 2 through MLK Day
 *   - May intersession: Monday after spring finals for ~3 weeks
 *   - Summer session: follows May intersession for ~10 weeks
 *   - Holidays follow federal observed-holiday rules (Sat→Fri, Sun→Mon)
 *
 * Why heuristics over hardcoded dates:
 *   CSULB has followed these patterns consistently. For real-time estimation
 *   and ML features, what matters is category-level accuracy (classes vs.
 *   finals vs. break). If CSULB changes their scheduling pattern, update
 *   the generate* functions.
 */

// ─── Types ─────────────────────────────────────────────────

export interface SemesterBreak {
  name: string;
  dates: Date[];
  campusClosed: boolean;
}

export interface SemesterInfo {
  semesterStart: Date;
  semesterEnd: Date;
  classesStart: Date;
  classesEnd: Date;
  finalsStart: Date | null;
  finalsEnd: Date | null;
  breaks: SemesterBreak[];
  readingDays: Date[];
}

export interface AcademicYear {
  fall: SemesterInfo;
  spring: SemesterInfo;
  winter: SemesterInfo;
  mayIntersession: SemesterInfo;
  summer: SemesterInfo;
}

export type SemesterKey = 'fall' | 'spring' | 'winter' | 'mayIntersession' | 'summer';
export type PeriodType =
  | 'early'
  | 'regular'
  | 'midterms'
  | 'late'
  | 'dead_week'
  | 'finals'
  | 'winter_session'
  | 'summer_session'
  | 'break';
export type SemesterCategory = 'fall' | 'spring' | 'summer' | 'session' | 'break';

// ─── Constants ─────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Day-of-week (JS convention: 0 = Sunday, 6 = Saturday) */
const SUN = 0, MON = 1, THU = 4, SAT = 6;

/** Expected daily commuters by semester category */
export const COMMUTER_MAP: Record<SemesterCategory, number> = {
  fall: 35_000,
  spring: 34_000,
  summer: 8_000,
  session: 3_000,
  break: 1_500,
};

/** In-semester break: fraction of normal commuters (staff/employees only) */
const IN_SEMESTER_BREAK_FRACTION = 0.10;

const INTERSESSION_KEYS = new Set<SemesterKey>(['winter', 'mayIntersession', 'summer']);
const SEMESTER_ORDER: SemesterKey[] = ['fall', 'winter', 'spring', 'summer', 'mayIntersession'];
const SEMESTER_CATEGORY_MAP: Record<SemesterKey, SemesterCategory> = {
  fall: 'fall',
  spring: 'spring',
  winter: 'session',
  mayIntersession: 'session',
  summer: 'summer',
};

// ─── Internal Date Utilities ───────────────────────────────
// All internal calendar dates use UTC midnight for clean comparisons.
// Public API accepts any Date and extracts year/month/day via local getters.

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function dow(d: Date): number {
  return d.getUTCDay();
}

function lte(a: Date, b: Date): boolean {
  return a.getTime() <= b.getTime();
}

function inSet(d: Date, dates: Date[]): boolean {
  const t = d.getTime();
  return dates.some(x => x.getTime() === t);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Convert any Date to a UTC midnight date using its local year/month/day */
function toCalDate(d: Date): Date {
  return utc(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** nth weekday of month (weekday: 0=Sun..6=Sat, n: 1-based) */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const firstDow = dow(utc(year, month, 1));
  const daysAhead = (weekday - firstDow + 7) % 7;
  return utc(year, month, 1 + daysAhead + (n - 1) * 7);
}

/** Last weekday of month */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = dow(utc(year, month, lastDayNum));
  const daysBack = (lastDow - weekday + 7) % 7;
  return utc(year, month, lastDayNum - daysBack);
}

/** Federal observed-holiday rule: Sat → Fri, Sun → Mon */
function observe(d: Date): Date {
  if (dow(d) === SAT) return addDays(d, -1);
  if (dow(d) === SUN) return addDays(d, 1);
  return d;
}

/** Monday of the ISO week containing the given date */
function mondayOfWeek(d: Date): Date {
  const day = dow(d);
  const offset = day === SUN ? 6 : day - MON;
  return addDays(d, -offset);
}

// ─── Calendar Generation ───────────────────────────────────

function generateFall(year: number): SemesterInfo {
  // 4th Monday of August
  const classesStart = nthWeekday(year, 8, MON, 4);
  const semesterStart = addDays(classesStart, -7); // orientation week
  const classesEnd = addDays(classesStart, 107);   // Wednesday of week 16
  const readingDay = addDays(classesEnd, 1);        // Thursday
  const finalsStart = addDays(classesEnd, 2);       // Friday
  const finalsEnd = addDays(finalsStart, 6);        // following Thursday
  const semesterEnd = addDays(finalsEnd, 6);

  const laborDay = nthWeekday(year, 9, MON, 1);
  const veteransDay = observe(utc(year, 11, 11));
  const thanksgiving = nthWeekday(year, 11, THU, 4);
  const fallBreakStart = addDays(thanksgiving, -3); // Monday of Thanksgiving week

  return {
    semesterStart, semesterEnd, classesStart, classesEnd,
    finalsStart, finalsEnd,
    readingDays: [readingDay],
    breaks: [
      { name: 'Labor Day', dates: [laborDay], campusClosed: true },
      { name: 'Veterans Day', dates: [veteransDay], campusClosed: true },
      {
        name: 'Fall Break',
        dates: [fallBreakStart, addDays(fallBreakStart, 1), addDays(fallBreakStart, 2)],
        campusClosed: false,
      },
      {
        name: 'Thanksgiving',
        dates: [thanksgiving, addDays(thanksgiving, 1), addDays(thanksgiving, 2), addDays(thanksgiving, 3)],
        campusClosed: true,
      },
    ],
  };
}

function generateSpring(year: number): SemesterInfo {
  // Tuesday after MLK Day (3rd Monday of January)
  const mlkDay = nthWeekday(year, 1, MON, 3);
  const classesStart = addDays(mlkDay, 1);
  const classesEnd = addDays(classesStart, 107);
  const finalsStart = addDays(classesEnd, 3);  // following Monday
  const finalsEnd = addDays(finalsStart, 5);   // Saturday
  const semesterEnd = addDays(finalsEnd, 1);   // Sunday

  // Spring Recess: full week (Mon-Sun) containing March 31
  const mar31 = utc(year, 3, 31);
  const recessStart = mondayOfWeek(mar31);
  const springRecessDates = Array.from({ length: 7 }, (_, i) => addDays(recessStart, i));

  // Cesar Chavez Day (March 31, observed)
  const cesarChavez = observe(mar31);

  return {
    semesterStart: classesStart, semesterEnd, classesStart, classesEnd,
    finalsStart, finalsEnd,
    readingDays: [],
    breaks: [
      { name: 'Spring Recess', dates: springRecessDates, campusClosed: false },
      { name: 'Cesar Chavez Day', dates: [cesarChavez], campusClosed: true },
    ],
  };
}

function generateWinter(year: number): SemesterInfo {
  // First weekday on or after January 2
  const jan2 = utc(year, 1, 2);
  let start: Date;
  if (dow(jan2) === SAT) start = addDays(jan2, 2);
  else if (dow(jan2) === SUN) start = addDays(jan2, 1);
  else start = jan2;

  const mlkDay = nthWeekday(year, 1, MON, 3);

  return {
    semesterStart: start, semesterEnd: mlkDay,
    classesStart: start, classesEnd: mlkDay,
    finalsStart: null, finalsEnd: null,
    readingDays: [],
    breaks: [
      { name: 'Martin Luther King Jr. Day', dates: [mlkDay], campusClosed: true },
    ],
  };
}

function generateMayIntersession(spring: SemesterInfo): SemesterInfo {
  const finalsEnd = spring.finalsEnd!;
  let daysToMon = (MON - dow(finalsEnd) + 7) % 7;
  if (daysToMon === 0) daysToMon = 7;
  const start = addDays(finalsEnd, daysToMon);
  const end = addDays(start, 18); // ~3 weeks

  const memorialDay = lastWeekday(start.getUTCFullYear(), 5, MON);

  const breaks: SemesterBreak[] = [];
  if (lte(start, memorialDay) && lte(memorialDay, end)) {
    breaks.push({ name: 'Memorial Day', dates: [memorialDay], campusClosed: true });
  }

  return {
    semesterStart: start, semesterEnd: end,
    classesStart: start, classesEnd: end,
    finalsStart: null, finalsEnd: null,
    readingDays: [],
    breaks,
  };
}

function generateSummer(year: number): SemesterInfo {
  // 12-week session starting last Tuesday of May (~May 26)
  // This overlaps the last 2 weeks of may-intersession, but summer is prioritized
  // in lookups (SEMESTER_ORDER) to correctly estimate 8K commuters instead of 3K
  const start = lastWeekday(year, 5, 2); // Tuesday = 2 in UTC day convention
  const end = addDays(start, 83); // 12 weeks

  const juneteenth = observe(utc(year, 6, 19));
  const independenceDay = observe(utc(year, 7, 4));

  const breaks: SemesterBreak[] = [];
  if (lte(start, juneteenth) && lte(juneteenth, end)) {
    breaks.push({ name: 'Juneteenth', dates: [juneteenth], campusClosed: true });
  }
  if (lte(start, independenceDay) && lte(independenceDay, end)) {
    breaks.push({ name: 'Independence Day', dates: [independenceDay], campusClosed: true });
  }

  return {
    semesterStart: start, semesterEnd: end,
    classesStart: start, classesEnd: end,
    finalsStart: null, finalsEnd: null,
    readingDays: [],
    breaks,
  };
}

// ─── Year Generation & Cache ───────────────────────────────

const cache = new Map<number, AcademicYear>();

/** Generate (or retrieve from cache) the full academic year starting in `startYear`. */
export function generateAcademicYear(startYear: number): AcademicYear {
  const cached = cache.get(startYear);
  if (cached) return cached;

  const nextYear = startYear + 1;
  const fall = generateFall(startYear);
  const spring = generateSpring(nextYear);
  const winter = generateWinter(nextYear);
  const mayIntersession = generateMayIntersession(spring);
  const summer = generateSummer(nextYear);

  const year: AcademicYear = { fall, spring, winter, mayIntersession, summer };
  cache.set(startYear, year);
  return year;
}

// ─── Internal Lookup ───────────────────────────────────────

function allBreakDates(sem: SemesterInfo): Date[] {
  return sem.breaks.flatMap(b => b.dates);
}

function allClosedDates(sem: SemesterInfo): Date[] {
  return sem.breaks.filter(b => b.campusClosed).flatMap(b => b.dates);
}

/** Academic years run Aug–Jul. Dates Aug+ → that year. Jan–Jul → previous year. */
function academicYearForDate(d: Date): number {
  const month = d.getUTCMonth() + 1;
  return month >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

interface SemesterMatch {
  semester: SemesterInfo;
  key: SemesterKey;
  isIntersession: boolean;
}

function findSemester(d: Date): SemesterMatch | null {
  const startYear = academicYearForDate(d);
  const yearData = generateAcademicYear(startYear);

  for (const key of SEMESTER_ORDER) {
    const sem = yearData[key];
    if (lte(sem.semesterStart, d) && lte(d, sem.semesterEnd)) {
      return { semester: sem, key, isIntersession: INTERSESSION_KEYS.has(key) };
    }
  }
  return null;
}

// ─── Public API ────────────────────────────────────────────
// All functions accept a Date whose local year/month/day represent the
// calendar date in the school's timezone. Call toSchoolTime() first if
// working with UTC timestamps.

/**
 * Week number (1-based) and academic period classification for a date.
 *
 * Period values: early (weeks 1-2), regular (3-7), midterms (8-9),
 * late (10-14), dead_week (15+), finals, winter_session, summer_session,
 * break. Intersession class days return ``winter_session`` (winter or
 * may intersession) or ``summer_session`` (summer term) so downstream
 * consumers can apply low-activity scaling without re-deriving the
 * semester key.
 */
export function getWeekOfSemester(input: Date): [number, PeriodType] {
  const d = toCalDate(input);
  const match = findSemester(d);
  if (!match) return [0, 'break'];

  const { semester: sem, key, isIntersession } = match;
  const breakDates = allBreakDates(sem);

  const week = lte(sem.classesStart, d)
    ? Math.floor(daysBetween(sem.classesStart, d) / 7) + 1
    : 0;

  if (inSet(d, breakDates)) return [week, 'break'];

  if (sem.finalsStart && sem.finalsEnd && lte(sem.finalsStart, d) && lte(d, sem.finalsEnd)) {
    return [week, 'finals'];
  }

  if (lte(sem.classesStart, d) && lte(d, sem.classesEnd)) {
    if (isIntersession) {
      // May intersession is the ~3-week term that starts the Monday
      // *after* spring finals end (typically May 18+) — the first half
      // of May is still classified as regular spring / finals by
      // _findSemester, so this branch only fires for the post-finals
      // window. Bucket it with summer (warm-season, low-staff) so the
      // postprocess multiplier (~0.30, ~8k commuters) matches summer
      // rather than winter's ~0.10.
      return [week, key === 'winter' ? 'winter_session' : 'summer_session'];
    }
    if (week <= 2) return [week, 'early'];
    if (week <= 7) return [week, 'regular'];
    if (week <= 9) return [week, 'midterms'];
    if (week <= 14) return [week, 'late'];
    return [week, 'dead_week'];
  }

  if (inSet(d, sem.readingDays)) return [week, 'dead_week'];
  return [week, 'break'];
}

/** True if the date is a regular class day (weekday, during instruction, not a break/reading/holiday). */
export function isClassDay(input: Date): boolean {
  const d = toCalDate(input);
  if (dow(d) === SAT || dow(d) === SUN) return false;

  const match = findSemester(d);
  if (!match) return false;

  const { semester: sem } = match;
  if (!lte(sem.classesStart, d) || !lte(d, sem.classesEnd)) return false;

  return !inSet(d, allBreakDates(sem)) && !inSet(d, sem.readingDays);
}

/** How far through the semester (0.0 → 1.0). Uses classesStart to finalsEnd. */
export function getSemesterProgress(input: Date): number {
  const d = toCalDate(input);
  const match = findSemester(d);
  if (!match) return 0;

  const { semester: sem } = match;
  const start = sem.classesStart;
  const end = sem.finalsEnd ?? sem.classesEnd;

  if (lte(d, start)) return 0;
  if (!lte(d, end)) return 1;

  const total = daysBetween(start, end);
  return total > 0 ? daysBetween(start, d) / total : 0;
}

/** Classify a date into a semester category: fall, spring, summer, session, break. */
export function getSemester(input: Date): SemesterCategory {
  const d = toCalDate(input);
  const match = findSemester(d);
  if (!match) return 'break';
  return SEMESTER_CATEGORY_MAP[match.key];
}

/** True if campus is open (not a campus-closed holiday). */
export function isCampusOpen(input: Date): boolean {
  const d = toCalDate(input);
  const match = findSemester(d);
  if (!match) return true; // dates outside any semester — campus open by default
  return !inSet(d, allClosedDates(match.semester));
}

/**
 * Expected daily commuters for the date's academic context.
 *
 * - Regular class day → full commuters for the semester category
 * - Campus-closed holiday → COMMUTER_MAP.break (minimal staff)
 * - In-semester break (spring break, fall break) → 10% of normal
 * - Between semesters → COMMUTER_MAP.break
 */
export function getExpectedCommuters(input: Date): number {
  const d = toCalDate(input);
  const match = findSemester(d);

  // Between semesters
  if (!match) return COMMUTER_MAP.break;

  const category = SEMESTER_CATEGORY_MAP[match.key];

  // Campus-closed holidays (Labor Day, Thanksgiving, etc.)
  if (inSet(d, allClosedDates(match.semester))) return COMMUTER_MAP.break;

  // In-semester break (Spring Recess, Fall Break days that aren't campus-closed)
  if (inSet(d, allBreakDates(match.semester))) {
    return Math.round(COMMUTER_MAP[category] * IN_SEMESTER_BREAK_FRACTION);
  }

  // Regular period (classes, finals, reading days)
  return COMMUTER_MAP[category];
}
