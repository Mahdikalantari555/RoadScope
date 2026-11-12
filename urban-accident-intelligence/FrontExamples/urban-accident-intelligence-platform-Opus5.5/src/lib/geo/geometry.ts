/** Planar computational geometry in a projected (metric) CRS. */
export type XY = [number, number];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function dist(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function polylineLength(line: XY[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += dist(line[i - 1], line[i]);
  return s;
}

export function bboxOf(points: XY[]): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export interface Projection {
  point: XY;
  distance: number;
  /** distance along the polyline from its first vertex (m) */
  along: number;
}

/** Orthogonal projection of p onto segment ab. */
export function projectOnSegment(p: XY, a: XY, b: XY): { point: XY; t: number; distance: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point: XY = [a[0] + t * dx, a[1] + t * dy];
  return { point, t, distance: dist(p, point) };
}

/** Nearest point on a polyline. */
export function projectOnPolyline(p: XY, line: XY[]): Projection {
  let best: Projection = { point: line[0], distance: Infinity, along: 0 };
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const segLen = dist(line[i - 1], line[i]);
    const r = projectOnSegment(p, line[i - 1], line[i]);
    if (r.distance < best.distance) best = { point: r.point, distance: r.distance, along: acc + r.t * segLen };
    acc += segLen;
  }
  return best;
}

/** Point at a given distance along a polyline. */
export function pointAlong(line: XY[], d: number): XY {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const segLen = dist(line[i - 1], line[i]);
    if (acc + segLen >= d) {
      const t = segLen === 0 ? 0 : (d - acc) / segLen;
      return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
    }
    acc += segLen;
  }
  return line[line.length - 1];
}

/** Andrew's monotone chain convex hull (counter-clockwise, closed ring). */
export function convexHull(points: XY[]): XY[] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts.length ? [...pts, pts[0]] : [];
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return [...hull, hull[0]];
}

export function polygonArea(ring: XY[]): number {
  let s = 0;
  for (let i = 1; i < ring.length; i++) s += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return Math.abs(s) / 2;
}

/** Uniform grid spatial index for points (fast fixed-radius neighbour queries). */
export class PointGrid {
  private cells = new Map<string, number[]>();
  constructor(
    private readonly pts: XY[],
    private readonly cell: number,
  ) {
    pts.forEach((p, i) => {
      const k = this.key(p[0], p[1]);
      const arr = this.cells.get(k);
      if (arr) arr.push(i);
      else this.cells.set(k, [i]);
    });
  }
  private key(x: number, y: number) {
    return `${Math.floor(x / this.cell)}:${Math.floor(y / this.cell)}`;
  }
  /** indices of points within radius r of p (inclusive) */
  within(p: XY, r: number): number[] {
    const out: number[] = [];
    const cx0 = Math.floor((p[0] - r) / this.cell);
    const cx1 = Math.floor((p[0] + r) / this.cell);
    const cy0 = Math.floor((p[1] - r) / this.cell);
    const cy1 = Math.floor((p[1] + r) / this.cell);
    const r2 = r * r;
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = this.cells.get(`${cx}:${cy}`);
        if (!arr) continue;
        for (const i of arr) {
          const dx = this.pts[i][0] - p[0];
          const dy = this.pts[i][1] - p[1];
          if (dx * dx + dy * dy <= r2) out.push(i);
        }
      }
    return out;
  }
  /** Nearest neighbour distance excluding index `self`. Expands search ring until found. */
  nearestDistance(self: number, maxR = 20000): number {
    const p = this.pts[self];
    let r = this.cell;
    while (r <= maxR) {
      let best = Infinity;
      for (const j of this.within(p, r)) if (j !== self) best = Math.min(best, dist(p, this.pts[j]));
      if (best <= r) return best;
      r *= 2;
    }
    return Infinity;
  }
}

export interface IndexedLine {
  id: number;
  coords: XY[];
  bbox: BBox;
}

/** Grid index for polylines (nearest-segment assignment / snapping). */
export class LineGrid {
  private cells = new Map<string, number[]>();
  constructor(
    private readonly lines: IndexedLine[],
    private readonly cell = 250,
  ) {
    lines.forEach((l, i) => {
      for (let cx = Math.floor(l.bbox.minX / cell); cx <= Math.floor(l.bbox.maxX / cell); cx++)
        for (let cy = Math.floor(l.bbox.minY / cell); cy <= Math.floor(l.bbox.maxY / cell); cy++) {
          const k = `${cx}:${cy}`;
          const arr = this.cells.get(k);
          if (arr) arr.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }
  nearest(p: XY, maxDistance: number): { line: IndexedLine; proj: Projection } | null {
    const seen = new Set<number>();
    let best: { line: IndexedLine; proj: Projection } | null = null;
    const r = maxDistance;
    for (let cx = Math.floor((p[0] - r) / this.cell); cx <= Math.floor((p[0] + r) / this.cell); cx++)
      for (let cy = Math.floor((p[1] - r) / this.cell); cy <= Math.floor((p[1] + r) / this.cell); cy++) {
        const arr = this.cells.get(`${cx}:${cy}`);
        if (!arr) continue;
        for (const i of arr) {
          if (seen.has(i)) continue;
          seen.add(i);
          const proj = projectOnPolyline(p, this.lines[i].coords);
          if (proj.distance <= maxDistance && (!best || proj.distance < best.proj.distance)) best = { line: this.lines[i], proj };
        }
      }
    return best;
  }
  /** Minimum distance from p to any indexed line within maxDistance, or Infinity. */
  distanceTo(p: XY, maxDistance: number): number {
    const n = this.nearest(p, maxDistance);
    return n ? n.proj.distance : Infinity;
  }
}
