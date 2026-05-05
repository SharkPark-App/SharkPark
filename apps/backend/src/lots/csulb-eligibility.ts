import type { LotType } from '@prisma/client';

/**
 * CSULB-specific permit eligibility rules.
 *
 * Static permit_types on each lot encode the *baseline* who-can-park rules.
 * CSULB also has a *time-of-day* rule that is NOT encoded in the static seed
 * because it would conflate "permit the lot accepts" with "the user can park
 * here right now":
 *
 *   - Employees (faculty/staff) may park in any lot at any time.
 *   - Students may park in employee lots Monday–Friday after 17:30 local time
 *     and any time on Saturday/Sunday.
 *
 * This helper centralises that rule so the recommender, mobile filter, and
 * any future eligibility check stay in sync.
 */

const STUDENT_AFTER_HOURS_START_MINUTES = 17 * 60 + 30; // 17:30

/**
 * Returns the set of lot types a STUDENT permit-holder is currently allowed to
 * use, given the wall-clock time in the school's timezone. Employees have no
 * time restriction so they are not modelled here.
 */
export function studentEligibleLotTypes(now: Date, timezone: string): Set<LotType> {
  const eligible = new Set<LotType>(['STUDENT']);

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
  const minutesOfDay = Number(hourStr) * 60 + Number(minuteStr);

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isAfterHours = minutesOfDay >= STUDENT_AFTER_HOURS_START_MINUTES;

  if (isWeekend || isAfterHours) {
    eligible.add('EMPLOYEE');
  }

  return eligible;
}
