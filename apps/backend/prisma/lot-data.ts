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
// Helpers
// ────────────────────────────────────────────────────────────

/** Fallback: crude rectangle from center + radius (for lots without traced polygons). */
export function generateGeofence(centerLat: number, centerLng: number, radiusMeters = 50) {
  const latOffset = radiusMeters / 111000;
  const lngOffset = radiusMeters / (111000 * Math.cos((centerLat * Math.PI) / 180));
  return [
    { lat: centerLat + latOffset, lng: centerLng - lngOffset },
    { lat: centerLat + latOffset, lng: centerLng + lngOffset },
    { lat: centerLat - latOffset, lng: centerLng + lngOffset },
    { lat: centerLat - latOffset, lng: centerLng - lngOffset },
    { lat: centerLat + latOffset, lng: centerLng - lngOffset },
  ];
}

// ────────────────────────────────────────────────────────────
// Satellite-traced geofence polygons (from geojson.io)
//
// Each polygon is a closed ring of { lat, lng } vertices.
// Lots without an entry here fall back to generateGeofence().
// ────────────────────────────────────────────────────────────

export const GEOFENCE_POLYGONS: Record<string, Array<{ lat: number; lng: number }>> = {
  G1: [
    { lat: 33.78202075900130, lng: -118.12034261735033 },
    { lat: 33.78151477666081, lng: -118.12032382829446 },
    { lat: 33.78152727008755, lng: -118.11818187592166 },
    { lat: 33.78200826564564, lng: -118.11819314935542 },
    { lat: 33.78202075900130, lng: -118.12034261735033 },
  ],
  G2: [
    { lat: 33.78454133866134, lng: -118.12081870145818 },
    { lat: 33.78358932682808, lng: -118.12150216253679 },
    { lat: 33.78322640240332, lng: -118.12070162710677 },
    { lat: 33.78419945717636, lng: -118.12004664357343 },
    { lat: 33.78454133866134, lng: -118.12081870145818 },
  ],
  G3: [
    { lat: 33.78340895653857, lng: -118.11770131730690 },
    { lat: 33.78287508779322, lng: -118.11805570453290 },
    { lat: 33.78241222352740, lng: -118.11704949794533 },
    { lat: 33.78290927653174, lng: -118.11662233477121 },
    { lat: 33.78340895653857, lng: -118.11770131730690 },
  ],
  G4: [
    { lat: 33.78505769290346, lng: -118.11906203190196 },
    { lat: 33.78451010916005, lng: -118.11943380632346 },
    { lat: 33.78358703149466, lng: -118.11784317652041 },
    { lat: 33.78424413864964, lng: -118.11733492794410 },
    { lat: 33.78505769290346, lng: -118.11906203190196 },
  ],
  G5: [
    { lat: 33.78521974397160, lng: -118.11647012738544 },
    { lat: 33.78469400522783, lng: -118.11684599553902 },
    { lat: 33.78444256381827, lng: -118.11679404628242 },
    { lat: 33.78444764344948, lng: -118.11613092929544 },
    { lat: 33.78513847056044, lng: -118.11614620848890 },
    { lat: 33.78521974397160, lng: -118.11647012738544 },
  ],
  G6: [
    { lat: 33.78533098499976, lng: -118.11887680328346 },
    { lat: 33.78443772119489, lng: -118.11714730978560 },
    { lat: 33.78560820290684, lng: -118.11634021282032 },
    { lat: 33.78610103252609, lng: -118.11634433066186 },
    { lat: 33.78610103252609, lng: -118.11861737925864 },
    { lat: 33.78567665163457, lng: -118.11862973278355 },
    { lat: 33.78533098499976, lng: -118.11887680328346 },
  ],
  G7: [
    { lat: 33.78696419651692, lng: -118.11897987677796 },
    { lat: 33.78636556429237, lng: -118.11898383434396 },
    { lat: 33.78619452574552, lng: -118.11884531954010 },
    { lat: 33.78620439336376, lng: -118.11634413793877 },
    { lat: 33.78696748569358, lng: -118.11634018037307 },
    { lat: 33.78696419651692, lng: -118.11897987677796 },
  ],
  G8: [
    { lat: 33.78771083635056, lng: -118.11899570453014 },
    { lat: 33.78702011251185, lng: -118.11899570453014 },
    { lat: 33.78702669086066, lng: -118.11632434759844 },
    { lat: 33.78771741464631, lng: -118.11632434759844 },
    { lat: 33.78771083635056, lng: -118.11899570453014 },
  ],
  G9: [
    { lat: 33.78839497637425, lng: -118.11793507688910 },
    { lat: 33.78779306500752, lng: -118.11793507688910 },
    { lat: 33.78777661928264, lng: -118.11633226273014 },
    { lat: 33.78840155461744, lng: -118.11632830516415 },
    { lat: 33.78839497637425, lng: -118.11793507688910 },
  ],
  G11: [
    { lat: 33.78842134709223, lng: -118.11608971554983 },
    { lat: 33.78701819179551, lng: -118.11614111589208 },
    { lat: 33.78700833347979, lng: -118.11532266428745 },
    { lat: 33.78841148893808, lng: -118.11530289492501 },
    { lat: 33.78842134709223, lng: -118.11608971554983 },
  ],
  G12: [
    { lat: 33.78845550474861, lng: -118.11120401577780 },
    { lat: 33.78703263338791, lng: -118.11118820028774 },
    { lat: 33.78703591949233, lng: -118.10998226917954 },
    { lat: 33.78752226153529, lng: -118.10999017692427 },
    { lat: 33.78753540587708, lng: -118.11007716211903 },
    { lat: 33.78845879079843, lng: -118.11006925437430 },
    { lat: 33.78845550474861, lng: -118.11120401577780 },
  ],
  G13: [
    { lat: 33.78797991276740, lng: -118.10978372651019 },
    { lat: 33.78796595848895, lng: -118.10887286321072 },
    { lat: 33.78684612023358, lng: -118.10886866568381 },
    { lat: 33.78685309746409, lng: -118.10822224656800 },
    { lat: 33.78810201260615, lng: -118.10822644409490 },
    { lat: 33.78811945542635, lng: -118.10980051661721 },
    { lat: 33.78797991276740, lng: -118.10978372651019 },
  ],
  G14: [
    { lat: 33.78660005047556, lng: -118.10895331029832 },
    { lat: 33.78562771656864, lng: -118.10893364796236 },
    { lat: 33.78562771656864, lng: -118.10822252680850 },
    { lat: 33.78660550431810, lng: -118.10823181230246 },
    { lat: 33.78660005047556, lng: -118.10895331029832 },
  ],
  E1: [
    { lat: 33.78433443260582, lng: -118.11706498846758 },
    { lat: 33.78348716603142, lng: -118.11763243893160 },
    { lat: 33.78280266868769, lng: -118.11618619350165 },
    { lat: 33.78360820462643, lng: -118.11556852618247 },
    { lat: 33.78433443260582, lng: -118.11706498846758 },
  ],
  E2: [
    { lat: 33.78335426353581, lng: -118.11545215817699 },
    { lat: 33.78324218999232, lng: -118.11552332483522 },
    { lat: 33.78315813473868, lng: -118.11532106170154 },
    { lat: 33.78309275837405, lng: -118.11537350029181 },
    { lat: 33.78261333016947, lng: -118.11441462321389 },
    { lat: 33.78239540737070, lng: -118.11455695653007 },
    { lat: 33.78209342771878, lng: -118.11400635133302 },
    { lat: 33.78223040831172, lng: -118.11360557067937 },
    { lat: 33.78239229418371, lng: -118.11351193033974 },
    { lat: 33.78335426353581, lng: -118.11545215817699 },
  ],
  E3: [
    { lat: 33.78373554382846, lng: -118.11332379044540 },
    { lat: 33.78357933957585, lng: -118.11332147021002 },
    { lat: 33.78355812663087, lng: -118.11251634856798 },
    { lat: 33.78362755079571, lng: -118.11251402833258 },
    { lat: 33.78362369389897, lng: -118.11192700880690 },
    { lat: 33.78374325761170, lng: -118.11192932904228 },
    { lat: 33.78373554382846, lng: -118.11332379044540 },
  ],
  E4: [
    { lat: 33.78476631376736, lng: -118.11192197636444 },
    { lat: 33.78378666948690, lng: -118.11192661683520 },
    { lat: 33.78376931348365, lng: -118.11160410413109 },
    { lat: 33.78477402745773, lng: -118.11160178389606 },
    { lat: 33.78476631376736, lng: -118.11192197636444 },
  ],
  E5: [
    { lat: 33.78460728462029, lng: -118.10966997778775 },
    { lat: 33.78441637021579, lng: -118.10967693849356 },
    { lat: 33.78442215550729, lng: -118.10831031991367 },
    { lat: 33.78461114147217, lng: -118.10831496038409 },
    { lat: 33.78460728462029, lng: -118.10966997778775 },
  ],
  E6: [
    { lat: 33.78326399978023, lng: -118.10865905446988 },
    { lat: 33.78163207031581, lng: -118.10867154062687 },
    { lat: 33.78163207031581, lng: -118.10824388975263 },
    { lat: 33.78327956652589, lng: -118.10825637590918 },
    { lat: 33.78326399978023, lng: -118.10865905446988 },
  ],
  E7: [
    { lat: 33.77888407643007, lng: -118.11199908684927 },
    { lat: 33.77842817097795, lng: -118.11213699446357 },
    { lat: 33.77829791183130, lng: -118.11156342415860 },
    { lat: 33.77880592138168, lng: -118.11156028989495 },
    { lat: 33.77888407643007, lng: -118.11199908684927 },
  ],
  E8: [
    { lat: 33.77614268399151, lng: -118.11317508566200 },
    { lat: 33.77607274039002, lng: -118.11327606096057 },
    { lat: 33.77566939784252, lng: -118.11339106060636 },
    { lat: 33.77544324541016, lng: -118.11319471974787 },
    { lat: 33.77543625099516, lng: -118.11238130761987 },
    { lat: 33.77560877972331, lng: -118.11238691735850 },
    { lat: 33.77559479092054, lng: -118.11157070036097 },
    { lat: 33.77622195333717, lng: -118.11158191983867 },
    { lat: 33.77620796463452, lng: -118.11175021200310 },
    { lat: 33.77611936946380, lng: -118.11177265095851 },
    { lat: 33.77614268399151, lng: -118.11317508566200 },
  ],
  E9: [
    { lat: 33.77693245672096, lng: -118.11509204414092 },
    { lat: 33.77676948232120, lng: -118.11516250646002 },
    { lat: 33.77600553569150, lng: -118.11516863361800 },
    { lat: 33.77587057107887, lng: -118.11454059990749 },
    { lat: 33.77587057107887, lng: -118.11419747905128 },
    { lat: 33.77604627968405, lng: -118.11420973336723 },
    { lat: 33.77604118668585, lng: -118.11454059990749 },
    { lat: 33.77664725131815, lng: -118.11457123569822 },
    { lat: 33.77666507668366, lng: -118.11476117760111 },
    { lat: 33.77688152725449, lng: -118.11476424117987 },
    { lat: 33.77693245672096, lng: -118.11509204414092 },
  ],
  E10: [
    { lat: 33.78016392451447, lng: -118.11519347231416 },
    { lat: 33.77887131670505, lng: -118.11517941982869 },
    { lat: 33.77901537335970, lng: -118.11470631948217 },
    { lat: 33.77926876133316, lng: -118.11463061828456 },
    { lat: 33.77972451768125, lng: -118.11462857230647 },
    { lat: 33.77975852925127, lng: -118.11476156089662 },
    { lat: 33.78016034434424, lng: -118.11477143780687 },
    { lat: 33.78016392451447, lng: -118.11519347231416 },
  ],
  E11: [
    { lat: 33.78050984507401, lng: -118.11516657613134 },
    { lat: 33.78047878352112, lng: -118.11478165785280 },
    { lat: 33.78082045997894, lng: -118.11474055007560 },
    { lat: 33.78082045997894, lng: -118.11454248533022 },
    { lat: 33.78110622469640, lng: -118.11452753704773 },
    { lat: 33.78111554309545, lng: -118.11468075694484 },
    { lat: 33.78124600056950, lng: -118.11464712330903 },
    { lat: 33.78141683743851, lng: -118.11489376997270 },
    { lat: 33.78122736379966, lng: -118.11504325279924 },
    { lat: 33.78091675037042, lng: -118.11512173128332 },
    { lat: 33.78050984507401, lng: -118.11516657613134 },
  ],
  PVN: [
    { lat: 33.78792929891017, lng: -118.10982275625805 },
    { lat: 33.78686136315817, lng: -118.10983746949540 },
    { lat: 33.78687359150499, lng: -118.10890072672392 },
    { lat: 33.78793337497517, lng: -118.10890563113648 },
    { lat: 33.78792929891017, lng: -118.10982275625805 },
  ],
  PVS: [
    { lat: 33.78665947521034, lng: -118.10991137489596 },
    { lat: 33.78559034275072, lng: -118.10989957327328 },
    { lat: 33.78557072551654, lng: -118.10893774103087 },
    { lat: 33.78664966671659, lng: -118.10894364184242 },
    { lat: 33.78665947521034, lng: -118.10991137489596 },
  ],
  PYR: [
    { lat: 33.78687000783391, lng: -118.11613393783269 },
    { lat: 33.78478568273518, lng: -118.11613393783269 },
    { lat: 33.78474644789363, lng: -118.11531372506167 },
    { lat: 33.78688962477048, lng: -118.11528422100517 },
    { lat: 33.78687000783391, lng: -118.11613393783269 },
  ],
};

// ────────────────────────────────────────────────────────────
// Parking Lot Data (28 CSULB lots)
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
  geofence_radius: number;
  permit_types: string[];
  daily_permit_allowed: boolean;
  daily_rate?: number;
  hours_weekday: object;
  hours_saturday: object | string;
  hours_sunday: object | string;
  ev_charging_stations: number;
  motorcycle_spaces: number;
  accessible_spaces: number;
  has_lighting: boolean;
  has_cameras: boolean;
  has_emergency_phone: boolean;
  is_covered: boolean;
  is_paved: boolean;
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
    center_lat: 33.7817, center_lng: -118.1193, geofence_radius: 50,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 4, accessible_spaces: 8,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.15,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G2', lot_name: 'Lot G2', display_name: 'Lot G2 - Walter Pyramid', lot_number: 'G2',
    lot_type: LotType.STUDENT, capacity: 419, current_occupancy: 55,
    location_description: 'East Campus - Walter Pyramid',
    center_lat: 33.7839, center_lng: -118.1208, geofence_radius: 70,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '06:00', close: '23:00' },
    hours_saturday: { open: '06:00', close: '23:00' },
    hours_sunday: { open: '08:00', close: '22:00' },
    ev_charging_stations: 0, motorcycle_spaces: 8, accessible_spaces: 12,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.18,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G3', lot_name: 'Lot G3', display_name: 'Lot G3 - East Campus', lot_number: 'G3',
    lot_type: LotType.STUDENT, capacity: 230, current_occupancy: 21,
    location_description: 'East Campus',
    center_lat: 33.7829, center_lng: -118.1173, geofence_radius: 60,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 6, accessible_spaces: 9,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.12,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G4', lot_name: 'Lot G4', display_name: 'Lot G4 - Central Campus', lot_number: 'G4',
    lot_type: LotType.STUDENT, capacity: 463, current_occupancy: 66,
    location_description: 'Central Campus',
    center_lat: 33.7844, center_lng: -118.1184, geofence_radius: 80,
    permit_types: ['Gold', 'Green', 'Daily'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 15, accessible_spaces: 7,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G5', lot_name: 'Lot G5', display_name: 'Lot G5 - West Campus', lot_number: 'G5',
    lot_type: LotType.STUDENT, capacity: 120, current_occupancy: 8,
    location_description: 'West Campus',
    center_lat: 33.7848, center_lng: -118.1164, geofence_radius: 55,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 7,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.10,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G7', lot_name: 'Lot G7', display_name: 'Lot G7 - Engineering', lot_number: 'G7',
    lot_type: LotType.STUDENT, capacity: 751, current_occupancy: 98,
    location_description: 'East Campus - Engineering Complex',
    center_lat: 33.7867, center_lng: -118.1176, geofence_radius: 65,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '20:00' },
    hours_sunday: { open: '10:00', close: '18:00' },
    ev_charging_stations: 31, motorcycle_spaces: 7, accessible_spaces: 4,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.16,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G8', lot_name: 'Lot G8', display_name: 'Lot G8 - Student Health', lot_number: 'G8',
    lot_type: LotType.STUDENT, capacity: 720, current_occupancy: 77,
    location_description: 'West Campus - Student Health Center',
    center_lat: 33.7873, center_lng: -118.1176, geofence_radius: 60,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 2, motorcycle_spaces: 6, accessible_spaces: 9,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.14,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G9', lot_name: 'Lot G9', display_name: 'Lot G9 - Library', lot_number: 'G9',
    lot_type: LotType.STUDENT, capacity: 405, current_occupancy: 66,
    location_description: 'West Campus - University Library',
    center_lat: 33.7880, center_lng: -118.1176, geofence_radius: 70,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '06:00', close: '23:00' },
    hours_saturday: { open: '07:00', close: '23:00' },
    hours_sunday: { open: '09:00', close: '22:00' },
    ev_charging_stations: 0, motorcycle_spaces: 8, accessible_spaces: 4,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.19,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'G10', lot_name: 'Lot G10', display_name: 'Lot G10 - South Campus', lot_number: 'G10',
    lot_type: LotType.STUDENT, capacity: 19, current_occupancy: 2,
    location_description: 'South Campus',
    center_lat: 33.7880, center_lng: -118.1201, geofence_radius: 55,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 3,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.11,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G11', lot_name: 'Lot G11', display_name: 'Lot G11 - Palo Verde', lot_number: 'G11',
    lot_type: LotType.STUDENT, capacity: 319, current_occupancy: 21,
    location_description: 'East Campus - Palo Verde',
    center_lat: 33.7877, center_lng: -118.1157, geofence_radius: 50,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 4, accessible_spaces: 34,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.09,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'G12', lot_name: 'Lot G12', display_name: 'Lot G12 - North Campus', lot_number: 'G12',
    lot_type: LotType.STUDENT, capacity: 628, current_occupancy: 36,
    location_description: 'North Campus',
    center_lat: 33.7878, center_lng: -118.1106, geofence_radius: 45,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 14, motorcycle_spaces: 3, accessible_spaces: 19,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.08,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'G14', lot_name: 'Lot G14', display_name: 'Lot G14 - Beachside', lot_number: 'G14',
    lot_type: LotType.STUDENT, capacity: 262, current_occupancy: 26,
    location_description: 'West Campus - Near PCH',
    center_lat: 33.7861, center_lng: -118.1086, geofence_radius: 60,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 8.00,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '07:00', close: '22:00' },
    hours_sunday: { open: '08:00', close: '20:00' },
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 8,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.13,
    avg_turnover_minutes: 240, confidence: ConfidenceLevel.MEDIUM,
  },
  // ===== EMPLOYEE LOTS =====
  {
    lot_id: 'E1', lot_name: 'Lot E1', display_name: 'Lot E1 - Faculty/Staff', lot_number: 'E1',
    lot_type: LotType.EMPLOYEE, capacity: 440, current_occupancy: 79,
    location_description: 'Central Campus - Admin Area',
    center_lat: 33.7835, center_lng: -118.1166, geofence_radius: 40,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 12,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.22,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E2', lot_name: 'Lot E2', display_name: 'Lot E2 - Faculty/Staff', lot_number: 'E2',
    lot_type: LotType.EMPLOYEE, capacity: 269, current_occupancy: 55,
    location_description: 'East Campus - Faculty',
    center_lat: 33.7825, center_lng: -118.1140, geofence_radius: 35,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 21,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.25,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E3', lot_name: 'Lot E3', display_name: 'Lot E3 - Faculty/Staff', lot_number: 'E3',
    lot_type: LotType.EMPLOYEE, capacity: 65, current_occupancy: 10,
    location_description: 'West Campus - Faculty',
    center_lat: 33.7837, center_lng: -118.1126, geofence_radius: 45,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 3, accessible_spaces: 3,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E4', lot_name: 'Lot E4', display_name: 'Lot E4 - Faculty/Staff', lot_number: 'E4',
    lot_type: LotType.EMPLOYEE, capacity: 81, current_occupancy: 20,
    location_description: 'Central Campus - Faculty',
    center_lat: 33.7843, center_lng: -118.1118, geofence_radius: 60,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '08:00', close: '22:00' },
    hours_sunday: { open: '08:00', close: '20:00' },
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 4,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: false, is_paved: true, penetration_rate: 0.30,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.HIGH,
  },
  {
    lot_id: 'E5', lot_name: 'Lot E5', display_name: 'Lot E5 - Faculty/Staff', lot_number: 'E5',
    lot_type: LotType.EMPLOYEE, capacity: 66, current_occupancy: 15,
    location_description: 'North Campus - Faculty',
    center_lat: 33.7845, center_lng: -118.1092, geofence_radius: 30,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 4,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.28,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'E6', lot_name: 'Lot E6', display_name: 'Lot E6 - Faculty/Staff', lot_number: 'E6',
    lot_type: LotType.EMPLOYEE, capacity: 240, current_occupancy: 35,
    location_description: 'Central Campus - Faculty',
    center_lat: 33.7825, center_lng: -118.1084, geofence_radius: 40,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 14,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.18,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'E7', lot_name: 'Lot E7', display_name: 'Lot E7 - Faculty/Staff', lot_number: 'E7',
    lot_type: LotType.EMPLOYEE, capacity: 91, current_occupancy: 11,
    location_description: 'South Campus - Faculty',
    center_lat: 33.7786, center_lng: -118.1118, geofence_radius: 30,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 8,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.15,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  // ===== ADDITIONAL STUDENT LOTS =====
  {
    lot_id: 'G6', lot_name: 'Lot G6', display_name: 'Lot G6 - South Campus', lot_number: 'G6',
    lot_type: LotType.STUDENT, capacity: 793, current_occupancy: 66,
    location_description: 'South Campus',
    center_lat: 33.7854, center_lng: -118.1176, geofence_radius: 55,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 5, accessible_spaces: 7,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.11,
    avg_turnover_minutes: 300, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'G13', lot_name: 'Lot G13', display_name: 'Lot G13 - Upper Campus', lot_number: 'G13',
    lot_type: LotType.STUDENT, capacity: 304, current_occupancy: 18,
    location_description: 'Upper Campus',
    center_lat: 33.7874, center_lng: -118.1086, geofence_radius: 50,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 3, accessible_spaces: 5,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.08,
    avg_turnover_minutes: 360, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E8', lot_name: 'Lot E8', display_name: 'Lot E8 - Faculty/Staff', lot_number: 'E8',
    lot_type: LotType.EMPLOYEE, capacity: 380, current_occupancy: 57,
    location_description: 'North Campus - Faculty',
    center_lat: 33.7759, center_lng: -118.1121, geofence_radius: 25,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '22:00' },
    hours_saturday: { open: '08:00', close: '18:00' }, hours_sunday: 'CLOSED',
    ev_charging_stations: 13, motorcycle_spaces: 1, accessible_spaces: 7,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.20,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E9', lot_name: 'Lot E9', display_name: 'Lot E9 - Faculty/Staff', lot_number: 'E9',
    lot_type: LotType.EMPLOYEE, capacity: 167, current_occupancy: 4,
    location_description: 'North Campus - Faculty',
    center_lat: 33.7764, center_lng: -118.1150, geofence_radius: 32,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '18:00' },
    hours_saturday: 'CLOSED', hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 13,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.03,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E10', lot_name: 'Lot E10', display_name: 'Lot E10 - Faculty/Staff', lot_number: 'E10',
    lot_type: LotType.EMPLOYEE, capacity: 183, current_occupancy: 5,
    location_description: 'South Campus - Faculty',
    center_lat: 33.7796, center_lng: -118.1150, geofence_radius: 35,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '18:00' },
    hours_saturday: 'CLOSED', hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 1, accessible_spaces: 22,
    has_lighting: true, has_cameras: false, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.04,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.LOW,
  },
  {
    lot_id: 'E11', lot_name: 'Lot E11', display_name: 'Lot E11 - Faculty/Staff', lot_number: 'E11',
    lot_type: LotType.EMPLOYEE, capacity: 98, current_occupancy: 4,
    location_description: 'Central Campus - Faculty',
    center_lat: 33.7809, center_lng: -118.1149, geofence_radius: 40,
    permit_types: ['Faculty', 'Staff'], daily_permit_allowed: false,
    hours_weekday: { open: '06:00', close: '18:00' },
    hours_saturday: 'CLOSED', hours_sunday: 'CLOSED',
    ev_charging_stations: 0, motorcycle_spaces: 2, accessible_spaces: 5,
    has_lighting: true, has_cameras: true, has_emergency_phone: false,
    is_covered: false, is_paved: true, penetration_rate: 0.05,
    avg_turnover_minutes: 480, confidence: ConfidenceLevel.MEDIUM,
  },
  // ===== NAMED LOTS =====
  {
    lot_id: 'PVN', lot_name: 'Palo Verde North', display_name: 'Palo Verde North - North Campus', lot_number: 'PVN',
    lot_type: LotType.STUDENT, capacity: 1400, current_occupancy: 91,
    location_description: 'North Campus - Palo Verde Structure',
    center_lat: 33.7874, center_lng: -118.1094, geofence_radius: 50,
    permit_types: ['Gold', 'Green', 'Resident'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 0, motorcycle_spaces: 3, accessible_spaces: 32,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, levels: 5, penetration_rate: 0.10,
    avg_turnover_minutes: 720, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'PVS', lot_name: 'Palo Verde South', display_name: 'Palo Verde South - South Campus', lot_number: 'PVS',
    lot_type: LotType.STUDENT, capacity: 1410, current_occupancy: 82,
    location_description: 'South Campus - Palo Verde Structure',
    center_lat: 33.7861, center_lng: -118.1094, geofence_radius: 48,
    permit_types: ['Gold', 'Green', 'Resident'], daily_permit_allowed: false,
    hours_weekday: { open: '00:00', close: '23:59' },
    hours_saturday: { open: '00:00', close: '23:59' },
    hours_sunday: { open: '00:00', close: '23:59' },
    ev_charging_stations: 2, motorcycle_spaces: 2, accessible_spaces: 10,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, levels: 5, penetration_rate: 0.09,
    avg_turnover_minutes: 720, confidence: ConfidenceLevel.MEDIUM,
  },
  {
    lot_id: 'PYR', lot_name: 'Pyramid Parking Structure', display_name: 'Pyramid Structure - Event Parking', lot_number: 'PYR',
    lot_type: LotType.STUDENT, capacity: 3000, current_occupancy: 380,
    location_description: 'East Campus - Near Walter Pyramid',
    center_lat: 33.7861, center_lng: -118.1157, geofence_radius: 65,
    permit_types: ['Gold', 'Green'], daily_permit_allowed: true, daily_rate: 10.00,
    hours_weekday: { open: '06:00', close: '23:00' },
    hours_saturday: { open: '06:00', close: '23:00' },
    hours_sunday: { open: '10:00', close: '22:00' },
    ev_charging_stations: 2, motorcycle_spaces: 6, accessible_spaces: 7,
    has_lighting: true, has_cameras: true, has_emergency_phone: true,
    is_covered: true, is_paved: true, levels: 5, penetration_rate: 0.16,
    avg_turnover_minutes: 180, confidence: ConfidenceLevel.HIGH,
  },
];
