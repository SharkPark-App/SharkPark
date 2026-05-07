import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { fetchJsonWithRetry } from '../common/http/fetch-json';

interface RawCampusLabsEvent {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  location: string | null;
  description: string | null;
}

interface BuildingRef {
  id: string;
  name: string;
  alternate_names: string[];
}

const DESCRIPTION_MAX_CHARS = 115;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    // Decode all non-ampersand entities BEFORE `&amp;` so that an input like
    // `&amp;lt;` is preserved as the literal text `&lt;` instead of being
    // double-unescaped into `<` (CodeQL js/double-escaping).
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#\d+;/gi, '')
    .replace(/&(?!amp;)[a-z]+;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// CampusLabs subdomains vary between schools that utilize it
const CAMPUSLABS_CONFIG: Record<string, string> = {
  CSULB: 'csulb',
};

@Injectable()
export class EventsScraperService {
  private readonly logger = new Logger(EventsScraperService.name);
  private readonly FETCH_WINDOW_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  async scrapeAll(): Promise<void> {
    for (const [shortName, subdomain] of Object.entries(CAMPUSLABS_CONFIG)) {
      const school = await this.prisma.school.findFirst({
        where: { short_name: shortName },
        select: { id: true, short_name: true },
      });

      if (!school) {
        this.logger.warn(`School not found for short_name="${shortName}" — skipping`);
        continue;
      }

      try {
        const { upserted, skipped } = await this.scrapeSchool(school.id, subdomain);
        this.logger.log(`[${shortName}] ${upserted} events upserted, ${skipped} skipped (no campus building match)`);
      } catch (err) {
        this.logger.error(`[${shortName}] scrape failed`, err instanceof Error ? err.stack : err);
        throw err;
      }
    }
  }

  private static readonly VIRTUAL_LOCATION = /\b(zoom|virtual|online|remote|tba|tbd)\b/i;

  private static isVirtualLocation(location: string): boolean {
    const normalized = location.trim();
    return !normalized || EventsScraperService.VIRTUAL_LOCATION.test(normalized);
  }

  private findBuilding(location: string, buildings: BuildingRef[]): BuildingRef | null {
    const loc = location.toLowerCase();

    // Pass 1: full-name regex match, longest name first so a more-specific
    // name (e.g. "Student Union Annex") wins over a prefix ("Student Union").
    const byNameLen = [...buildings].sort((a, b) => b.name.length - a.name.length);
    for (const b of byNameLen) {
      const escaped = escapeRegex(b.name);
      const pattern = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, 'i');
      if (pattern.test(loc)) return b;
    }

    // Pass 2: alternate-name regex match, longest alt first for the same reason.
    const alts = buildings
      .flatMap(b => b.alternate_names.map(alt => ({ building: b, alt })))
      .sort((a, b) => b.alt.length - a.alt.length);

    for (const { building, alt } of alts) {
      if (!alt) continue;
      const escaped = escapeRegex(alt);
      // use a negative lookahead instead of an explicit allowlist
      // so punctuation like "SA," and "SA." also match.
      const pattern = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, 'i');
      if (pattern.test(loc)) return building;
    }

    return null;
  }

  private async scrapeSchool(
    schoolId: string,
    subdomain: string,
  ): Promise<{ upserted: number; skipped: number }> {
    const buildings = await this.prisma.building.findMany({
      where: { school_id: schoolId },
      select: { id: true, name: true, alternate_names: true },
    });

    const rawEvents = await this.fetchAllEvents(subdomain);
    const physicalEvents = rawEvents.filter(e => !EventsScraperService.isVirtualLocation(e.location));

    const matched: (typeof physicalEvents[number] & { building_id: string })[] = [];
    const unmatchedLocs = new Set<string>();
    let skipped = 0;

    for (const event of physicalEvents) {
      const building = this.findBuilding(event.location, buildings);
      if (building) {
        matched.push({ ...event, building_id: building.id });
      } else {
        skipped += 1;
        unmatchedLocs.add(event.location);
      }
    }

    // Log unique unmatched locations to potentially add to building.alternate_names
    const uniqueLocs = [...unmatchedLocs].sort();
    uniqueLocs.forEach(loc => this.logger.warn(`UNMATCHED: ${JSON.stringify(loc)}`));

    await Promise.all(
      matched.map(event =>
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

    return { upserted: matched.length, skipped };
  }

  private async fetchAllEvents(subdomain: string) {
    const endsAfter = new Date().toISOString();
    const base = `https://${subdomain}.campuslabs.com/engage/api/discovery/event/search`;
    const results: {
      external_id: string;
      event_name: string;
      location: string;
      description: string | null;
      event_url: string;
      start_time: Date;
      end_time: Date;
    }[] = [];

    let skip = 0;

    const userAgent =
      process.env.WEATHER_USER_AGENT || 'SharkPark/1.0 (ops@sharkpark.app)';

    while (true) {
      const url = `${base}?endsAfter=${encodeURIComponent(endsAfter)}&status=Approved&take=100&skip=${skip}`;
      const data = await fetchJsonWithRetry<{ value?: RawCampusLabsEvent[] }>(
        url,
        { userAgent },
      );
      const page = data.value ?? [];

      for (const e of page) {
        const rawDescription = e.description ? stripHtml(e.description) : null;
        results.push({
          external_id: e.id,
          event_name: e.name,
          location: e.location ?? '',
          description: rawDescription
            ? rawDescription.slice(0, DESCRIPTION_MAX_CHARS)
            : null,
          event_url: `https://${subdomain}.campuslabs.com/engage/event/${e.id}`,
          start_time: new Date(e.startsOn),
          end_time: new Date(e.endsOn),
        });
      }

      if (page.length < 100) break;
      skip += 100;
    }

    return results;
  }
}
