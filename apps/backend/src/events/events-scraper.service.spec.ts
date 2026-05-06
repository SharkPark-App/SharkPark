import { Test, TestingModule } from '@nestjs/testing';
import { EventsScraperService } from './events-scraper.service';
import { PrismaService } from '../database/database.module';

interface MockPrisma {
  school: { findFirst: jest.Mock };
  building: { findMany: jest.Mock };
  campusEvent: { upsert: jest.Mock };
}

const SCHOOL_ID = 'school_csulb';

const building = (id: string, name: string, alternate_names: string[] = []) => ({
  id,
  name,
  alternate_names,
});

const rawEvent = (id: string, location: string) => ({
  id,
  name: 'Test Event',
  startsOn: '2026-06-01T10:00:00Z',
  endsOn: '2026-06-01T12:00:00Z',
  location,
  description: null,
});

describe('EventsScraperService', () => {
  let service: EventsScraperService;
  let prisma: MockPrisma;
  let fetchMock: jest.SpyInstance;

  const setBuildings = (buildings: ReturnType<typeof building>[]) => {
    prisma.building.findMany.mockResolvedValue(buildings);
  };

  const setEvents = (events: ReturnType<typeof rawEvent>[]) => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: events }),
    } as Response);
  };

  beforeEach(async () => {
    prisma = {
      school: {
        findFirst: jest.fn().mockResolvedValue({ id: SCHOOL_ID, short_name: 'CSULB' }),
      },
      building: { findMany: jest.fn().mockResolvedValue([]) },
      campusEvent: { upsert: jest.fn().mockResolvedValue({}) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsScraperService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(EventsScraperService);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: [] }),
    } as Response);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('virtual location filtering', () => {
    it.each([
      ['empty string', ''],
      ['Zoom', 'Zoom'],
      ['Zoom Meeting', 'Zoom Meeting'],
      ['Virtual', 'Virtual'],
      ['Online', 'Online'],
      ['Remote', 'Remote'],
      ['TBD', 'TBD'],
      ['TBA', 'TBA'],
    ])('does not upsert or log UNMATCHED for %s location', async (_, location) => {
      setBuildings([building('b1', 'Library')]);
      setEvents([rawEvent('evt-1', location)]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).not.toHaveBeenCalled();
    });
  });

  describe('full-name matching', () => {
    it('matches a building whose name appears as a substring of the location', async () => {
      setBuildings([building('b1', 'University Student Union')]);
      setEvents([rawEvent('evt-1', 'University Student Union, Room 200')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ building_id: 'b1' }) }),
      );
    });

    it('does not match a short building name embedded inside a word', async () => {
      setBuildings([building('b_us', 'US', [])]);
      setEvents([rawEvent('evt-1', 'Campus Center Room 101')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).not.toHaveBeenCalled();
    });

    it('prefers the longer full name over a shorter prefix', async () => {
      setBuildings([
        building('b_annex', 'Student Union Annex'),
        building('b_union', 'Student Union'),
      ]);
      setEvents([rawEvent('evt-1', 'Student Union Annex Room 2')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ building_id: 'b_annex' }) }),
      );
    });
  });

  describe('alternate-name matching', () => {
    it('matches a short acronym followed by a dash (e.g. SA-113)', async () => {
      setBuildings([building('b_sa', 'Student Affairs', ['SA'])]);
      setEvents([rawEvent('evt-1', 'SA-113')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ building_id: 'b_sa' }) }),
      );
    });

    it('matches a short acronym followed by punctuation (e.g. "SA, Room 101")', async () => {
      setBuildings([building('b_sa', 'Student Affairs', ['SA'])]);
      setEvents([rawEvent('evt-1', 'SA, Room 101')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ building_id: 'b_sa' }) }),
      );
    });

    it('does not match a short acronym embedded inside a longer word', async () => {
      setBuildings([building('b_sa', 'Student Affairs', ['SA'])]);
      setEvents([rawEvent('evt-1', 'Sandpit Conference Room')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).not.toHaveBeenCalled();
    });

    it('prefers the longer alternate name over a shorter one', async () => {
      setBuildings([
        building('b_saa', 'Student Affairs Annex', ['SAA']),
        building('b_sa', 'Student Affairs', ['SA']),
      ]);
      setEvents([rawEvent('evt-1', 'SAA-200')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ building_id: 'b_saa' }) }),
      );
    });

    it('matches a longer alternate name with word boundaries', async () => {
      setBuildings([building('b_horn', 'Horn Center for the Arts', ['Horn Center'])]);
      setEvents([rawEvent('evt-1', 'Horn Center Auditorium')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ building_id: 'b_horn' }) }),
      );
    });
  });

  describe('unmatched locations', () => {
    it('does not upsert events with no building match', async () => {
      setBuildings([building('b1', 'Library')]);
      setEvents([rawEvent('evt-1', 'Unknown Offsite Venue')]);

      await service.scrapeAll();

      expect(prisma.campusEvent.upsert).not.toHaveBeenCalled();
    });
  });
});
