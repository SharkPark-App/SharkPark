import { Test, TestingModule } from '@nestjs/testing';
import { SportsEventsScraperService } from './sports-events-scraper.service';
import { PrismaService } from '../database/database.module';

interface MockPrisma {
  school: { findFirst: jest.Mock };
  building: { findMany: jest.Mock };
  campusEvent: { upsert: jest.Mock };
}

const SCHOOL_ID = 'school_csulb';

const buildingRow = (id: string, name: string) => ({ id, name });

const SEEDED_BUILDINGS = [
  buildingRow('b_softball', 'LBSU Softball Complex'),
  buildingRow('b_blair', 'Bohl Diamond at Blair Field'),
  buildingRow('b_pyramid', 'Pyramid'),
  buildingRow('b_sand', 'LBSU Sand Courts'),
  buildingRow('b_aquatics', 'Ken Lindgren Aquatics Center'),
  buildingRow('b_tennis', 'Rhodes Tennis Center'),
  buildingRow('b_track', 'Jack Rose Track'),
  buildingRow('b_soccer', 'George Allen Field'),
];

interface RawEventInput {
  id: number;
  date: string;
  time?: string;
  locationIndicator?: 'H' | 'A' | 'N';
  noplayText?: string;
  gameStateDisplay?: string;
  conference?: boolean;
  sportShortname: string;
  sportTitle?: string;
  opponent?: string | null;
  tv?: string | null;
  previewUrl?: string | null;
}

const makeRaw = (e: RawEventInput) => ({
  id: e.id,
  date: e.date,
  time: e.time ?? '7 p.m.',
  locationIndicator: e.locationIndicator ?? 'H',
  noplayText: e.noplayText ?? '',
  gameStateDisplay: e.gameStateDisplay ?? 'SCHEDULED',
  conference: e.conference ?? false,
  sport: { id: 1, title: e.sportTitle ?? "Women's Basketball", shortname: e.sportShortname },
  opponent: e.opponent === null ? null : { id: 1, title: e.opponent ?? 'Opponent U' },
  media: {
    tv: e.tv ?? null,
    preview: e.previewUrl ? { url: e.previewUrl } : null,
  },
});

const mockMonthResponse = (events: ReturnType<typeof makeRaw>[]) => [
  { date: '2026-01-01', events },
];

describe('SportsEventsScraperService', () => {
  let service: SportsEventsScraperService;
  let prisma: MockPrisma;
  let fetchMock: jest.SpyInstance;

  beforeEach(async () => {
    prisma = {
      school: { findFirst: jest.fn().mockResolvedValue({ id: SCHOOL_ID, short_name: 'CSULB' }) },
      building: { findMany: jest.fn().mockResolvedValue(SEEDED_BUILDINGS) },
      campusEvent: { upsert: jest.fn().mockResolvedValue({}) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SportsEventsScraperService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SportsEventsScraperService);
    // First month returns events, all subsequent months return empty.
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve([]) } as Response),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const setMonthlyEvents = (events: ReturnType<typeof makeRaw>[]) => {
    let firstCall = true;
    fetchMock.mockImplementation(() => {
      const body = firstCall ? mockMonthResponse(events) : [];
      firstCall = false;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(body),
      } as Response);
    });
  };

  it('upserts a home women\'s basketball game with namespaced external_id and Pyramid building', async () => {
    setMonthlyEvents([
      makeRaw({
        id: 99001,
        date: '2026-01-15T19:00:00',
        sportShortname: 'wbball',
        sportTitle: "Women's Basketball",
        opponent: 'UC Davis',
        conference: true,
        tv: 'ESPN+',
        previewUrl: '/news/preview/123',
      }),
    ]);

    await service.scrapeAll();

    expect(prisma.campusEvent.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.campusEvent.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ external_id: 'lbsu-sports-99001' });
    expect(args.create).toMatchObject({
      school_id: SCHOOL_ID,
      external_id: 'lbsu-sports-99001',
      event_name: "Women's Basketball vs UC Davis",
      location: 'Pyramid',
      building_id: 'b_pyramid',
      event_url: 'https://longbeachstate.com/news/preview/123',
    });
    expect(args.create.description).toContain('Conference game');
    expect(args.create.description).toContain('ESPN+');
    expect(args.create.start_time).toEqual(new Date('2026-01-15T19:00:00'));
    expect(args.create.end_time).toEqual(
      new Date(new Date('2026-01-15T19:00:00').getTime() + 3 * 60 * 60 * 1000),
    );
  });

  it('skips away, neutral, cancelled, postponed, TBA, and unmapped sport events', async () => {
    setMonthlyEvents([
      makeRaw({ id: 1, date: '2026-01-15T19:00:00', sportShortname: 'wbball', locationIndicator: 'A' }),
      makeRaw({ id: 2, date: '2026-01-15T19:00:00', sportShortname: 'wbball', locationIndicator: 'N' }),
      makeRaw({ id: 3, date: '2026-01-15T19:00:00', sportShortname: 'wbball', gameStateDisplay: 'CANCELLED' }),
      makeRaw({ id: 4, date: '2026-01-15T19:00:00', sportShortname: 'wbball', noplayText: 'Postponed' }),
      makeRaw({ id: 5, date: '2026-01-15T19:00:00', sportShortname: 'wbball', time: '' }), // TBA
      makeRaw({ id: 6, date: '2026-01-15T19:00:00', sportShortname: 'mgolf' }), // off-campus / unmapped
    ]);

    await service.scrapeAll();

    expect(prisma.campusEvent.upsert).not.toHaveBeenCalled();
  });

  it('skips events whose mapped building isn\'t seeded for the school', async () => {
    prisma.building.findMany.mockResolvedValueOnce([
      // Pyramid present, Softball Complex missing
      buildingRow('b_pyramid', 'Pyramid'),
    ]);
    setMonthlyEvents([
      makeRaw({ id: 10, date: '2026-01-15T19:00:00', sportShortname: 'softball', sportTitle: 'Softball' }),
      makeRaw({ id: 11, date: '2026-01-15T19:00:00', sportShortname: 'wbball' }),
    ]);

    await service.scrapeAll();

    expect(prisma.campusEvent.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.campusEvent.upsert.mock.calls[0][0].where).toEqual({
      external_id: 'lbsu-sports-11',
    });
  });

  it('omits opponent suffix when opponent is null', async () => {
    setMonthlyEvents([
      makeRaw({
        id: 20,
        date: '2026-01-15T19:00:00',
        sportShortname: 'track',
        sportTitle: "Track & Field",
        opponent: null,
      }),
    ]);

    await service.scrapeAll();

    expect(prisma.campusEvent.upsert.mock.calls[0][0].create.event_name).toBe('Track & Field');
  });

  it('uses absolute event_url when API returns a fully-qualified preview URL', async () => {
    setMonthlyEvents([
      makeRaw({
        id: 30,
        date: '2026-01-15T19:00:00',
        sportShortname: 'wbball',
        previewUrl: 'https://example.com/preview',
      }),
    ]);

    await service.scrapeAll();

    expect(prisma.campusEvent.upsert.mock.calls[0][0].create.event_url).toBe(
      'https://example.com/preview',
    );
  });

  it('throws when the Sidearm endpoint returns a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: () => Promise.resolve([]),
    } as unknown as Response);

    await expect(service.scrapeAll()).rejects.toThrow(/Sidearm sports calendar fetch failed/);
  });

  it('skips schools with no row in the database', async () => {
    prisma.school.findFirst.mockResolvedValueOnce(null);

    await service.scrapeAll();

    expect(prisma.campusEvent.upsert).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
