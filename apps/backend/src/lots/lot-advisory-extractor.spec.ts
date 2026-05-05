import {
  extractLotAdvisories,
  refineSeverity,
  ringsOverlap,
  shapeToRing,
  lotIdsFromName,
  type C3DLocation,
  type LotPolygon,
} from './lot-advisory-extractor';

describe('refineSeverity', () => {
  it('demotes detour-route exits inside the road-closure cat to ADVISORY', () => {
    expect(refineSeverity('Beach Drive Exit', 'CLOSURE')).toBe('ADVISORY');
    expect(refineSeverity('Merriam Way Exit', 'CLOSURE')).toBe('ADVISORY');
  });

  it('treats forward-looking "Coming in YYYY" markers as INFO', () => {
    expect(refineSeverity('La Playa (Coming in 2026)', 'ADVISORY')).toBe('INFO');
    expect(refineSeverity('New Garage Coming in 2027', 'CLOSURE')).toBe('INFO');
  });

  it('keeps explicit closures as CLOSURE', () => {
    expect(refineSeverity('Atherton Closure', 'CLOSURE')).toBe('CLOSURE');
    expect(refineSeverity('Lot Closed for Repaving', 'ADVISORY')).toBe('CLOSURE');
  });

  it('does not match bare "future" without a year', () => {
    expect(refineSeverity('Future U Construction Project', 'ADVISORY')).toBe('ADVISORY');
  });
});

describe('shapeToRing', () => {
  it('returns paths for polygon shapes', () => {
    const ring = shapeToRing({
      type: 'polygon',
      paths: [
        [33.78, -118.11],
        [33.79, -118.11],
        [33.79, -118.10],
      ],
    });
    expect(ring).toEqual([
      { lat: 33.78, lng: -118.11 },
      { lat: 33.79, lng: -118.11 },
      { lat: 33.79, lng: -118.10 },
    ]);
  });

  it('expands rectangle bounds into a 4-vertex ring', () => {
    const ring = shapeToRing({
      type: 'rectangle',
      bounds: [
        [33.78, -118.11],
        [33.79, -118.10],
      ],
    });
    expect(ring).toHaveLength(4);
  });

  it('returns null for polylines / markers / labels', () => {
    expect(shapeToRing({ type: 'polyline', paths: [[33.78, -118.11]] })).toBeNull();
    expect(shapeToRing(null)).toBeNull();
    expect(shapeToRing(undefined)).toBeNull();
  });
});

describe('ringsOverlap', () => {
  const square = (cx: number, cy: number, half = 0.001) => [
    { lat: cy - half, lng: cx - half },
    { lat: cy + half, lng: cx - half },
    { lat: cy + half, lng: cx + half },
    { lat: cy - half, lng: cx + half },
  ];

  it('detects vertex-inside overlap', () => {
    const a = square(-118.11, 33.78);
    const b = square(-118.1105, 33.7805); // overlapping
    expect(ringsOverlap(a, b)).toBe(true);
  });

  it('returns false for disjoint polygons (bbox prefilter)', () => {
    const a = square(-118.11, 33.78);
    const b = square(-118.20, 33.78);
    expect(ringsOverlap(a, b)).toBe(false);
  });

  it('detects edge-crossing overlap with no vertex inside', () => {
    // a "+" shape: long horizontal bar crossing a long vertical bar.
    const horiz = [
      { lat: 33.7795, lng: -118.115 },
      { lat: 33.7805, lng: -118.115 },
      { lat: 33.7805, lng: -118.105 },
      { lat: 33.7795, lng: -118.105 },
    ];
    const vert = [
      { lat: 33.775, lng: -118.1105 },
      { lat: 33.785, lng: -118.1105 },
      { lat: 33.785, lng: -118.1095 },
      { lat: 33.775, lng: -118.1095 },
    ];
    expect(ringsOverlap(horiz, vert)).toBe(true);
  });
});

describe('lotIdsFromName', () => {
  const known = new Set(['E10', 'G4', 'PYR', 'PVN', 'PVS']);

  it('extracts "Lot E10" form', () => {
    expect(lotIdsFromName('Parking lot E10 new exit', known)).toEqual(['E10']);
  });

  it('extracts bare codes only when known', () => {
    expect(lotIdsFromName('Construction in G4 area', known)).toEqual(['G4']);
    expect(lotIdsFromName('Construction in G99 area', known)).toEqual([]);
  });

  it('matches structure name aliases', () => {
    expect(lotIdsFromName('Pyramid Parking Structure entrance', known)).toEqual(['PYR']);
    expect(lotIdsFromName('Palo Verde North repaving', known)).toEqual(['PVN']);
    expect(lotIdsFromName('Palo Verde South repaving', known)).toEqual(['PVS']);
  });
});

describe('extractLotAdvisories', () => {
  const lots: LotPolygon[] = [
    {
      lot_id: 'E10',
      polygon: [
        { lat: 33.780, lng: -118.115 },
        { lat: 33.781, lng: -118.115 },
        { lat: 33.781, lng: -118.114 },
        { lat: 33.780, lng: -118.114 },
      ],
    },
    {
      lot_id: 'G4',
      polygon: [
        { lat: 33.785, lng: -118.120 },
        { lat: 33.786, lng: -118.120 },
        { lat: 33.786, lng: -118.119 },
        { lat: 33.785, lng: -118.119 },
      ],
    },
  ];

  it('attaches a polygon-overlapping construction advisory to the right lot', () => {
    const items: C3DLocation[] = [
      {
        id: 1001,
        catId: 91209, // La Playa Construction
        name: 'La Playa Construction Area',
        lat: 33.7855,
        lng: -118.1195,
        shape: {
          type: 'polygon',
          paths: [
            [33.7853, -118.1198],
            [33.7858, -118.1198],
            [33.7858, -118.1192],
            [33.7853, -118.1192],
          ],
        },
      },
    ];
    const { seeds, stats } = extractLotAdvisories(items, lots);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].lot_id).toBe('G4');
    expect(seeds[0].match_reason).toBe('polygon_overlap');
    expect(seeds[0].severity).toBe('ADVISORY');
    expect(stats.markerCount).toBe(1);
  });

  it('attaches a name-mention advisory even when shape is a polyline (no overlap)', () => {
    const items: C3DLocation[] = [
      {
        id: 2002,
        catId: 101030,
        name: 'Parking lot E10 new exit',
        lat: 33.7805,
        lng: -118.1145,
        shape: { type: 'polyline', paths: [[33.7805, -118.1145]] },
      },
    ];
    const { seeds } = extractLotAdvisories(items, lots);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].lot_id).toBe('E10');
    expect(seeds[0].match_reason).toBe('name_mention');
  });

  it('demotes road-closure exits to ADVISORY rather than CLOSURE', () => {
    const items: C3DLocation[] = [
      {
        id: 3003,
        catId: 45989, // Road Closures
        name: 'Beach Drive Exit',
        lat: 33.7855,
        lng: -118.1195,
        shape: {
          type: 'polygon',
          paths: [
            [33.7853, -118.1198],
            [33.7858, -118.1198],
            [33.7858, -118.1192],
            [33.7853, -118.1192],
          ],
        },
      },
    ];
    const { seeds } = extractLotAdvisories(items, lots);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].severity).toBe('ADVISORY');
  });

  it('marks "Coming in 2026" advisories as INFO', () => {
    const items: C3DLocation[] = [
      {
        id: 4004,
        catId: 91209,
        name: 'La Playa (Coming in 2026)',
        lat: 33.7855,
        lng: -118.1195,
        shape: {
          type: 'polygon',
          paths: [
            [33.7853, -118.1198],
            [33.7858, -118.1198],
            [33.7858, -118.1192],
            [33.7853, -118.1192],
          ],
        },
      },
    ];
    const { seeds } = extractLotAdvisories(items, lots);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].severity).toBe('INFO');
  });

  it('ignores entries whose catId is not in the advisory whitelist', () => {
    const items: C3DLocation[] = [
      {
        id: 5005,
        catId: 99999,
        name: 'Random non-advisory marker',
        lat: 33.7855,
        lng: -118.1195,
        shape: { type: 'polygon', paths: [[33.7855, -118.1195]] },
      },
    ];
    const { seeds, stats } = extractLotAdvisories(items, lots);
    expect(seeds).toHaveLength(0);
    expect(stats.candidateCount).toBe(0);
  });

  it('does not seed off-lot advisories that match neither name nor polygon', () => {
    const items: C3DLocation[] = [
      {
        id: 6006,
        catId: 91668,
        name: 'Construction across town',
        lat: 33.900,
        lng: -118.200,
        shape: {
          type: 'polygon',
          paths: [
            [33.900, -118.200],
            [33.901, -118.200],
            [33.901, -118.199],
            [33.900, -118.199],
          ],
        },
      },
    ];
    const { seeds, stats } = extractLotAdvisories(items, lots);
    expect(seeds).toHaveLength(0);
    expect(stats.unmatched).toBe(1);
  });

  it('produces stable, sorted output (by lot_id then marker id)', () => {
    const items: C3DLocation[] = [
      {
        id: 7007,
        catId: 91209,
        name: 'La Playa Construction Area',
        lat: 33.7855,
        lng: -118.1195,
        shape: {
          type: 'polygon',
          paths: [
            [33.7853, -118.1198],
            [33.7858, -118.1198],
            [33.7858, -118.1192],
            [33.7853, -118.1192],
          ],
        },
      },
      {
        id: 7008,
        catId: 101030,
        name: 'Parking lot E10 new exit',
        lat: 33.7805,
        lng: -118.1145,
        shape: { type: 'polyline', paths: [[33.7805, -118.1145]] },
      },
    ];
    const { seeds } = extractLotAdvisories(items, lots);
    expect(seeds.map((s) => s.lot_id)).toEqual(['E10', 'G4']);
  });
});
