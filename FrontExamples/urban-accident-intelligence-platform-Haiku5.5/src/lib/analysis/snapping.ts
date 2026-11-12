/**
 * Nearest-road-segment assignment (point-to-polyline distance in EPSG:32633).
 * Segments are pruned by bounding-box lower bounds, which is exact and fast for city networks.
 */
import { pointToPolyline } from "../geo";
import type { Position } from "../domain";

export interface SegmentGeom {
  id: number;
  coords: Position[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SnapHit {
  segmentId: number;
  distanceM: number;
  t: number;
}

export function buildSegmentGeoms(segments: { id: number; utm: Position[] }[]): SegmentGeom[] {
  return segments.map((s) => {
    const xs = s.utm.map((p) => p[0]);
    const ys = s.utm.map((p) => p[1]);
    return {
      id: s.id,
      coords: s.utm,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  });
}

export function nearestSegment(x: number, y: number, geoms: SegmentGeom[]): SnapHit | null {
  let best: SnapHit | null = null;
  for (const g of geoms) {
    const dx = Math.max(g.minX - x, 0, x - g.maxX);
    const dy = Math.max(g.minY - y, 0, y - g.maxY);
    if (best && Math.hypot(dx, dy) >= best.distanceM) continue;
    const hit = pointToPolyline(x, y, g.coords);
    if (!best || hit.distance < best.distanceM) best = { segmentId: g.id, distanceM: hit.distance, t: hit.t };
  }
  return best;
}

/** Distance from a point to the nearest road segment, or Infinity when no segments exist. */
export function distanceToNetwork(x: number, y: number, geoms: SegmentGeom[]): number {
  return nearestSegment(x, y, geoms)?.distanceM ?? Number.POSITIVE_INFINITY;
}
