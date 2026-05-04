import { Injectable, Logger } from '@nestjs/common';
import { SportsEventStatus, SportsResultStatus } from '@prisma/client';
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
  /** "W" / "L" / "T" once the game is FINAL, "N" pre-game. */
  status?: 'W' | 'L' | 'T' | 'N' | null;
  /** Stringified ints; "" pre-game. teamScore = LBSU, opponentScore = visitor. */
  teamScore?: string | null;
  opponentScore?: string | null;
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
  /**
   * Integer state code. Observed values:
   *   0  = pre-game (SCHEDULED)
   *   1-7 = in-progress (LIVE — covers halftime, between innings, etc.)
   *   8  = GAMECOMPLETE (FINAL)
   * We collapse 1-7 to LIVE in {@link mapStatus}.
   */
  gameState: number;
  /** "SCHEDULED" / "GAMECOMPLETE" / "CANCELLED" / "POSTPONED". */
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

/**
 * How far before kickoff `scrapeLive` will start polling for live updates.
 * 15 min is enough to catch the SCHEDULED → LIVE transition that Sidearm
 * usually publishes once warmups end.
 */
const LIVE_LOOKAHEAD_BEFORE_MINUTES = 15;

/**
 * How long after `end_time` (which is start + DEFAULT_GAME_DURATION_HOURS)
 * we keep polling. Sports routinely run long (extra innings, OT), so we
 * give a generous tail before letting the row drop out of the live window.
 */
const LIVE_LOOKBACK_AFTER_MINUTES = 60;

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
  // ── Live state derived from gameState/gameStateDisplay/result ───────
  status: SportsEventStatus;
  home_score: number | null;
  away_score: number | null;
  result_status: SportsResultStatus | null;
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

/**
 * Map a raw Sidearm event to its canonical {@link SportsEventStatus}.
 *
 * Precedence (most specific first):
 *   1. `noplayText` populated  → CANCELLED (school-marked, e.g. "Cancelled — weather")
 *   2. `gameStateDisplay`      → POSTPONED / CANCELLED (string discriminator)
 *   3. `gameStateDisplay`      → GAMECOMPLETE → FINAL
 *   4. `gameState` integer     → 0 = SCHEDULED, anything else (1-7) = LIVE
 *
 * Sidearm uses several intermediate `gameState` codes for halftime, between
 * innings, etc. — we deliberately collapse all non-zero pre-FINAL states to
 * LIVE because the UI only needs a single "in progress" indicator.
 */
function mapStatus(e: RawSidearmEvent): SportsEventStatus {
  if (e.noplayText) return SportsEventStatus.CANCELLED;
  if (e.gameStateDisplay === 'POSTPONED') return SportsEventStatus.POSTPONED;
  if (e.gameStateDisplay === 'CANCELLED') return SportsEventStatus.CANCELLED;
  if (e.gameStateDisplay === 'GAMECOMPLETE') return SportsEventStatus.FINAL;
  if (e.gameState === 0) return SportsEventStatus.SCHEDULED;
  return SportsEventStatus.LIVE;
}

/**
 * Parse `result.teamScore` / `result.opponentScore` (strings, blank when no
 * score yet) into ints, plus the W/L/T result status when the game is FINAL.
 *
 * Only populates scores for LIVE / FINAL — pre-game scores are always blank
 * but Sidearm has been seen returning stale strings ("0"/"0") for not-yet-
 * started events; gating on status keeps the DB clean.
 */
function mapScores(
  e: RawSidearmEvent,
  status: SportsEventStatus,
): { home_score: number | null; away_score: number | null; result_status: SportsResultStatus | null } {
  if (status !== SportsEventStatus.LIVE && status !== SportsEventStatus.FINAL) {
    return { home_score: null, away_score: null, result_status: null };
  }
  const home = parseScore(e.result?.teamScore);
  const away = parseScore(e.result?.opponentScore);
  let resultStatus: SportsResultStatus | null = null;
  if (status === SportsEventStatus.FINAL) {
    const raw = e.result?.status;
    if (raw === 'W') resultStatus = SportsResultStatus.W;
    else if (raw === 'L') resultStatus = SportsResultStatus.L;
    else if (raw === 'T') resultStatus = SportsResultStatus.T;
  }
  return { home_score: home, away_score: away, result_status: resultStatus };
}

function parseScore(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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

  /**
   * Live-window refresh: only updates status/score for sports events that
   * are currently in (or about to enter) their live window.
   *
   * Cheap by design — first runs a DB probe; if no candidate rows are found,
   * the cron exits without making any external API calls. This lets us run
   * it every couple of minutes during the day without abusing Sidearm or
   * burning Fly cron VM budget.
   *
   * Candidate window:
   *   start_time <= now + {@link LIVE_LOOKAHEAD_BEFORE_MINUTES}
   *   end_time   >= now - {@link LIVE_LOOKBACK_AFTER_MINUTES}
   *   status     IN (SCHEDULED, LIVE)
   *
   * For each affected school, only the current month is fetched (live games
   * are by definition today). We then update *only* status/score columns —
   * never event_name/start_time/etc, which the daily full scrape owns.
   */
  async scrapeLive(): Promise<void> {
    const now = new Date();
    const candidateStartCutoff = new Date(now.getTime() + LIVE_LOOKAHEAD_BEFORE_MINUTES * 60 * 1000);
    const candidateEndCutoff = new Date(now.getTime() - LIVE_LOOKBACK_AFTER_MINUTES * 60 * 1000);

    const candidates = await this.prisma.campusEvent.findMany({
      where: {
        external_id: { startsWith: EXTERNAL_ID_PREFIX },
        status: { in: [SportsEventStatus.SCHEDULED, SportsEventStatus.LIVE] },
        start_time: { lte: candidateStartCutoff },
        end_time: { gte: candidateEndCutoff },
      },
      select: { external_id: true, school_id: true },
    });

    if (candidates.length === 0) {
      this.logger.debug('scrapeLive: no candidate events in live window — skipping API call');
      return;
    }

    // Group candidates by school so we only fetch each Sidearm site once.
    const candidateIdsBySchool = new Map<string, Set<string>>();
    for (const c of candidates) {
      let set = candidateIdsBySchool.get(c.school_id);
      if (!set) {
        set = new Set();
        candidateIdsBySchool.set(c.school_id, set);
      }
      set.add(c.external_id);
    }

    let updated = 0;
    for (const [schoolId, externalIds] of candidateIdsBySchool) {
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { short_name: true, timezone: true },
      });
      if (!school) continue;
      const config = SCHOOL_CONFIG[school.short_name];
      if (!config) continue;

      const buildingNames = [...new Set(Object.values(SPORT_TO_BUILDING_NAME))];
      const buildings = await this.prisma.building.findMany({
        where: { school_id: schoolId, name: { in: buildingNames } },
        select: { id: true, name: true },
      });
      const buildingIdByName = new Map(buildings.map(b => [b.name, b.id]));

      const raw = await this.fetchCurrentMonth(config.sidearmSubdomain);
      const scraped = this.transform(raw, buildingIdByName, config.sidearmSubdomain, school.timezone);

      // Only touch rows we already know are in the live window — avoids
      // accidentally re-asserting status on a far-future game whose Sidearm
      // gameState briefly flickered.
      const updates = scraped.filter(s => externalIds.has(s.external_id));
      await Promise.all(
        updates.map(event =>
          this.prisma.campusEvent.update({
            where: { external_id: event.external_id },
            data: {
              status: event.status,
              home_score: event.home_score,
              away_score: event.away_score,
              result_status: event.result_status,
              status_updated_at: new Date(),
            },
          }),
        ),
      );
      updated += updates.length;
    }

    this.logger.log(`scrapeLive: refreshed ${updated} of ${candidates.length} candidate event(s)`);
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
            status: event.status,
            home_score: event.home_score,
            away_score: event.away_score,
            result_status: event.result_status,
            status_updated_at: new Date(),
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
            status: event.status,
            home_score: event.home_score,
            away_score: event.away_score,
            result_status: event.result_status,
            status_updated_at: new Date(),
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
   *   - `time === ''` (TBA — we'd insert a midnight event which would notify users incorrectly)
   *
   * POSTPONED / CANCELLED events ARE upserted (with the corresponding status)
   * so the mobile UI can show "Postponed" instead of silently dropping a row
   * the user might have planned around.
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

      const status = mapStatus(e);
      const { home_score, away_score, result_status } = mapScores(e, status);

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
        status,
        home_score,
        away_score,
        result_status,
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

  /**
   * Live-cron variant of {@link fetchAllEvents} — pulls only the current
   * month, since live games are by definition today.
   */
  private async fetchCurrentMonth(subdomain: string): Promise<RawSidearmEvent[]> {
    const now = new Date();
    const year = now.getFullYear();
    const monthStr = String(now.getMonth() + 1).padStart(2, '0');
    const url = `https://${subdomain}.com/api/v2/calendar/events?date=${year}-${monthStr}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Sidearm sports calendar fetch failed: ${res.status} ${res.statusText} (${url})`,
      );
    }

    const days = (await res.json()) as RawSidearmDay[];
    const events: RawSidearmEvent[] = [];
    for (const day of days) {
      for (const e of day.events) events.push(e);
    }
    return events;
  }
}
