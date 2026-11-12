/**
 * Metric geometry + topological road network engine.
 * Local CRS: azimuthal-equidistant approximation about (lon0, lat0) in metres.
 */
export type XY = [number, number];
const R = 6371008.8;

export function makeProjection(lon0: number, lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    toXY(lon: number, lat: number): XY {
      return [((lon - lon0) * Math.PI / 180) * R * k, ((lat - lat0) * Math.PI / 180) * R];
    },
    toLonLat(x: number, y: number): XY {
      return [lon0 + (x / (R * k)) * 180 / Math.PI, lat0 + (y / R) * 180 / Math.PI];
    },
  };
}
export type Projection = ReturnType<typeof makeProjection>;

export const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function polylineLength(c: XY[]) { let L = 0; for (let i = 1; i < c.length; i++) L += dist(c[i - 1], c[i]); return L; }

/** Point at linear-reference m along polyline. */
export function pointAtM(c: XY[], m: number): XY {
  if (m <= 0) return c[0];
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const d = dist(c[i - 1], c[i]);
    if (acc + d >= m) { const t = d === 0 ? 0 : (m - acc) / d; return [c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), c[i - 1][1] + t * (c[i][1] - c[i - 1][1])]; }
    acc += d;
  }
  return c[c.length - 1];
}
/** Sub-polyline between m0 and m1. */
export function subLine(c: XY[], m0: number, m1: number): XY[] {
  const out: XY[] = [pointAtM(c, m0)];
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const d = dist(c[i - 1], c[i]);
    if (acc > m0 && acc < m1) out.push(c[i - 1]);
    acc += d;
  }
  out.push(pointAtM(c, m1));
  return out;
}
/** Orthogonal projection of p onto polyline: returns distance, m-offset, foot point. */
export function projectOnPolyline(c: XY[], p: XY) {
  let best = { d: Infinity, m: 0, pt: c[0] as XY };
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1], b = c[i];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy;
    let t = L2 === 0 ? 0 : ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2;
    t = Math.max(0, Math.min(1, t));
    const pt: XY = [a[0] + t * vx, a[1] + t * vy];
    const d = dist(p, pt);
    if (d < best.d) best = { d, m: acc + t * Math.sqrt(L2), pt };
    acc += Math.sqrt(L2);
  }
  return best;
}

export interface NetNode { id: number; xy: XY; degree: number }
export interface NetSegment { id: number; from: number; to: number; length: number; coords: XY[]; roadClass: string; aadt: number | null; speedLimit: number; lanes: number; sinuosity: number }
export interface NetLixel { id: number; segmentId: number; idx: number; mStart: number; mEnd: number; length: number; mid: XY }
export interface NetPoint { segmentId: number; m: number }

/** Binary heap for Dijkstra */
class MinHeap<T> {
  private a: { k: number; v: T }[] = [];
  push(k: number, v: T) { this.a.push({ k, v }); let i = this.a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.a[p].k <= this.a[i].k) break; [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p; } }
  pop() { const top = this.a[0]; const last = this.a.pop()!; if (this.a.length) { this.a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < this.a.length && this.a[l].k < this.a[s].k) s = l; if (r < this.a.length && this.a[r].k < this.a[s].k) s = r; if (s === i) break; [this.a[s], this.a[i]] = [this.a[i], this.a[s]]; i = s; } } return top; }
  get size() { return this.a.length; }
}

export class RoadNetwork {
  nodes = new Map<number, NetNode>();
  segments = new Map<number, NetSegment>();
  lixels = new Map<number, NetLixel>();
  adj = new Map<number, { seg: number; to: number; w: number }[]>();
  lixelsBySegment = new Map<number, NetLixel[]>();

  constructor(nodes: NetNode[], segments: NetSegment[], lixels: NetLixel[] = []) {
    for (const n of nodes) { this.nodes.set(n.id, { ...n, degree: 0 }); this.adj.set(n.id, []); }
    for (const s of segments) {
      this.segments.set(s.id, s);
      this.adj.get(s.from)?.push({ seg: s.id, to: s.to, w: s.length });
      this.adj.get(s.to)?.push({ seg: s.id, to: s.from, w: s.length });
      this.nodes.get(s.from)!.degree++; this.nodes.get(s.to)!.degree++;
    }
    for (const l of lixels) { this.lixels.set(l.id, l); if (!this.lixelsBySegment.has(l.segmentId)) this.lixelsBySegment.set(l.segmentId, []); this.lixelsBySegment.get(l.segmentId)!.push(l); }
    for (const arr of this.lixelsBySegment.values()) arr.sort((a, b) => a.idx - b.idx);
  }

  /** Dijkstra from a network point; returns node distances with equal-split multipliers. */
  nodeDistancesFrom(p: NetPoint, maxDist: number) {
    const seg = this.segments.get(p.segmentId)!;
    const out = new Map<number, { d: number; split: number }>();
    const heap = new MinHeap<{ node: number; split: number }>();
    heap.push(p.m, { node: seg.from, split: 1 });
    heap.push(seg.length - p.m, { node: seg.to, split: 1 });
    while (heap.size) {
      const { k: d, v } = heap.pop();
      if (d > maxDist) break;
      if (out.has(v.node)) continue;
      out.set(v.node, { d, split: v.split });
      const deg = this.nodes.get(v.node)!.degree;
      const f = deg > 1 ? 1 / (deg - 1) : 1;
      for (const e of this.adj.get(v.node) ?? []) if (!out.has(e.to)) heap.push(d + e.w, { node: e.to, split: v.split * f });
    }
    return out;
  }

  /** Shortest-path network distance from p to every lixel midpoint within maxDist (with equal-split factor). */
  lixelDistancesFrom(p: NetPoint, maxDist: number) {
    const nd = this.nodeDistancesFrom(p, maxDist);
    const res = new Map<number, { d: number; split: number }>();
    const seg0 = this.segments.get(p.segmentId)!;
    for (const l of this.lixelsBySegment.get(p.segmentId) ?? []) {
      const d = Math.abs(l.mStart + l.length / 2 - p.m);
      if (d <= maxDist) res.set(l.id, { d, split: 1 });
    }
    const seen = new Set<number>([p.segmentId]);
    for (const [nid, info] of nd) {
      for (const e of this.adj.get(nid) ?? []) {
        if (seen.has(e.seg)) continue; seen.add(e.seg);
        const s = this.segments.get(e.seg)!;
        const fromInfo = nd.get(s.from), toInfo = nd.get(s.to);
        const leave = (nid2: number) => { const dg = this.nodes.get(nid2)!.degree; return dg > 1 ? 1 / (dg - 1) : 1; };
        for (const l of this.lixelsBySegment.get(s.id) ?? []) {
          const mid = l.mStart + l.length / 2;
          let best = Infinity, split = 1;
          if (fromInfo && fromInfo.d + mid < best) { best = fromInfo.d + mid; split = fromInfo.split * leave(s.from); }
          if (toInfo && toInfo.d + (s.length - mid) < best) { best = toInfo.d + (s.length - mid); split = toInfo.split * leave(s.to); }
          if (best <= maxDist) { const prev = res.get(l.id); if (!prev || best < prev.d) res.set(l.id, { d: best, split }); }
        }
      }
    }
    void seg0;
    return res;
  }

  /** Network distance between two network points (bounded). */
  pointDistance(a: NetPoint, b: NetPoint, maxDist: number): number {
    if (a.segmentId === b.segmentId) return Math.abs(a.m - b.m);
    const nd = this.nodeDistancesFrom(a, maxDist);
    const s = this.segments.get(b.segmentId)!;
    const f = nd.get(s.from), t = nd.get(s.to);
    let best = Infinity;
    if (f) best = Math.min(best, f.d + b.m);
    if (t) best = Math.min(best, t.d + (s.length - b.m));
    return best;
  }

  /** Distances from a network point to a set of other network points (one Dijkstra). */
  pointDistancesTo(a: NetPoint, targets: { key: number; p: NetPoint }[], maxDist: number) {
    const nd = this.nodeDistancesFrom(a, maxDist);
    const out = new Map<number, number>();
    for (const { key, p } of targets) {
      let best = Infinity;
      if (p.segmentId === a.segmentId) best = Math.abs(a.m - p.m);
      const s = this.segments.get(p.segmentId)!;
      const f = nd.get(s.from), t = nd.get(s.to);
      if (f) best = Math.min(best, f.d + p.m);
      if (t) best = Math.min(best, t.d + (s.length - p.m));
      if (best <= maxDist) out.set(key, best);
    }
    return out;
  }

  lixelAt(segmentId: number, m: number): NetLixel | undefined {
    const arr = this.lixelsBySegment.get(segmentId) ?? [];
    return arr.find((l) => m >= l.mStart && m <= l.mEnd) ?? arr[arr.length - 1];
  }

  /** Segments whose bbox is within r of p (coarse filter) */
  segmentsNear(p: XY, r: number) {
    const out: NetSegment[] = [];
    for (const s of this.segments.values()) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const c of s.coords) { if (c[0] < minx) minx = c[0]; if (c[0] > maxx) maxx = c[0]; if (c[1] < miny) miny = c[1]; if (c[1] > maxy) maxy = c[1]; }
      if (p[0] >= minx - r && p[0] <= maxx + r && p[1] >= miny - r && p[1] <= maxy + r) out.push(s);
    }
    return out;
  }
}

/** Uniform lixelization using LRS offsets. Last lixel absorbs the remainder (≥ half resolution). */
export function lixelize(coords: XY[], length: number, resolution: number) {
  const n = Math.max(1, Math.round(length / resolution));
  const step = length / n;
  const out: { idx: number; mStart: number; mEnd: number; length: number; mid: XY; coords: XY[] }[] = [];
  for (let i = 0; i < n; i++) {
    const m0 = i * step, m1 = i === n - 1 ? length : (i + 1) * step;
    out.push({ idx: i, mStart: m0, mEnd: m1, length: m1 - m0, mid: pointAtM(coords, (m0 + m1) / 2), coords: subLine(coords, m0, m1) });
  }
  return out;
}

/** Monotone-chain convex hull */
export function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = []; for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: XY[] = []; for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
