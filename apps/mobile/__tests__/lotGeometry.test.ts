import { isPointInsidePolygon, polygonCentroid } from '../src/utils/lotGeometry';

describe('lotGeometry', () => {
  describe('polygonCentroid', () => {
    it('returns (0,0) for an empty polygon', () => {
      expect(polygonCentroid([])).toEqual({ latitude: 0, longitude: 0 });
    });

    it('returns arithmetic mean for degenerate (<3 point) polygons', () => {
      const centroid = polygonCentroid([
        { lat: 33.0, lng: -118.2 },
        { lat: 35.0, lng: -118.0 },
      ]);

      expect(centroid.latitude).toBeCloseTo(34.0, 6);
      expect(centroid.longitude).toBeCloseTo(-118.1, 6);
    });

    it('computes centroid for a simple square', () => {
      const centroid = polygonCentroid([
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
        { lat: 2, lng: 2 },
        { lat: 2, lng: 0 },
      ]);

      expect(centroid.latitude).toBeCloseTo(1.0, 6);
      expect(centroid.longitude).toBeCloseTo(1.0, 6);
    });

    it('handles closed polygons by ignoring duplicated terminal vertex', () => {
      const centroid = polygonCentroid([
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
        { lat: 2, lng: 2 },
        { lat: 2, lng: 0 },
        { lat: 0, lng: 0 },
      ]);

      expect(centroid.latitude).toBeCloseTo(1.0, 6);
      expect(centroid.longitude).toBeCloseTo(1.0, 6);
    });

    it('falls back to arithmetic mean when signed area is near zero', () => {
      const nearCollinear = [
        { lat: 0, lng: 0 },
        { lat: 0.0000000000001, lng: 1 },
        { lat: 0.0000000000002, lng: 2 },
      ];

      const centroid = polygonCentroid(nearCollinear);
      expect(centroid.latitude).toBeCloseTo((0 + 0.0000000000001 + 0.0000000000002) / 3, 12);
      expect(centroid.longitude).toBeCloseTo(1, 6);
    });
  });

  describe('isPointInsidePolygon', () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 2, lng: 2 },
      { lat: 2, lng: 0 },
    ];

    it('returns true for a point clearly inside polygon', () => {
      expect(isPointInsidePolygon(1, 1, square)).toBe(true);
    });

    it('returns false for a point clearly outside polygon', () => {
      expect(isPointInsidePolygon(3, 3, square)).toBe(false);
    });

    it('returns false when polygon has fewer than 3 points', () => {
      expect(
        isPointInsidePolygon(1, 1, [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
        ]),
      ).toBe(false);
    });

    it('supports closed polygon input with repeated first/last point', () => {
      const closed = [...square, square[0]];
      expect(isPointInsidePolygon(1, 1, closed)).toBe(true);
      expect(isPointInsidePolygon(3, 3, closed)).toBe(false);
    });
  });
});
