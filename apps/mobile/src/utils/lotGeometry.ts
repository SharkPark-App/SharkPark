import type { LatLng } from '../data/lotPolygons';

export function polygonCentroid(polygon: LatLng[]): { latitude: number; longitude: number } {
  const pts =
    polygon.length > 1 &&
    polygon[0].lat === polygon[polygon.length - 1].lat &&
    polygon[0].lng === polygon[polygon.length - 1].lng
      ? polygon.slice(0, -1)
      : polygon;

  if (pts.length === 0) {
    return { latitude: 0, longitude: 0 };
  }
  if (pts.length < 3) {
    const sum = pts.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
      { lat: 0, lng: 0 },
    );
    return { latitude: sum.lat / pts.length, longitude: sum.lng / pts.length };
  }

  // Shoelace-based centroid for non-self-intersecting polygons.
  let signedArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const x0 = pts[j].lng;
    const y0 = pts[j].lat;
    const x1 = pts[i].lng;
    const y1 = pts[i].lat;
    const a = x0 * y1 - x1 * y0;
    signedArea += a;
    cx += (x0 + x1) * a;
    cy += (y0 + y1) * a;
  }

  if (Math.abs(signedArea) < 1e-12) {
    const sum = pts.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
      { lat: 0, lng: 0 },
    );
    return { latitude: sum.lat / pts.length, longitude: sum.lng / pts.length };
  }

  const areaFactor = 1 / (3 * signedArea);
  return {
    latitude: cy * areaFactor,
    longitude: cx * areaFactor,
  };
}

export function isPointInsidePolygon(
  lat: number,
  lng: number,
  polygon: LatLng[],
): boolean {
  const pts =
    polygon.length > 1 &&
    polygon[0].lat === polygon[polygon.length - 1].lat &&
    polygon[0].lng === polygon[polygon.length - 1].lng
      ? polygon.slice(0, -1)
      : polygon;

  if (pts.length < 3) return false;

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].lng;
    const yi = pts[i].lat;
    const xj = pts[j].lng;
    const yj = pts[j].lat;

    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}
