/**
 * CSULB Parking Permit Fee Schedule (FY 2025-26).
 *
 * Source: https://www.csulb.edu/parking-and-transportation-services/permit-information-regulations
 *
 * CSULB freezes fees per fiscal year (Sep 1 → Aug 31). The
 * `check-permit-fee-drift` cron pings the source URL weekly during July and
 * August (when the new schedule typically posts) and opens a Sentry warning
 * when the page-body hash changes, prompting a manual PR to update this file.
 *
 * Lives alongside `csulb-eligibility.ts` and `academic-calendar.ts` as
 * static CSULB domain knowledge — NOT in the database. Fees do not vary
 * per-lot in any way that would benefit from a relational schema; the only
 * per-lot dimension is "does this lot accept short-term / daily / overnight,"
 * which is already captured by the existing `short_term_parking_spaces`,
 * `daily_permit_allowed`, and lot-id checks on the `Lot` model.
 *
 * ParkMobile umbrella zones:
 *   - 3993 — valid in any General (G) lot or campus parking structure
 *   - 3975 — valid in any Employee (E) lot
 * Lot-specific zones are stored on each Lot row in `park_mobile_zones`.
 */
export const CSULB_PERMIT_FEES = {
  effective_through: '2026-08-31',
  source_url:
    'https://www.csulb.edu/parking-and-transportation-services/permit-information-regulations',

  visitor: {
    short_term: [
      { max_minutes: 30, price: 4 },
      { max_minutes: 60, price: 6 },
      { max_minutes: 90, price: 10 },
    ],
    daily: 15,
    evening_weekend: {
      price: 10,
      conditions: 'After 5:30 PM Mon–Fri; all day Sat–Sun',
    },
    overnight: {
      available_at_lots: ['G2'],
      increments_hours: [24, 48, 72],
      price_note: 'See pay station at Lot G2 — price not published online',
    },
  },

  permits: {
    student_semester: 259,
    student_summer: 171,
    student_academic_year: 518,
    student_monthly: 57,
    resident_semester: 311,
    resident_summer: 207,
    resident_academic_year: 622,
    motorcycle_semester: 129,
    motorcycle_summer: 93,
    mpp_aux_monthly: 57,
    cfa_unit3_full_year: 209.64,
  },

  parkmobile: {
    umbrella_zones: {
      general: '3993',
      employee: '3975',
    },
    deep_link_template: 'https://app.parkmobile.io/?zone={zone}',
  },
} as const;

export type CsulbPermitFees = typeof CSULB_PERMIT_FEES;

/**
 * Set of zone numbers considered "umbrella" — valid across many lots rather
 * than identifying a single one. Mobile clients should prefer a lot-specific
 * (non-umbrella) zone for the ParkMobile deep link and only fall back to an
 * umbrella zone when no specific zone is available for the lot.
 */
export const UMBRELLA_PARKMOBILE_ZONES: ReadonlySet<string> = new Set([
  CSULB_PERMIT_FEES.parkmobile.umbrella_zones.general,
  CSULB_PERMIT_FEES.parkmobile.umbrella_zones.employee,
]);

/**
 * Picks the best ParkMobile zone for a deep link from a lot's `park_mobile_zones`.
 * Returns the first non-umbrella zone if present (most specific), otherwise the
 * first zone in the list, otherwise `null` when the lot has no ParkMobile coverage.
 */
export function pickPreferredParkMobileZone(zones: readonly string[]): string | null {
  if (zones.length === 0) return null;
  const specific = zones.find((z) => !UMBRELLA_PARKMOBILE_ZONES.has(z));
  return specific ?? zones[0];
}

/**
 * Lot-applied subset of the global fee schedule. Returned alongside the
 * `ParkingLotResponse` so the mobile client can render a Visitor Pricing card
 * without a second round-trip.
 *
 * Fields are nullable when the lot is not eligible for that fee type:
 *   - `short_term` is null unless the lot has signed short-term spaces
 *   - `daily` is null unless the lot accepts daily permits at its pay station
 *   - `overnight` is null unless the lot is in
 *     `CSULB_PERMIT_FEES.visitor.overnight.available_at_lots`
 * `evening_weekend` is always present — every lot honours it after-hours.
 */
export interface AppliedFees {
  short_term:
    | ReadonlyArray<{ max_minutes: number; price: number }>
    | null;
  daily: number | null;
  evening_weekend: {
    price: number;
    conditions: string;
  };
  overnight: {
    available_at_lots: readonly string[];
    increments_hours: readonly number[];
    price_note: string;
  } | null;
}

/**
 * Build the `applied_fees` block for a given lot. Pure / no I/O — derives
 * everything from the static fee schedule and a few lot fields.
 */
export function buildAppliedFees(lot: {
  lot_id: string;
  daily_permit_allowed: boolean;
  short_term_parking_spaces: number;
}): AppliedFees {
  const isOvernightLot = (
    CSULB_PERMIT_FEES.visitor.overnight.available_at_lots as readonly string[]
  ).includes(lot.lot_id);
  return {
    short_term:
      lot.short_term_parking_spaces > 0 ? CSULB_PERMIT_FEES.visitor.short_term : null,
    daily: lot.daily_permit_allowed ? CSULB_PERMIT_FEES.visitor.daily : null,
    evening_weekend: CSULB_PERMIT_FEES.visitor.evening_weekend,
    overnight: isOvernightLot ? CSULB_PERMIT_FEES.visitor.overnight : null,
  };
}
