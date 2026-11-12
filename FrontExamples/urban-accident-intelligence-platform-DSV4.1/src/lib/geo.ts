/**
 * Geospatial primitives.
 *
 * The platform stores coordinates in EPSG:4326 but performs all metric operations
 * in a local equidistant projection centred on the study area. At the scale of an
 * urban area the planar error versus a true geodesic measurement is ~0.2 % at a
 * 8 km separation and grows with distance from the projection origin — well inside
 * the positional uncertainty of crowdsourced reports, but reported explicitly. A raster/vector PostGIS deployment would instead use an official
 * projected CRS (e.g. EPSG:27700 / EPSG:28992) — see docs/ARCHITECTURE.md.
 */

export type LngLat = [number, number];
export type LatLng = { lat: number; lng: number };
export type XY = { x: number; y: number };

export const EARTH_RADIUS_M = 6_371_008.8;

export type Projection = {
  originLat: number;
  originLng: number;
  mPerDegLat: number;
  mPerDegLng: number;
};

export function makeProjection(originLat: number, originLng = 0): Projection {
  const phi = (originLat * Math.PI) / 180;
  const mPerDegLat =
    111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi);
  const mPerDegLng =
    111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
  return { originLat, originLng, mPerDegLat, mPerDegLng };
}

export function project(p: LatLng, proj: Projection): XY {
  return {
    x: (p.lng - proj.originLng) * proj.mPerDegLng,
    y: (p.lat - proj.originLat) * proj.mPerDegLat,
  };
}

export function unproject(p: XY, proj: Projection): LatLng {
  return {
    lng: p.x / proj.mPerDegLng + proj.originLng,
    lat: p.y / proj.mPerDegLat + proj.originLat,
  };
}

export function haversine(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dφ = φ2 - φ1;
  const dλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function destination(from: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (from.lat * Math.PI) / 180;
  const λ1 = (from.lng * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

export type SegmentPointDistance = { distance: number; t: number; closest: XY };

/** Perpendicular distance from a projected point to a projected segment. */
export function pointToSegment(p: XY, a: XY, b: XY): SegmentPointDistance {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return { distance: Math.hypot(p.x - closest.x, p.y - closest.y), t, closest };
}

export function polygonArea(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const proj = makeProjection(ring[0][1], ring[0][0]);
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = project({ lat: ring[i][1], lng: ring[i][0] }, proj);
    const b = project(
      { lat: ring[(i + 1) % ring.length][1], lng: ring[(i + 1) % ring.length][0] },
      proj,
    );
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area / 2);
}

export function pointInPolygon(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export type BBox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

export function bboxOf(points: LatLng[], padM = 0): BBox {
  if (points.length === 0) return { minLng: -180, minLat: -90, maxLng: 180, maxLat: 90 };
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const dLat = padM / 111_132;
  const dLng = padM / (111_320 * Math.max(0.2, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)));
  return { minLng: minLng - dLng, minLat: minLat - dLat, maxLng: maxLng + dLng, maxLat: maxLat + dLat };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a.maxLng < b.minLng || a.minLng > b.maxLng || a.maxLat < b.minLat || a.minLat > b.maxLat);
}

export function expandBBox(b: BBox, metres: number): BBox {
  const dLat = metres / 111_132;
  const midLat = (b.minLat + b.maxLat) / 2;
  const dLng = metres / (111_320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  return {
    minLng: b.minLng - dLng,
    minLat: b.minLat - dLat,
    maxLng: b.maxLng + dLng,
    maxLat: b.maxLat + dLat,
  };
}

export function formatCoordinate(lat: number, lng: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`;
}

export function formatDistance(metres: number | null | undefined): string {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return "—";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 2 : 1)} km`;
}

export function pointFeature(
  lng: number,
  lat: number,
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.Point> {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties };
}

export function lineFeature(
  coordinates: LngLat[],
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: "Feature", geometry: { type: "LineString", coordinates }, properties };
}
