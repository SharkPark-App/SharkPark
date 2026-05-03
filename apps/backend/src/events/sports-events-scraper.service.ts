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
  event_url: string | null;
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

@Injectable()
export class SportsEventsScraperService {
  private readonly logger = new Logger(SportsEventsScraperService.name);

  constructor(private readonly prisma: PrismaService) {}

  async scrapeAll(): Promise<void> {
    for (const [shortName, config] of Object.entries(SCHOOL_CONFIG)) {
      const school = await this.prisma.school.findFirst({
        where: { short_name: shortName },
        select: { id: true, short_name: true },
      });

      if (!school) {
        this.logger.warn(`School not found for short_name="${shortName}" — skipping`);
        continue;
      }

      try {
        const { upserted, skipped } = await this.scrapeSchool(school.id, config);
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
    const scraped = this.transform(rawEvents, buildingIdByName);

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
  ): ScrapedEvent[] {
    const out: ScrapedEvent[] = [];

    for (const e of raw) {
      if (e.locationIndicator !== HOME_INDICATOR) continue;
      if (e.gameStateDisplay === 'CANCELLED' || e.noplayText) continue;
      if (!e.time) continue;

      const buildingName = SPORT_TO_BUILDING_NAME[e.sport.shortname];
      if (!buildingName) continue;

      const buildingId = buildingIdByName.get(buildingName);
      if (!buildingId) continue;

      const start = new Date(e.date);
      if (isNaN(start.getTime())) continue;
      const end = new Date(start.getTime() + DEFAULT_GAME_DURATION_HOURS * 60 * 60 * 1000);

      const opponent = e.opponent?.title?.trim();
      const event_name = opponent
        ? `${e.sport.title} vs ${opponent}`
        : e.sport.title;

      const descriptionParts: string[] = [];
      if (e.conference) descriptionParts.push('Conference game');
      if (e.media?.tv) descriptionParts.push(`Broadcast: ${e.media.tv}`);
      const description = descriptionParts.length
        ? descriptionParts.join(' · ').slice(0, DESCRIPTION_MAX_CHARS)
        : null;

      const previewPath = e.media?.preview?.url ?? null;
      const event_url = previewPath
        ? previewPath.startsWith('http')
          ? previewPath
          : `https://longbeachstate.com${previewPath}`
        : null;

      out.push({
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

    return out;
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
