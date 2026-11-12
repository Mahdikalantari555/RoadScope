/**
 * Geodesy and planar geometry helpers. Projection: EPSG:32633 (WGS 84 / UTM zone 33N), a
 * metric CRS appropriate for the study area (central meridian 15°E, ~1.5° from 13.4°E).
 */
import proj4 from "proj4";
import { STUDY_AREA, type BBox, type Position } from "./domain";

const WGS84 = "EPSG:4326";
const UTM_33N = "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs +type=crs";

export function lonLatToUtm(lon: number, lat: number): [number, number] {
  const r = proj4(WGS84, UTM_33N, [lon, lat]) as number[];
  return [r[0]!, r[1]!];
}

export function utmToLonLat(x: number, y: number): [number, number] {
  const r = proj4(UTM_33N, WGS84, [x, y]) as number[];
  return [r[0]!, r[1]!];
}

export const STUDY_CENTER_UTM = lonLatToUtm(STUDY_AREA.center.lon, STUDY_AREA.center.lat);

const COVERAGE_LIMIT_M = STUDY_AREA.networkHalfExtentM + STUDY_AREA.reportBufferM;

/** True if a WGS84 point lies inside the square study-area coverage (network + buffer). */
export function isWithinStudyCoverage(lon: number, lat: number): boolean {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  const [x, y] = lonLatToUtm(lon, lat);
  return Math.abs(x - STUDY_CENTER_UTM[0]) <= COVERAGE_LIMIT_M && Math.abs(y - STUDY_CENTER_UTM[1]) <= COVERAGE_LIMIT_M;
}

/** WGS84 bounding box of the coverage square (used for map fitting and API metadata). */
export function coverageBBox(): BBox {
  const [cx, cy] = STUDY_CENTER_UTM;
  const corners = [
    utmToLonLat(cx - COVERAGE_LIMIT_M, cy - COVERAGE_LIMIT_M),
    utmToLonLat(cx + COVERAGE_LIMIT_M, cy + COVERAGE_LIMIT_M),
  ];
  return [corners[0]![0], corners[0]![1], corners[1]![0], corners[1]![1]];
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Distance from point P to segment AB plus the projection parameter t in [0, 1]. */
export function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { distance: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

/** Minimum distance from a point to a polyline, with the index of the closest vertex pair. */
export function pointToPolyline(px: number, py: number, coords: Position[]): { distance: number; index: number; t: number } {
  let best = { distance: Number.POSITIVE_INFINITY, index: 0, t: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const hit = pointToSegment(px, py, a[0], a[1], b[0], b[1]);
    if (hit.distance < best.distance) best = { distance: hit.distance, index: i, t: hit.t };
  }
  return best;
}

/** Andrew's monotone chain convex hull. Returns counter-clockwise ring without repeated first point. */
export function convexHull(points: Position[]): Position[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Position[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Position[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Shoelace area for a simple ring (absolute value). */
export function ringArea(ring: Position[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  }
  return Math.abs(s) / 2;
}

export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Uniform-grid spatial hash for fixed-radius neighbour queries on planar points.
 * Build cost O(n); query cost proportional to the number of points in nearby buckets.
 */
export class SpatialHash {
  private readonly buckets = new Map<number, number[]>();

  constructor(
    private readonly cellSize: number,
    private readonly xs: ArrayLike<number>,
    private readonly ys: ArrayLike<number>,
  ) {
    for (let i = 0; i < xs.length; i++) {
      const k = this.key(Math.floor(xs[i]! / cellSize), Math.floor(ys[i]! / cellSize));
      const bucket = this.buckets.get(k);
      if (bucket) bucket.push(i);
      else this.buckets.set(k, [i]);
    }
  }

  private key(ix: number, iy: number): number {
    return (ix + 1_000_000) * 2_000_000 + (iy + 1_000_000);
  }

  /** Writes into `out` the indices of all points within radius `r` of (x, y). */
  query(x: number, y: number, r: number, out: number[] = []): number[] {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor((x - r) / cs);
    const x1 = Math.floor((x + r) / cs);
    const y0 = Math.floor((y - r) / cs);
    const y1 = Math.floor((y + r) / cs);
    const r2 = r * r;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const bucket = this.buckets.get(this.key(ix, iy));
        if (!bucket) continue;
        for (const i of bucket) {
          const dx = this.xs[i]! - x;
          const dy = this.ys[i]! - y;
          if (dx * dx + dy * dy <= r2) out.push(i);
        }
      }
    }
    return out;
  }
}
