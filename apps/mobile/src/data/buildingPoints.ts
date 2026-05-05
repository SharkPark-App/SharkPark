/**
 * CSULB Campus Building Points
 *
 * Mirrors the centroids in `apps/backend/prisma/lot-data.ts` (CSULB_BUILDINGS).
 * Used by dev-only screens (e.g. GeofenceDebugScreen) to overlay building
 * locations on the map. Production features should fetch building data from
 * the API instead — this file is for offline/dev visualisation only.
 *
 * Keep in sync with the backend list when buildings are added or moved.
 */

export interface BuildingPoint {
  name: string;
  /** Short aliases / acronyms (e.g. "BH", "MHB"). */
  alternateNames: readonly string[];
  lat: number;
  lng: number;
}

export const CSULB_BUILDING_POINTS: readonly BuildingPoint[] = [
  // ── Buildings ─────────────────────────────────────────────
  { name: 'Anna W. Ngai Alumni Center', alternateNames: ['ANAC'], lat: 33.781891, lng: -118.116859 },
  { name: 'Academic Services', alternateNames: ['AS'], lat: 33.776985, lng: -118.114067 },
  { name: 'Barrett Athletic Administration Building', alternateNames: ['BAC'], lat: 33.786331, lng: -118.114876 },
  { name: 'Beach Building Services', alternateNames: ['BBS'], lat: 33.783669, lng: -118.108528 },
  { name: 'Bookstore', alternateNames: ['BKS'], lat: 33.779987, lng: -118.113739 },
  { name: 'Brotman Hall', alternateNames: ['BH'], lat: 33.782730, lng: -118.115234 },
  { name: 'BBS Collection Area', alternateNames: ['CA'], lat: 33.783670, lng: -118.108530 },
  { name: 'Cafeteria', alternateNames: ['CAFÉ'], lat: 33.780160, lng: -118.113340 },
  { name: 'Coastal Coffee', alternateNames: ['CC'], lat: 33.784607, lng: -118.115395 },
  { name: 'College of Business', alternateNames: ['COB'], lat: 33.784107, lng: -118.115868 },
  { name: 'Child Development Center', alternateNames: ['CDC'], lat: 33.788242, lng: -118.120529 },
  { name: 'Cinematic Arts', alternateNames: ['CINE'], lat: 33.776752, lng: -118.111794 },
  { name: 'College of Liberal Arts Administration', alternateNames: ['CLA'], lat: 33.777824, lng: -118.114151 },
  { name: 'College of Professional and Continuing Education', alternateNames: ['CPCE', 'CPACE'], lat: 33.781998, lng: -118.111404 },
  { name: 'Carpenter Performing Arts Center', alternateNames: ['CPAC'], lat: 33.788181, lng: -118.111824 },
  { name: 'Central Plant', alternateNames: ['CP'], lat: 33.781380, lng: -118.112358 },
  { name: 'Corporation Yard', alternateNames: ['CORP'], lat: 33.783859, lng: -118.109146 },
  { name: 'Dance Center', alternateNames: ['DC'], lat: 33.788376, lng: -118.112633 },
  { name: 'Design', alternateNames: ['DESN'], lat: 33.782063, lng: -118.109306 },
  { name: 'Education 2', alternateNames: ['ED2'], lat: 33.775810, lng: -118.114342 },
  { name: 'Bob and Barbara Ellis Education Building', alternateNames: ['EED'], lat: 33.776421, lng: -118.114174 },
  { name: 'Engineering 2', alternateNames: ['EN2'], lat: 33.783333, lng: -118.110748 },
  { name: 'Engineering 3', alternateNames: ['EN3'], lat: 33.783699, lng: -118.111183 },
  { name: 'Engineering 4', alternateNames: ['EN4'], lat: 33.783699, lng: -118.110687 },
  { name: 'Engineering and Computer Science', alternateNames: ['ECS'], lat: 33.783573, lng: -118.110245 },
  { name: 'Engineering Technology', alternateNames: ['ET'], lat: 33.782936, lng: -118.108940 },
  { name: 'Faculty Office 2', alternateNames: ['FO2'], lat: 33.778576, lng: -118.113914 },
  { name: 'Faculty Office 3', alternateNames: ['FO3'], lat: 33.779182, lng: -118.113708 },
  { name: 'Faculty Office 4', alternateNames: ['FO4'], lat: 33.778282, lng: -118.111977 },
  { name: 'Faculty Office 5', alternateNames: ['FO5'], lat: 33.779125, lng: -118.112366 },
  { name: 'Family & Consumer Sciences', alternateNames: ['FCS'], lat: 33.781696, lng: -118.116158 },
  { name: 'Fine Arts 1', alternateNames: ['FA1'], lat: 33.777248, lng: -118.112480 },
  { name: 'Fine Arts 2', alternateNames: ['FA2'], lat: 33.777458, lng: -118.112167 },
  { name: 'Fine Arts 3', alternateNames: ['FA3'], lat: 33.777943, lng: -118.112228 },
  { name: 'Fine Arts 4', alternateNames: ['FA4'], lat: 33.778328, lng: -118.112633 },
  { name: 'Foundation', alternateNames: ['FND'], lat: 33.781342, lng: -118.110344 },
  { name: 'Hall of Science', alternateNames: ['HSCI'], lat: 33.779842, lng: -118.112526 },
  { name: 'Health & Human Services 1', alternateNames: ['HHS1'], lat: 33.782448, lng: -118.112518 },
  { name: 'Health & Human Services 2', alternateNames: ['HHS2'], lat: 33.782219, lng: -118.112419 },
  { name: 'Horn Center', alternateNames: ['HC'], lat: 33.783367, lng: -118.114082 },
  { name: 'Hillside Gateway', alternateNames: ['HG'], lat: 33.783367, lng: -118.119904 },
  { name: 'Human Services & Design', alternateNames: ['HSD'], lat: 33.782749, lng: -118.109550 },
  { name: 'International House', alternateNames: ['IH'], lat: 33.781780, lng: -118.120949 },
  { name: 'Japanese Garden', alternateNames: ['JG'], lat: 33.785328, lng: -118.119766 },
  { name: 'Kleefeld Contemporary Art Museum', alternateNames: ['KCAM'], lat: 33.783459, lng: -118.114685 },
  { name: 'Kinesiology', alternateNames: ['KIN'], lat: 33.783001, lng: -118.113029 },
  { name: 'Language Arts', alternateNames: ['LAB'], lat: 33.776981, lng: -118.112679 },
  { name: 'Lecture Hall 150-151', alternateNames: ['LH'], lat: 33.778233, lng: -118.113960 },
  { name: 'Liberal Arts 1', alternateNames: ['LA1'], lat: 33.777756, lng: -118.114716 },
  { name: 'Liberal Arts 2', alternateNames: ['LA2'], lat: 33.778057, lng: -118.114594 },
  { name: 'Liberal Arts 3', alternateNames: ['LA3'], lat: 33.778343, lng: -118.114494 },
  { name: 'Liberal Arts 4', alternateNames: ['LA4'], lat: 33.778641, lng: -118.114395 },
  { name: 'Liberal Arts 5', alternateNames: ['LA5'], lat: 33.779018, lng: -118.114265 },
  { name: 'Library', alternateNames: ['LIB'], lat: 33.777267, lng: -118.114777 },
  { name: 'Los Alamitos Hall', alternateNames: ['LAH'], lat: 33.783367, lng: -118.118752 },
  { name: 'Los Cerritos Hall', alternateNames: ['LCH'], lat: 33.782467, lng: -118.119087 },
  { name: 'McIntosh Humanities Bldg', alternateNames: ['MHB'], lat: 33.776985, lng: -118.113251 },
  { name: 'Microbiology', alternateNames: ['MIC'], lat: 33.779369, lng: -118.111778 },
  { name: 'Molecular & Life Sciences Center', alternateNames: ['MLSC'], lat: 33.780270, lng: -118.112274 },
  { name: 'Multimedia Center', alternateNames: ['MMC'], lat: 33.776798, lng: -118.114586 },
  { name: 'Nursing', alternateNames: ['NUR'], lat: 33.781731, lng: -118.117867 },
  { name: 'Outpost', alternateNames: ['OP'], lat: 33.782310, lng: -118.110405 },
  { name: 'Parking & Transportation Services', alternateNames: ['PTS'], lat: 33.785969, lng: -118.116425 },
  { name: 'Parkside College', alternateNames: ['PSC'], lat: 33.786922, lng: -118.120071 },
  { name: 'Peterson Hall 1', alternateNames: ['PH'], lat: 33.778931, lng: -118.112671 },
  { name: 'Parkside North', alternateNames: ['PN'], lat: 33.788239, lng: -118.119507 },
  { name: 'Psychology', alternateNames: ['PSY'], lat: 33.779503, lng: -118.114227 },
  { name: 'Pyramid', alternateNames: ['PYR'], lat: 33.787445, lng: -118.114403 },
  { name: 'Reprographics', alternateNames: ['REPR'], lat: 33.784733, lng: -118.109848 },
  { name: 'Social Science/Public Affairs', alternateNames: ['SSPA'], lat: 33.782108, lng: -118.110809 },
  { name: 'Student Health Services', alternateNames: ['SHS'], lat: 33.782372, lng: -118.117828 },
  { name: 'Student Recreation & Wellness Center', alternateNames: ['SRWC'], lat: 33.785229, lng: -118.109070 },
  { name: 'Soccer and Softball Clubhouse', alternateNames: ['SSCH'], lat: 33.786694, lng: -118.112061 },
  { name: 'Shakarian Student Success Center', alternateNames: ['SSSC'], lat: 33.779392, lng: -118.112579 },
  { name: 'Theatre Arts', alternateNames: ['TA'], lat: 33.776653, lng: -118.112473 },
  { name: 'University Music Center', alternateNames: ['UMC'], lat: 33.787170, lng: -118.112335 },
  { name: 'University Police Bldg', alternateNames: ['UP'], lat: 33.784336, lng: -118.109161 },
  { name: 'University Student Union', alternateNames: ['USU'], lat: 33.781700, lng: -118.114632 },
  { name: 'University Theatre', alternateNames: ['UT'], lat: 33.776417, lng: -118.111900 },
  { name: 'Visitor Information Center', alternateNames: ['VIC'], lat: 33.781990, lng: -118.119156 },
  { name: 'Vivian Engineering Center', alternateNames: ['VEC'], lat: 33.782925, lng: -118.110641 },
  // ── Outdoor spaces ────────────────────────────────────────
  { name: 'Speaker Platform', alternateNames: [], lat: 33.779903, lng: -118.113449 },
  { name: 'Grow Beach', alternateNames: [], lat: 33.781815, lng: -118.112228 },
  { name: 'Central Quad', alternateNames: [], lat: 33.777977, lng: -118.113419 },
  { name: 'Beach Circle', alternateNames: [], lat: 33.784100, lng: -118.115166 },
  { name: 'Jack Rose Track', alternateNames: [], lat: 33.784653, lng: -118.114258 },
  { name: 'George Allen Field', alternateNames: [], lat: 33.786095, lng: -118.110901 },
  { name: 'Rhodes Tennis Center', alternateNames: [], lat: 33.784409, lng: -118.110733 },
  { name: 'LBSU Softball Complex', alternateNames: [], lat: 33.786217, lng: -118.112007 },
  { name: 'LBSU Sand Courts', alternateNames: [], lat: 33.785259, lng: -118.113213 },
  { name: 'Ken Lindgren Aquatics Center', alternateNames: [], lat: 33.783878, lng: -118.112419 },
];
