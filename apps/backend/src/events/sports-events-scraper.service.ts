import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';

/**
 * Sport `shortname` (as returned by the longbeachstate.com calendar API)
 * mapped to the canonical CSULB facility / `Building.name` it's hosted at.
 *
 * The API does NOT include the venue name in event payloads (only the city
 * "Long Beach, Calif."), so we resolve the building deterministically from
 * the sport identifier instead of fuzzy-matching a location string the way
 * `EventsScraperService` does for CampusLabs events.
 *
 * Sports played off-campus (`mgolf`/`wgolf` at Virginia Country Club &
 * El Dorado Park Golf Course) are intentionally omitted — they don't drive
 * parking demand on campus.
 *
 * Men's soccer and men's tennis are absent because CSULB doesn't field
 * those programs.
 */
const SPORT_TO_BUILDING_NAME: Record<string, string> = {
  softball: 'LBSU Softball Complex',
  baseball: 'Bohl Diamond at Blair Field',
  mbball: 'Pyramid',
  wbball: 'Pyramid',
  mvball: 'Pyramid',
  wvball: 'Pyramid',
  wbvball: 'LBSU Sand Courts',
  mwpolo: 'Ken Lindgren Aquatics Center',
  wwpolo: 'Ken Lindgren Aquatics Center',
  wten: 'Rhodes Tennis Center',
  track: 'Jack Rose Track',
  itrack: 'Jack Rose Track',
  wsoc: 'George Allen Field',
};

interface RawSidearmSport {
  id: number;
  title: string;
  shortname: string;
}

interface RawSidearmOpponent {
  id: number;
  title: string;
}

interface RawSidearmMedia {
  tv?: string | null;
  preview?: { url?: string | null } | null;
}

interface RawSidearmResult {
  recap?: { url?: string | null } | null;
}

interface RawSidearmEvent {
  id: number;
  /** Local-naive ISO timestamp, e.g. "2026-05-01T18:00:00". May be midnight when time is TBA. */
  date: string;
  /** Display string, e.g. "6 p.m." or "" when TBA. */
  time: string;
  /** "H" home, "A" away, "N" neutral. We only ingest "H". */
  locationIndicator: 'H' | 'A' | 'N';
  /** "" normally, populated when cancelled / postponed. */
  noplayText: string;
  /** "SCHEDULED" / "FINAL" / "CANCELLED" / "POSTPONED". */
  gameStateDisplay: string;
  /** True for conference games — surfaced in description. */
  conference: boolean;
  sport: RawSidearmSport;
  opponent: RawSidearmOpponent | null;
  media?: RawSidearmMedia | null;
  result?: RawSidearmResult | null;
}

interface RawSidearmDay {
  date: string;
  events: RawSidearmEvent[];
}

/**
 * Months ahead of the scrape date to fetch. Sports schedules are published
 * months in advance and the API is cheap (one call per month, no auth), so
 * a wider window keeps the table in sync with mid-season releases without
 * needing a tighter cron cadence.
 */
const FETCH_WINDOW_MONTHS = 6;

/** Skip events the school marked TBA — `time === ''` means the start time isn't published yet. */
const HOME_INDICATOR = 'H';

/** Sidearm-managed feed is read-only; namespace the external_id so it can never collide with CampusLabs IDs. */
const EXTERNAL_ID_PREFIX = 'lbsu-sports-';

/** CampusEvent.description column has no DB-level cap, but mobile UI truncates aggressively; mirror Zach's CampusLabs scraper. */
const DESCRIPTION_MAX_CHARS = 115;

/** Default game length when only a start time is published — keeps event_url banner visible through gametime. */
const DEFAULT_GAME_DURATION_HOURS = 3;

interface ScrapedEvent {
  external_id: string;
  event_name: string;
  location: string;
  description: string | null;
  /**
   * Always populated. Falls back to the sport's schedule page when the API
   * doesn't provide a per-game preview/recap URL, mirroring the campus-events
   * scraper which also always builds a deterministic URL.
   */
  event_url: string;
  start_time: Date;
  end_time: Date;
  building_id: string;
}

interface SchoolSportsConfig {
  /** Subdomain of the longbeachstate.com-style Sidearm calendar (e.g. "longbeachstate"). */
  sidearmSubdomain: string;
}

const SCHOOL_CONFIG: Record<string, SchoolSportsConfig> = {
  CSULB: { sidearmSubdomain: 'longbeachstate' },
};

/**
 * Parse a naive ISO timestamp ("YYYY-MM-DDTHH:mm:ss" with no zone marker) as
 * a wall-clock time in the given IANA timezone, returning the equivalent UTC
 * `Date`. Sidearm's calendar API returns naive timestamps anchored to the
 * school's local time, so we anchor parsing the same way instead of trusting
 * the host machine's TZ (which is UTC on Fly).
 *
 * Implementation: parse the string as if it were UTC to get a candidate
 * instant, ask Intl what wall-clock time that instant has in the target zone,
 * and use the difference between the candidate and the formatted wall clock
 * as the zone offset to subtract. Handles DST transitions correctly because
 * Intl reports the offset that applies at the requested wall-clock moment.
 */
function parseNaiveIsoInZone(naiveIso: string, timeZone: string): Date | null {
  // Strict shape check; Sidearm always returns this format but defend against
  // malformed payloads rather than silently producing garbage Dates.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(naiveIso);
  if (!match) return null;
  const asUtc = new Date(`${naiveIso}Z`);
  if (isNaN(asUtc.getTime())) return null;

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(asUtc)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const hour = Number(parts.hour) % 24; // Intl emits "24" for midnight in some envs
  const wallClockUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = wallClockUtcMs - asUtc.getTime();
  return new Date(asUtc.getTime() - offsetMs);
}

@Injectable()
export class SportsEventsScraperService {
  private readonly logger = new Logger(SportsEventsScraperService.name);

  constructor(private readonly prisma: PrismaService) {}

  async scrapeAll(): Promise<void> {
    for (const [shortName, config] of Object.entries(SCHOOL_CONFIG)) {
      const school = await this.prisma.school.findFirst({
        where: { short_name: shortName },
        select: { id: true, short_name: true, timezone: true },
      });

      if (!school) {
        this.logger.warn(`School not found for short_name="${shortName}" — skipping`);
        continue;
      }

      try {
        const { upserted, skipped } = await this.scrapeSchool(school.id, school.timezone, config);
        this.logger.log(
          `[${shortName}] ${upserted} sports events upserted, ${skipped} skipped (away/neutral/TBA/unmapped sport)`,
        );
      } catch (err) {
        this.logger.error(
          `[${shortName}] sports scrape failed`,
          err instanceof Error ? err.stack : err,
        );
        throw err;
      }
    }
  }

  private async scrapeSchool(
    schoolId: string,
    timezone: string,
    config: SchoolSportsConfig,
  ): Promise<{ upserted: number; skipped: number }> {
    // Resolve sport → building_id once per scrape using the school's seeded buildings.
    const buildingNames = [...new Set(Object.values(SPORT_TO_BUILDING_NAME))];
    const buildings = await this.prisma.building.findMany({
      where: { school_id: schoolId, name: { in: buildingNames } },
      select: { id: true, name: true },
    });
    const buildingIdByName = new Map(buildings.map(b => [b.name, b.id]));

    // Surface mapping gaps loudly — a missing building means events for that sport silently
    // wouldn't link to a lot. Logged at warn so it shows up in dashboards but doesn't fail
    // the whole scrape (other sports should still ingest).
    const missing = buildingNames.filter(n => !buildingIdByName.has(n));
    if (missing.length > 0) {
      this.logger.warn(
        `Missing building rows for sport venues: ${JSON.stringify(missing)} — events for those sports will be skipped`,
      );
    }

    const rawEvents = await this.fetchAllEvents(config.sidearmSubdomain);
    const scraped = this.transform(rawEvents, buildingIdByName, config.sidearmSubdomain, timezone);

    await Promise.all(
      scraped.map(event =>
        this.prisma.campusEvent.upsert({
          where: { external_id: event.external_id },
          update: {
            event_name: event.event_name,
            location: event.location,
            description: event.description,
            event_url: event.event_url,
            start_time: event.start_time,
            end_time: event.end_time,
            building_id: event.building_id,
          },
          create: {
            school_id: schoolId,
            external_id: event.external_id,
            event_name: event.event_name,
            location: event.location,
            description: event.description,
            event_url: event.event_url,
            start_time: event.start_time,
            end_time: event.end_time,
            building_id: event.building_id,
          },
        }),
      ),
    );

    return { upserted: scraped.length, skipped: rawEvents.length - scraped.length };
  }

  /**
   * Filter + shape raw Sidearm events into the CampusEvent payload.
   *
   * Skipped events:
   *   - `locationIndicator !== 'H'` (away/neutral don't drive home parking)
   *   - sport not in {@link SPORT_TO_BUILDING_NAME} (off-campus venue or unmapped)
   *   - building not seeded for that sport at this school
   *   - `gameStateDisplay === 'CANCELLED'` or `noplayText` populated
   *   - `time === ''` (TBA — we'd insert a midnight event which would notify users incorrectly)
   */
  private transform(
    raw: RawSidearmEvent[],
    buildingIdByName: Map<string, string>,
    sidearmSubdomain: string,
    timezone: string,
  ): ScrapedEvent[] {
    const siteOrigin = `https://${sidearmSubdomain}.com`;

    // Sidearm sometimes lists the same baseball series twice under different
    // ids (e.g. once on the team calendar and once on a conference calendar).
    // We saw 2026-05-01 baseball returned as both id=10021 and id=10109 with
    // identical date/time/opponent. Dedupe on (building, start, sport) and
    // keep the lowest id so the external_id stays stable across scrapes.
    const dedup = new Map<string, ScrapedEvent & { _rawId: number }>();

    for (const e of raw) {
      if (e.locationIndicator !== HOME_INDICATOR) continue;
      if (e.gameStateDisplay === 'CANCELLED' || e.noplayText) continue;
      if (!e.time) continue;

      const buildingName = SPORT_TO_BUILDING_NAME[e.sport.shortname];
      if (!buildingName) continue;

      const buildingId = buildingIdByName.get(buildingName);
      if (!buildingId) continue;

      // Sidearm returns naive ISO timestamps without a zone marker
      // (e.g. "2026-05-01T18:00:00" for a 6 PM Pacific game). `new Date()`
      // would parse those as the host machine's local time — fine on a Mac
      // in PDT, off by 7-8h on Fly.io's UTC machines. Anchor parsing to the
      // school's IANA timezone so production matches what's on the website.
      const start = parseNaiveIsoInZone(e.date, timezone);
      if (!start || isNaN(start.getTime())) continue;
      const end = new Date(start.getTime() + DEFAULT_GAME_DURATION_HOURS * 60 * 60 * 1000);

      // Some opponent titles already include the LBSU prefix
      // (e.g. men's volleyball returns "Long Beach State vs. Loyola Chicago").
      // Strip it so event_name doesn't end up as "…vs Long Beach State vs. …".
      const rawOpponent = e.opponent?.title?.trim();
      const opponent = rawOpponent
        ? rawOpponent.replace(/^Long Beach State\s+vs\.?\s+/i, '').trim() || undefined
        : undefined;
      const event_name = opponent
        ? `${e.sport.title} vs ${opponent}`
        : e.sport.title;

      const descriptionParts: string[] = [];
      if (e.conference) descriptionParts.push('Conference game');
      if (e.media?.tv) descriptionParts.push(`Broadcast: ${e.media.tv}`);
      const description = descriptionParts.length
        ? descriptionParts.join(' · ').slice(0, DESCRIPTION_MAX_CHARS)
        : null;

      // Prefer richer per-game URLs when available, otherwise fall back to the
      // sport's schedule page so every sports event has a useful tap-target —
      // matching the campus-events scraper which always builds an event_url
      // from a known pattern. Sidearm sport `shortname` doubles as a valid
      // schedule slug on every Sidearm-hosted athletics site we've seen.
      const candidatePath =
        e.media?.preview?.url
          ?? e.result?.recap?.url
          ?? `/sports/${e.sport.shortname}/schedule`;
      const event_url = candidatePath.startsWith('http')
        ? candidatePath
        : `${siteOrigin}${candidatePath}`;

      const dedupKey = `${buildingId}|${start.getTime()}|${e.sport.shortname}`;
      const existing = dedup.get(dedupKey);
      if (existing && existing._rawId <= e.id) continue;

      dedup.set(dedupKey, {
        _rawId: e.id,
        external_id: `${EXTERNAL_ID_PREFIX}${e.id}`,
        event_name,
        location: buildingName,
        description,
        event_url,
        start_time: start,
        end_time: end,
        building_id: buildingId,
      });
    }

    // Strip the internal `_rawId` field before returning.
    return Array.from(dedup.values()).map((entry) => {
      const { _rawId, ...rest } = entry;
      void _rawId;
      return rest;
    });
  }

  /**
   * Sidearm's calendar endpoint returns one month at a time, grouped by day.
   * We pull `FETCH_WINDOW_MONTHS` months starting from the current month.
   * The endpoint returns 200 with an empty array for months with no events,
   * so we fetch the full window without short-circuiting.
   */
  private async fetchAllEvents(subdomain: string): Promise<RawSidearmEvent[]> {
    const base = `https://${subdomain}.com/api/v2/calendar/events`;
    const now = new Date();
    const events: RawSidearmEvent[] = [];

    for (let i = 0; i < FETCH_WINDOW_MONTHS; i++) {
      const month = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const year = month.getFullYear();
      const monthStr = String(month.getMonth() + 1).padStart(2, '0');
      const url = `${base}?date=${year}-${monthStr}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `Sidearm sports calendar fetch failed: ${res.status} ${res.statusText} (${url})`,
        );
      }

      const days = (await res.json()) as RawSidearmDay[];
      for (const day of days) {
        for (const e of day.events) events.push(e);
      }
    }

    return events;
  }
}
