/**
 * Shared Lot Data
 *
 * Source-of-truth for the School + 28 CSULB parking lots, including
 * satellite-traced geofence polygons. Imported by both:
 *   - seed.ts       (full dev seed: lots + fake users/events/snapshots)
 *   - seed-prod.ts  (idempotent production seed: school + lots only)
 *
 * Updating lot definitions or geofences? Edit this file, then:
 *   - dev:   pnpm db:seed
 *   - prod:  pnpm db:seed:prod  (safe: upsert, never deletes)
 */

import { LotType, ConfidenceLevel } from '@prisma/client';

// ────────────────────────────────────────────────────────────
// School
// ────────────────────────────────────────────────────────────

export const CSULB_SCHOOL = {
  school_name: 'California State University, Long Beach',
  short_name: 'CSULB',
  timezone: 'America/Los_Angeles',
} as const;

// ────────────────────────────────────────────────────────────
// Campus Buildings
//
// Each entry has a canonical `name` (stored as CampusEvent.building.name)
// `alternate_names` — aliases & substrings that the events scraper compares against
// ────────────────────────────────────────────────────────────

export interface BuildingSeed {
  name: string;
  alternate_names: string[];
  /** Approximate centerpoint (degrees, WGS84). Sourced from CSULB's concept3d campus map. */
  lat: number;
  lng: number;
}

// `alternate_names` are used ONLY for matching scraped event location strings to buildings
// A given entry doesn't necessarily have to be a physical building — entries represent campus POIs
// Parking structures are intentionally omitted, as they would appear under lot amenities in frontend
// 
// Buildings are currently only used to inform users of potential parking surges due to events
// - minor locations could potentially be removed
// - clusters of building (e.g. Vivian Engineering Center + Engineering 2/3/4) could potentially be consolidated into one entry
export const CSULB_BUILDINGS = [
  // ──────────────────── BUILDINGS ─────────────────────────
  { name: 'Anna W. Ngai Alumni Center',                         alternate_names: ['ANAC'], lat: 33.781891, lng: -118.116859 },
  { name: 'Academic Services',                                  alternate_names: ['AS'], lat: 33.776985, lng: -118.114067 },
  { name: 'Barrett Athletic Administration Building',           alternate_names: ['BAC'], lat: 33.786331, lng: -118.114876 },
  { name: 'Beach Building Services',                            alternate_names: ['BBS'], lat: 33.783669, lng: -118.108528 },
  { name: 'Bookstore',                                          alternate_names: ['BKS'], lat: 33.779987, lng: -118.113739 },
  { name: 'Brotman Hall',                                       alternate_names: ['BH', 'Brotman Hall'], lat: 33.782730, lng: -118.115234 },
  { name: 'BBS Collection Area',                                alternate_names: ['CA'], lat: 33.783670, lng: -118.108530 },
  { name: 'Cafeteria',                                          alternate_names: ['CAFÉ'], lat: 33.780160, lng: -118.113340 },
  { name: 'Coastal Coffee',                                     alternate_names: ['CC'], lat: 33.784607, lng: -118.115395 },
  { name: 'College of Business',                                alternate_names: ['COB'], lat: 33.784107, lng: -118.115868 },
  { name: 'Child Development Center',                           alternate_names: ['CDC'], lat: 33.788242, lng: -118.120529 },
  { name: 'Cinematic Arts',                                     alternate_names: ['CINE'], lat: 33.776752, lng: -118.111794 },
  { name: 'College of Liberal Arts Administration',             alternate_names: ['CLA'], lat: 33.777824, lng: -118.114151 },
  { name: 'College of Professional and Continuing Education',   alternate_names: ['CPCE', 'CPACE'], lat: 33.781998, lng: -118.111404 },
  { name: 'Carpenter Performing Arts Center',                   alternate_names: ['CPAC', 'Carpenter Center'], lat: 33.788181, lng: -118.111824 },
  { name: 'Central Plant',                                      alternate_names: ['CP'], lat: 33.781380, lng: -118.112358 },
  { name: 'Corporation Yard',                                   alternate_names: ['CORP'], lat: 33.783859, lng: -118.109146 },
  { name: 'Dance Center',                                       alternate_names: ['DC'], lat: 33.788376, lng: -118.112633 },
  { name: 'Design',                                             alternate_names: ['DESN'], lat: 33.782063, lng: -118.109306 },
  { name: 'Education 2',                                        alternate_names: ['ED2'], lat: 33.775810, lng: -118.114342 },
  { name: 'Bob and Barbara Ellis Education Building',           alternate_names: ['EED'], lat: 33.776421, lng: -118.114174 },
  { name: 'Engineering 2',                                      alternate_names: ['EN2'], lat: 33.783333, lng: -118.110748 },
  { name: 'Engineering 3',                                      alternate_names: ['EN3'], lat: 33.783699, lng: -118.111183 },
  { name: 'Engineering 4',                                      alternate_names: ['EN4'], lat: 33.783699, lng: -118.110687 },
  { name: 'Engineering and Computer Science',                   alternate_names: ['ECS'], lat: 33.783573, lng: -118.110245 },
  { name: 'Engineering Technology',                             alternate_names: ['ET'], lat: 33.782936, lng: -118.108940 },
  { name: 'Faculty Office 2',                                   alternate_names: ['FO2'], lat: 33.778576, lng: -118.113914 },
  { name: 'Faculty Office 3',                                   alternate_names: ['FO3'], lat: 33.779182, lng: -118.113708 },
  { name: 'Faculty Office 4',                                   alternate_names: ['FO4'], lat: 33.778282, lng: -118.111977 },
  { name: 'Faculty Office 5',                                   alternate_names: ['FO5'], lat: 33.779125, lng: -118.112366 },
  { name: 'Family & Consumer Sciences',                         alternate_names: ['FCS', 'Family and Consumer Sciences'], lat: 33.781696, lng: -118.116158 },
  { name: 'Fine Arts 1',                                        alternate_names: ['FA1'], lat: 33.777248, lng: -118.112480 },
  { name: 'Fine Arts 2',                                        alternate_names: ['FA2'], lat: 33.777458, lng: -118.112167 },
  { name: 'Fine Arts 3',                                        alternate_names: ['FA3'], lat: 33.777943, lng: -118.112228 },
  { name: 'Fine Arts 4',                                        alternate_names: ['FA4'], lat: 33.778328, lng: -118.112633 },
  { name: 'Foundation',                                         alternate_names: ['FND'], lat: 33.781342, lng: -118.110344 },
  { name: 'Hall of Science',                                    alternate_names: ['HSCI'], lat: 33.779842, lng: -118.112526 },
  { name: 'Health & Human Services 1',                          alternate_names: ['HHS1'], lat: 33.782448, lng: -118.112518 },
  { name: 'Health & Human Services 2',                          alternate_names: ['HHS2'], lat: 33.782219, lng: -118.112419 },
  { name: 'Horn Center',                                        alternate_names: ['HC'], lat: 33.783367, lng: -118.114082 },
  { name: 'Hillside Gateway',                                   alternate_names: ['HG'], lat: 33.783367, lng: -118.119904 },
  { name: 'Human Services & Design',                            alternate_names: ['HSD'], lat: 33.782749, lng: -118.109550 },
  { name: 'International House',                                alternate_names: ['IH'], lat: 33.781780, lng: -118.120949 },
  { name: 'Japanese Garden',                                    alternate_names: ['JG'], lat: 33.785328, lng: -118.119766 },
  { name: 'Kleefeld Contemporary Art Museum',                   alternate_names: ['KCAM'], lat: 33.783459, lng: -118.114685 },
  { name: 'Kinesiology',                                        alternate_names: ['KIN'], lat: 33.783001, lng: -118.113029 },
  { name: 'Language Arts',                                      alternate_names: ['LAB'], lat: 33.776981, lng: -118.112679 },
  { name: 'Lecture Hall 150-151',                               alternate_names: ['LH'], lat: 33.778233, lng: -118.113960 },
  { name: 'Liberal Arts 1',                                     alternate_names: ['LA1'], lat: 33.777756, lng: -118.114716 },
  { name: 'Liberal Arts 2',                                     alternate_names: ['LA2'], lat: 33.778057, lng: -118.114594 },
  { name: 'Liberal Arts 3',                                     alternate_names: ['LA3'], lat: 33.778343, lng: -118.114494 },
  { name: 'Liberal Arts 4',                                     alternate_names: ['LA4'], lat: 33.778641, lng: -118.114395 },
  { name: 'Liberal Arts 5',                                     alternate_names: ['LA5'], lat: 33.779018, lng: -118.114265 },
  { name: 'Library',                                            alternate_names: ['LIB'], lat: 33.777267, lng: -118.114777 },
  { name: 'Los Alamitos Hall',                                  alternate_names: ['LAH'], lat: 33.783367, lng: -118.118752 },
  { name: 'Los Cerritos Hall',                                  alternate_names: ['LCH'], lat: 33.782467, lng: -118.119087 },
  { name: 'McIntosh Humanities Bldg',                           alternate_names: ['MHB'], lat: 33.776985, lng: -118.113251 },
  { name: 'Microbiology',                                       alternate_names: ['MIC'], lat: 33.779369, lng: -118.111778 },
  { name: 'Molecular & Life Sciences Center',                   alternate_names: ['MLSC'], lat: 33.780270, lng: -118.112274 },
  { name: 'Multimedia Center',                                  alternate_names: ['MMC'], lat: 33.776798, lng: -118.114586 },
  { name: 'Nursing',                                            alternate_names: ['NUR'], lat: 33.781731, lng: -118.117867 },
  { name: 'Outpost',                                            alternate_names: ['OP'], lat: 33.782310, lng: -118.110405 },
  { name: 'Parking & Transportation Services',                  alternate_names: ['PTS'], lat: 33.785969, lng: -118.116425 },
  { name: 'Parkside College',                                   alternate_names: ['PSC'], lat: 33.786922, lng: -118.120071 },
  { name: 'Peterson Hall 1',                                    alternate_names: ['PH', 'Peterson Hall'], lat: 33.778931, lng: -118.112671 }, // Official Acronym is PH1; some events confirmed to not use such
  { name: 'Parkside North',                                     alternate_names: ['PN'], lat: 33.788239, lng: -118.119507 },
  { name: 'Psychology',                                         alternate_names: ['PSY'], lat: 33.779503, lng: -118.114227 },
  { name: 'Pyramid',                                            alternate_names: ['PYR', 'LBS Financial Credit Union Pyramid', 'Walter Pyramid'], lat: 33.787445, lng: -118.114403 },
  { name: 'Reprographics',                                      alternate_names: ['REPR'], lat: 33.784733, lng: -118.109848 },
  { name: 'Social Science/Public Affairs',                      alternate_names: ['SSPA'], lat: 33.782108, lng: -118.110809 },
  { name: 'Student Health Services',                            alternate_names: ['SHS', 'Student Health Center'], lat: 33.782372, lng: -118.117828 },
  { name: 'Student Recreation & Wellness Center',               alternate_names: ['SRWC', 'Student Recreation and Wellness Center'], lat: 33.785229, lng: -118.109070 },
  { name: 'Soccer and Softball Clubhouse',                      alternate_names: ['SSCH'], lat: 33.786694, lng: -118.112061 },
  { name: 'Shakarian Student Success Center',                   alternate_names: ['SSSC'], lat: 33.779392, lng: -118.112579 },
  { name: 'Theatre Arts',                                       alternate_names: ['TA'], lat: 33.776653, lng: -118.112473 },
  { name: 'University Music Center',                            alternate_names: ['UMC', 'Recital Hall', 'Conservatory of Music'], lat: 33.787170, lng: -118.112335 },
  { name: 'University Police Bldg',                             alternate_names: ['UP'], lat: 33.784336, lng: -118.109161 },
  { name: 'University Student Union',                           alternate_names: ['USU'], lat: 33.781700, lng: -118.114632 },
  { name: 'University Theatre',                                 alternate_names: ['UT'], lat: 33.776417, lng: -118.111900 },
  { name: 'Visitor Information Center',                         alternate_names: ['VIC'], lat: 33.781990, lng: -118.119156 },
  { name: 'Vivian Engineering Center',                          alternate_names: ['VEC'], lat: 33.782925, lng: -118.110641 },
  // ──────────────────── OUTDOOR SPACES ─────────────────────────
  { name: 'Speaker Platform',                                   alternate_names: ['Speakers Platform', 'Speaker\'s Platform'], lat: 33.779903, lng: -118.113449 },
  { name: 'Grow Beach',                                         alternate_names: [], lat: 33.781815, lng: -118.112228 },
  { name: 'Central Quad',                                       alternate_names: [], lat: 33.777977, lng: -118.113419 },
  { name: 'Beach Circle',                                       alternate_names: [], lat: 33.784100, lng: -118.115166 },
  { name: 'Jack Rose Track',                                    alternate_names: [], lat: 33.784653, lng: -118.114258 },
  { name: 'George Allen Field',                                 alternate_names: [], lat: 33.786095, lng: -118.110901 },
  { name: 'Rhodes Tennis Center',                               alternate_names: [], lat: 33.784409, lng: -118.110733 },
  // Athletics venues used by SportsEventsScraperService (deterministic sport → venue map).
  // `Pyramid` is already in BUILDINGS above and serves men's/women's basketball + volleyball.
  { name: 'LBSU Softball Complex',                              alternate_names: ['Softball Complex'], lat: 33.786217, lng: -118.112007 },
  { name: 'LBSU Sand Courts',                                   alternate_names: ['Sand Courts', 'Beach Volleyball Courts'], lat: 33.785259, lng: -118.113213 },
  { name: 'Ken Lindgren Aquatics Center',                       alternate_names: ['Aquatics Center', 'Lindgren Aquatics'], lat: 33.783878, lng: -118.112419 },
  // Bohl Diamond at Blair Field is in Recreation Park, ~2.5 mi off CSULB campus.
  // Intentionally NOT referenced from any CSULB_LOTS[].buildings entry: no on-campus lot is
  // within walking distance, so baseball events are stored but won't surface on any lot card.
  { name: 'Bohl Diamond at Blair Field',                        alternate_names: ['Blair Field', 'Bohl Diamond'], lat: 33.777748, lng: -118.138290 },
  // Barnes Tennis Center is in San Diego (~110 mi away). Listed on longbeachstate.com/facilities
  // because women's tennis occasionally plays "home" matches there, but the LBSU calendar API
  // doesn't expose per-match venue, so SportsEventsScraperService maps `wten` to Rhodes Tennis
  // Center as the on-campus default. Seeded here for completeness; intentionally unlinked from
  // any lot for the same reason as Blair Field.
  { name: 'Barnes Tennis Center',                               alternate_names: [], lat: 32.748800, lng: -117.221800 },
] as const satisfies readonly BuildingSeed[];

export type BuildingName = typeof CSULB_BUILDINGS[number]['name'];

// ────────────────────────────────────────────────────────────
// Parking Lot Data (28 CSULB lots)
//
// Hours: per CSULB Parking & Transportation Services
// (https://www.csulb.edu/parking-and-transportation-services), "Parking is
// enforced 24 hours a day, 7 days a week including holidays" and lots remain
// physically accessible at all times. We model that as 00:00–23:59 across
// every lot. Per-lot operational hours are not published; if PTS later
// communicates lot-specific gates / closures, override per row.
// ────────────────────────────────────────────────────────────

export interface LotSeed {
  lot_id: string;
  lot_name: string;
  display_name: string;
  lot_number: string;
  lot_type: LotType;
  capacity: number;
  /** Initial occupancy used by dev seed only. seed-prod.ts always sets 0 on create and never updates. */
  current_occupancy: number;
  location_description: string;
  /**
   * OPTIONAL hand-curated tweaks to the auto-derived nearby-buildings list.
   * Leave undefined for the default (haversine within DEFAULT_LOT_BUILDING_RADIUS_M).
   * See `derive-lot-buildings.ts`.
   */
  building_overrides?: { add?: BuildingName[]; exclude?: BuildingName[] };
  center_lat: number;
  center_lng: number;
  permit_types: string[];
  daily_permit_allowed: boolean;
  daily_rate?: number;
  hours_weekday: object;
  hours_saturday: object | string;
  hours_sunday: object | string;
  ev_charging_stations: number;
  motorcycle_spaces: number;
  accessible_spaces: number;
  /** Designated short-term / visitor spaces. 0 = none. */
  short_term_parking_spaces: number;
  /** Signed low-emission-vehicle spaces (informational, unenforced). 0 = none. */
  low_emission_spaces: number;
  /** Number of pay stations physically located in this lot. */
  pay_stations: number;
  has_lighting: boolean;
  has_cameras: boolean;
  has_emergency_phone: boolean;
  is_covered: boolean;
  is_paved: boolean;
  /** True for multi-level parking structures (PVN/PVS/PYR). */
  is_structure?: boolean;
  levels?: number;
  penetration_rate: number;
  avg_turnover_minutes: number;
  confidence: ConfidenceLevel;
}

export const parkingLots: LotSeed[] = [
  // ===== STUDENT LOTS (G LOTS) =====
  {
    lot_id: 'G1', lot_name: 'Lot G1', display_name: 'Lot G1 - East Campus', lot_number: 'G1',
    lot_type: LotType.STUDENT, capacity: 231, current_occupancy: 27,
    location_description: 'East Campus - Near Japanese Garden',
    center_lat: 33.7817, center_lng: -118.1193,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 4, accessible_spaces: 8,
    short_term_parking_spaces: 19, low_emission_spaces: 32, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.15,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G2', lot_name: 'Lot G2', display_name: 'Lot G2 - Walter Pyramid', lot_number: 'G2',
    lot_type: LotType.STUDENT, capacity: 419, current_occupancy: 55,
    location_description: 'East Campus - Walter Pyramid',
    center_lat: 33.7839, center_lng: -118.1208,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 12,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.18,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G3', lot_name: 'Lot G3', display_name: 'Lot G3 - East Campus', lot_number: 'G3',
    lot_type: LotType.STUDENT, capacity: 230, current_occupancy: 21,
    location_description: 'East Campus',
    center_lat: 33.7829, center_lng: -118.1173,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 9,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 0,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.12,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G4', lot_name: 'Lot G4', display_name: 'Lot G4 - Central Campus', lot_number: 'G4',
    lot_type: LotType.STUDENT, capacity: 463, current_occupancy: 66,
    location_description: 'Central Campus',
    center_lat: 33.7844, center_lng: -118.1184,
    permit_types: ['Gold', 'Green', 'Daily'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 7,
    short_term_parking_spaces: 8, low_emission_spaces: 0, pay_stations: 2,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G5', lot_name: 'Lot G5', display_name: 'Lot G5 - West Campus', lot_number: 'G5',
    lot_type: LotType.STUDENT, capacity: 120, current_occupancy: 8,
    location_description: 'West Campus',
    center_lat: 33.7848, center_lng: -118.1164,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 7,
    short_term_parking_spaces: 4, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.10,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G7', lot_name: 'Lot G7', display_name: 'Lot G7 - Engineering', lot_number: 'G7',
    lot_type: LotType.STUDENT, capacity: 751, current_occupancy: 98,
    location_description: 'East Campus - Engineering Complex',
    center_lat: 33.7867, center_lng: -118.1176,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 31, motorcycle_spaces: 0, accessible_spaces: 4,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 0,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.16,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G8', lot_name: 'Lot G8', display_name: 'Lot G8 - Student Health', lot_number: 'G8',
    lot_type: LotType.STUDENT, capacity: 720, current_occupancy: 77,
    location_description: 'West Campus - Student Health Center',
    center_lat: 33.7873, center_lng: -118.1176,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 2, motorcycle_spaces: 0, accessible_spaces: 9,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.14,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G9', lot_name: 'Lot G9', display_name: 'Lot G9 - Library', lot_number: 'G9',
    lot_type: LotType.STUDENT, capacity: 405, current_occupancy: 66,
    location_description: 'West Campus - University Library',
    center_lat: 33.7880, center_lng: -118.1176,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 4,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 0,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.19,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G10', lot_name: 'Lot G10', display_name: 'Lot G10 - South Campus', lot_number: 'G10',
    lot_type: LotType.STUDENT, capacity: 19, current_occupancy: 2,
    location_description: 'South Campus',
    center_lat: 33.7880, center_lng: -118.1201,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 3,
    short_term_parking_spaces: 6, low_emission_spaces: 0, pay_stations: 0,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.11,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G11', lot_name: 'Lot G11', display_name: 'Lot G11 - Palo Verde', lot_number: 'G11',
    lot_type: LotType.STUDENT, capacity: 319, current_occupancy: 21,
    location_description: 'East Campus - Palo Verde',
    center_lat: 33.7877, center_lng: -118.1157,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 34,
    short_term_parking_spaces: 3, low_emission_spaces: 0, pay_stations: 3,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.09,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'G12', lot_name: 'Lot G12', display_name: 'Lot G12 - North Campus', lot_number: 'G12',
    lot_type: LotType.STUDENT, capacity: 628, current_occupancy: 36,
    location_description: 'North Campus',
    center_lat: 33.7878, center_lng: -118.1106,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 14, motorcycle_spaces: 1, accessible_spaces: 19,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 2,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.08,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'G14', lot_name: 'Lot G14', display_name: 'Lot G14 - Beachside', lot_number: 'G14',
    lot_type: LotType.STUDENT, capacity: 262, current_occupancy: 26,
    location_description: 'West Campus - Near PCH',
    center_lat: 33.7861, center_lng: -118.1086,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 8,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.13,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.MEDIUM,
  },
  // ===== EMPLOYEE LOTS =====
  {
    lot_id: 'E1', lot_name: 'Lot E1', display_name: 'Lot E1 - Faculty/Staff', lot_number: 'E1',
    lot_type: LotType.EMPLOYEE, capacity: 440, current_occupancy: 79,
    location_description: 'Central Campus - Admin Area',
    center_lat: 33.7835, center_lng: -118.1166,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 12,
    short_term_parking_spaces: 16, low_emission_spaces: 0, pay_stations: 3,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.22,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E2', lot_name: 'Lot E2', display_name: 'Lot E2 - Faculty/Staff', lot_number: 'E2',
    lot_type: LotType.EMPLOYEE, capacity: 269, current_occupancy: 55,
    location_description: 'East Campus - Faculty',
    center_lat: 33.7825, center_lng: -118.1140,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 21,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.25,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E3', lot_name: 'Lot E3', display_name: 'Lot E3 - Faculty/Staff', lot_number: 'E3',
    lot_type: LotType.EMPLOYEE, capacity: 65, current_occupancy: 10,
    location_description: 'West Campus - Faculty',
    center_lat: 33.7837, center_lng: -118.1126,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 3,
    short_term_parking_spaces: 0, low_emission_spaces: 1, pay_stations: 0,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E4', lot_name: 'Lot E4', display_name: 'Lot E4 - Faculty/Staff', lot_number: 'E4',
    lot_type: LotType.EMPLOYEE, capacity: 81, current_occupancy: 20,
    location_description: 'Central Campus - Faculty',
    center_lat: 33.7843, center_lng: -118.1118,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 4,
    short_term_parking_spaces: 2, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.30,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E5', lot_name: 'Lot E5', display_name: 'Lot E5 - Faculty/Staff', lot_number: 'E5',
    lot_type: LotType.EMPLOYEE, capacity: 66, current_occupancy: 15,
    location_description: 'North Campus - Faculty',
    center_lat: 33.7845, center_lng: -118.1092,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 4,
    short_term_parking_spaces: 7, low_emission_spaces: 4, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.28,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'E6', lot_name: 'Lot E6', display_name: 'Lot E6 - Faculty/Staff', lot_number: 'E6',
    lot_type: LotType.EMPLOYEE, capacity: 240, current_occupancy: 35,
    location_description: 'Central Campus - Faculty',
    center_lat: 33.7825, center_lng: -118.1084,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 14,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.18,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'E7', lot_name: 'Lot E7', display_name: 'Lot E7 - Faculty/Staff', lot_number: 'E7',
    lot_type: LotType.EMPLOYEE, capacity: 91, current_occupancy: 11,
    location_description: 'South Campus - Faculty',
    center_lat: 33.7786, center_lng: -118.1118,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 8,
    short_term_parking_spaces: 6, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.15,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  // ===== ADDITIONAL STUDENT LOTS =====
  {
    lot_id: 'G6', lot_name: 'Lot G6', display_name: 'Lot G6 - South Campus', lot_number: 'G6',
    lot_type: LotType.STUDENT, capacity: 793, current_occupancy: 66,
    location_description: 'South Campus',
    center_lat: 33.7854, center_lng: -118.1176,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 7,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.11,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G13', lot_name: 'Lot G13', display_name: 'Lot G13 - Upper Campus', lot_number: 'G13',
    lot_type: LotType.STUDENT, capacity: 304, current_occupancy: 18,
    location_description: 'Upper Campus',
    center_lat: 33.7874, center_lng: -118.1086,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 5,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.08,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E8', lot_name: 'Lot E8', display_name: 'Lot E8 - Faculty/Staff', lot_number: 'E8',
    lot_type: LotType.EMPLOYEE, capacity: 380, current_occupancy: 57,
    location_description: 'North Campus - Faculty',
    center_lat: 33.7759, center_lng: -118.1121,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 13, motorcycle_spaces: 1, accessible_spaces: 7,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E9', lot_name: 'Lot E9', display_name: 'Lot E9 - Faculty/Staff', lot_number: 'E9',
    lot_type: LotType.EMPLOYEE, capacity: 167, current_occupancy: 4,
    location_description: 'North Campus - Faculty',
    center_lat: 33.7764, center_lng: -118.1150,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 13,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.03,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E10', lot_name: 'Lot E10', display_name: 'Lot E10 - Faculty/Staff', lot_number: 'E10',
    lot_type: LotType.EMPLOYEE, capacity: 183, current_occupancy: 5,
    location_description: 'South Campus - Faculty',
    center_lat: 33.7796, center_lng: -118.1150,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 22,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.04,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E11', lot_name: 'Lot E11', display_name: 'Lot E11 - Faculty/Staff', lot_number: 'E11',
    lot_type: LotType.EMPLOYEE, capacity: 98, current_occupancy: 4,
    location_description: 'Central Campus - Faculty',
    center_lat: 33.7809, center_lng: -118.1149,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' }, hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 5,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.05,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  // ===== NAMED LOTS =====
  {
    lot_id: 'PVN', lot_name: 'Palo Verde North', display_name: 'Palo Verde North - North Campus', lot_number: 'PVN',
    lot_type: LotType.STUDENT, capacity: 1400, current_occupancy: 91,
    location_description: 'North Campus - Palo Verde Structure',
    center_lat: 33.7874, center_lng: -118.1094,
    permit_types: ['Gold', 'Green', 'Resident'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 0, accessible_spaces: 32,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 2,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, is_structure: true, levels: 5, penetration_rate: 0.10,
    avg_turnover_minutes: 720, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'PVS', lot_name: 'Palo Verde South', display_name: 'Palo Verde South - South Campus', lot_number: 'PVS',
    lot_type: LotType.STUDENT, capacity: 1410, current_occupancy: 82,
    location_description: 'South Campus - Palo Verde Structure',
    center_lat: 33.7861, center_lng: -118.1094,
    permit_types: ['Gold', 'Green', 'Resident'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 2, motorcycle_spaces: 2, accessible_spaces: 10,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 1,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, is_structure: true, levels: 5, penetration_rate: 0.09,
    avg_turnover_minutes: 720, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'PYR', lot_name: 'Pyramid Parking Structure', display_name: 'Pyramid Structure - Event Parking', lot_number: 'PYR',
    lot_type: LotType.STUDENT, capacity: 3000, current_occupancy: 380,
    location_description: 'East Campus - Near Walter Pyramid',
    center_lat: 33.7861, center_lng: -118.1157,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 10.00,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 2, motorcycle_spaces: 2, accessible_spaces: 7,
    short_term_parking_spaces: 0, low_emission_spaces: 0, pay_stations: 2,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, is_structure: true, levels: 5, penetration_rate: 0.16,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
];
