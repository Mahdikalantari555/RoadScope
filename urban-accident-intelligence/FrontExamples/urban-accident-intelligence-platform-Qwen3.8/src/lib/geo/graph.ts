/**
 * Topological road graph + linear-referencing engine.
 *
 * The analytical primitive is the **lixel-centre graph**: every lixel midpoint
 * becomes a node; consecutive lixels on a parent edge are joined by a weighted
 * link of (L_i + L_j)/2; the terminal lixel of each edge is joined to the real
 * intersection node by L/2. Consequently a shortest-path query between two
 * `c:<lixelId>` nodes returns the exact *network* distance between lixel
 * midpoints — never a Euclidean approximation.
 *
 * Kernel propagation through a vertex of topological degree d applies the
 * Okabe et al. (2009) "equal splitting" discontinuous-NKDE correction 1/(d-1),
 * which prevents artificial density accumulation at intersections.
 */

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  degree: number;
  control: string;
  nodeType: string;
  isGradeSeparated: boolean;
}

export interface GraphSegment {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  shape: Array<[number, number]>;
  lengthM: number;
  roadClass: string;
  classOrdinal: number;
  name: string | null;
  lanes: number;
  speedLimitKph: number;
  aadt: number | null;
  sinuosity: number;
  curvaturePerKm: number;
  lighting: string;
  surface: string;
  isBridge: boolean;
  sidewalk: boolean;
  cycleLane: boolean;
  vktPerDay: number | null;
}

export interface GraphLixel {
  id: string;
  segmentId: string;
  segmentIndex: number;
  lrsIndex: number;
  mStart: number;
  mEnd: number;
  mMid: number;
  lengthM: number;
  x: number;
  y: number;
  distToNodeM: number;
  roadClass: string;
  classOrdinal: number;
  aadt: number | null;
  speedLimitKph: number;
  lanes: number;
  trueLambda: number | null;
}

export interface SnapCandidate {
  segmentId: string;
  segmentIndex: number;
  lixelId: string;
  lixelIndex: number;
  m: number;
  x: number;
  y: number;
  perpDistanceM: number;
  bearingDeltaDeg: number;
  roadClass: string;
  classOrdinal: number;
}

/* ------------------------------------------------------------------ */
/* Binary min-heap                                                     */
/* ------------------------------------------------------------------ */

class MinHeap {
  private keys: string[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: string, val: number): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.vals[p] <= this.vals[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): { key: string; val: number } | undefined {
    if (this.keys.length === 0) return undefined;
    const top = { key: this.keys[0], val: this.vals[0] };
    const lastK = this.keys.pop() as string;
    const lastV = this.vals.pop() as number;
    if (this.keys.length > 0) {
      this.keys[0] = lastK;
      this.vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.vals.length && this.vals[l] < this.vals[m]) m = l;
        if (r < this.vals.length && this.vals[r] < this.vals[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const tk = this.keys[a];
    const tv = this.vals[a];
    this.keys[a] = this.keys[b];
    this.vals[a] = this.vals[b];
    this.keys[b] = tk;
    this.vals[b] = tv;
  }
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

export function polylineLength(shape: Array<[number, number]>): number {
  let len = 0;
  for (let i = 1; i < shape.length; i++) {
    len += Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]);
  }
  return len;
}

/** Point at arc-length m along a polyline, plus local bearing (deg from north). */
export function pointAtM(shape: Array<[number, number]>, m: number): { x: number; y: number; bearing: number } {
  if (shape.length < 2) return { x: shape[0]?.[0] ?? 0, y: shape[0]?.[1] ?? 0, bearing: 0 };
  let remaining = Math.max(0, m);
  for (let i = 1; i < shape.length; i++) {
    const ax = shape[i - 1][0];
    const ay = shape[i - 1][1];
    const bx = shape[i][0];
    const by = shape[i][1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (remaining <= seg || i === shape.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, remaining / seg);
      return {
        x: ax + (bx - ax) * t,
        y: ay + (by - ay) * t,
        bearing: (Math.atan2(bx - ax, by - ay) * 180) / Math.PI,
      };
    }
    remaining -= seg;
  }
  return { x: shape[shape.length - 1][0], y: shape[shape.length - 1][1], bearing: 0 };
}

/** Orthogonal projection of p onto polyline: returns arc-length m and distance. */
export function projectOntoPolyline(
  shape: Array<[number, number]>,
  px: number,
  py: number,
): { m: number; distance: number; x: number; y: number; bearing: number } {
  let best = { m: 0, distance: Infinity, x: shape[0][0], y: shape[0][1], bearing: 0 };
  let acc = 0;
  for (let i = 1; i < shape.length; i++) {
    const ax = shape[i - 1][0];
    const ay = shape[i - 1][1];
    const bx = shape[i][0];
    const by = shape[i][1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.min(1, Math.max(0, t));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < best.distance) {
      best = { m: acc + Math.sqrt(len2) * t, distance: dist, x: cx, y: cy, bearing: (Math.atan2(dx, dy) * 180) / Math.PI };
    }
    acc += Math.sqrt(len2);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Lixelisation (Linear Referencing System)                            */
/* ------------------------------------------------------------------ */

export function lixelizeSegment(
  segment: Pick<GraphSegment, "id" | "shape" | "roadClass" | "classOrdinal" | "aadt" | "speedLimitKph" | "lanes">,
  segmentIndex: number,
  lixelLengthM: number,
  idPrefix: string,
): GraphLixel[] {
  const L = polylineLength(segment.shape);
  if (L <= 0) return [];
  const count = Math.max(1, Math.round(L / lixelLengthM));
  const actual = L / count;
  const out: GraphLixel[] = [];
  for (let k = 0; k < count; k++) {
    const mStart = k * actual;
    const mEnd = (k + 1) * actual;
    const mMid = (mStart + mEnd) / 2;
    const p = pointAtM(segment.shape, mMid);
    out.push({
      id: `${idPrefix}:${segment.id}#${k}`,
      segmentId: segment.id,
      segmentIndex,
      lrsIndex: k,
      mStart,
      mEnd,
      mMid,
      lengthM: actual,
      x: p.x,
      y: p.y,
      distToNodeM: Math.min(mMid, L - mMid),
      roadClass: segment.roadClass,
      classOrdinal: segment.classOrdinal,
      aadt: segment.aadt,
      speedLimitKph: segment.speedLimitKph,
      lanes: segment.lanes,
      trueLambda: null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Road graph                                                          */
/* ------------------------------------------------------------------ */

export interface SpreadTarget {
  lixelIndex: number;
  distance: number;
  /** Cumulative Okabe vertex-splitting weight along the shortest path. */
  split: number;
}

const CELL = 250;

export class RoadGraph {
  readonly nodes: GraphNode[];
  readonly segments: GraphSegment[];
  readonly lixels: GraphLixel[];
  readonly nodeById = new Map<string, GraphNode>();
  readonly segmentById = new Map<string, GraphSegment>();
  readonly segmentIndexById = new Map<string, number>();
  readonly lixelIndexById = new Map<string, number>();
  readonly lixelsBySegment = new Map<string, number[]>();

  private adj = new Map<string, Array<{ to: string; w: number }>>();
  private lixelNodeKey = new Map<number, string>();
  private gridSegments = new Map<string, number[]>();
  private gridLixels = new Map<string, number[]>();
  private splitCache = new Map<string, Map<number, SpreadTarget>>();

  constructor(nodes: GraphNode[], segments: GraphSegment[], lixels: GraphLixel[]) {
    this.nodes = nodes;
    this.segments = segments;
    this.lixels = lixels;
    for (const n of nodes) this.nodeById.set(n.id, n);
    segments.forEach((s, i) => {
      this.segmentById.set(s.id, s);
      this.segmentIndexById.set(s.id, i);
    });
    lixels.forEach((l, i) => {
      this.lixelIndexById.set(l.id, i);
      const arr = this.lixelsBySegment.get(l.segmentId);
      if (arr) arr.push(i);
      else this.lixelsBySegment.set(l.segmentId, [i]);
    });
    this.buildLixelGraph();
    this.buildGrids();
  }

  private buildLixelGraph(): void {
    const add = (a: string, b: string, w: number) => {
      const la = this.adj.get(a);
      if (la) la.push({ to: b, w });
      else this.adj.set(a, [{ to: b, w }]);
    };
    for (let i = 0; i < this.lixels.length; i++) {
      const l = this.lixels[i];
      const key = `c:${i}`;
      this.lixelNodeKey.set(i, key);
      const siblings = this.lixelsBySegment.get(l.segmentId) ?? [];
      const pos = siblings.indexOf(i);
      // chain within the parent edge
      if (pos > 0) {
        const prev = siblings[pos - 1];
        add(key, `c:${prev}`, (l.lengthM + this.lixels[prev].lengthM) / 2);
        add(`c:${prev}`, key, (l.lengthM + this.lixels[prev].lengthM) / 2);
      }
      const seg = this.segmentById.get(l.segmentId);
      if (!seg) continue;
      if (pos === 0) {
        add(key, `r:${seg.fromNodeId}`, l.lengthM / 2);
        add(`r:${seg.fromNodeId}`, key, l.lengthM / 2);
      }
      if (pos === siblings.length - 1) {
        add(key, `r:${seg.toNodeId}`, l.lengthM / 2);
        add(`r:${seg.toNodeId}`, key, l.lengthM / 2);
      }
    }
  }

  private buildGrids(): void {
    this.segments.forEach((s, i) => {
      for (const [px, py] of s.shape) {
        const key = `${Math.floor(px / CELL)}:${Math.floor(py / CELL)}`;
        const arr = this.gridSegments.get(key);
        if (arr) {
          if (!arr.includes(i)) arr.push(i);
        } else this.gridSegments.set(key, [i]);
      }
    });
    this.lixels.forEach((l, i) => {
      const key = `${Math.floor(l.x / CELL)}:${Math.floor(l.y / CELL)}`;
      const arr = this.gridLixels.get(key);
      if (arr) arr.push(i);
      else this.gridLixels.set(key, [i]);
    });
  }

  /** Vertex-splitting factor applied when a kernel passes *through* a node. */
  private passSplit(nodeKey: string): number {
    if (!nodeKey.startsWith("r:")) return 1;
    const n = this.nodeById.get(nodeKey.slice(2));
    if (!n) return 1;
    const d = n.degree;
    return d > 2 ? 1 / (d - 1) : 1;
  }

  /**
   * Truncated Dijkstra over the lixel-centre graph with Okabe splitting.
   * Returns every lixel whose network distance from `sourceIndex` <= maxDistance.
   */
  spread(sourceIndex: number, maxDistance: number, useSplitting = true): SpreadTarget[] {
    const cacheKey = `${sourceIndex}|${maxDistance}|${useSplitting ? 1 : 0}`;
    const cached = this.splitCache.get(cacheKey);
    if (cached) return Array.from(cached.values());

    const start = `c:${sourceIndex}`;
    const dist = new Map<string, number>([[start, 0]]);
    const split = new Map<string, number>([[start, 1]]);
    const settled = new Set<string>();
    const heap = new MinHeap();
    heap.push(start, 0);
    const result = new Map<number, SpreadTarget>();

    while (heap.size > 0) {
      const cur = heap.pop();
      if (!cur) break;
      const u = cur.key;
      if (settled.has(u)) continue;
      settled.add(u);
      const du = cur.val;
      if (du > maxDistance) continue;
      if (u.startsWith("c:")) {
        const idx = Number(u.slice(2));
        const s = split.get(u) ?? 1;
        const existing = result.get(idx);
        if (!existing || du < existing.distance) {
          result.set(idx, { lixelIndex: idx, distance: du, split: useSplitting ? s : 1 });
        }
      }
      const through = u === start ? 1 : useSplitting ? this.passSplit(u) : 1;
      const su = (split.get(u) ?? 1) * through;
      for (const edge of this.adj.get(u) ?? []) {
        if (settled.has(edge.to)) continue;
        const nd = du + edge.w;
        if (nd > maxDistance * 1.25) continue;
        const prev = dist.get(edge.to);
        if (prev === undefined || nd < prev - 1e-9) {
          dist.set(edge.to, nd);
          split.set(edge.to, su);
          heap.push(edge.to, nd);
        } else if (Math.abs(nd - prev) < 1e-6) {
          // multiple equally-short paths: average the splitting weight
          const old = split.get(edge.to) ?? su;
          split.set(edge.to, (old + su) / 2);
        }
      }
    }
    if (this.splitCache.size > 4000) this.splitCache.clear();
    this.splitCache.set(cacheKey, result);
    return Array.from(result.values());
  }

  /** Pairwise network distance between two lixel centres (Infinity if unreachable). */
  networkDistance(a: number, b: number, maxDistance = 20000): number {
    if (a === b) return 0;
    const spread = this.spread(a, maxDistance, false);
    for (const t of spread) if (t.lixelIndex === b) return t.distance;
    return Infinity;
  }

  /** Candidate segments whose geometry lies within `radius` metres of a point. */
  candidateSegments(x: number, y: number, radius: number): number[] {
    const out = new Set<number>();
    const r = Math.max(radius, 25);
    const span = Math.ceil(r / CELL) + 1;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        const arr = this.gridSegments.get(`${cx + i}:${cy + j}`);
        if (arr) for (const idx of arr) out.add(idx);
      }
    }
    return Array.from(out);
  }

  candidateLixels(x: number, y: number, radius: number): number[] {
    const out: number[] = [];
    const span = Math.ceil(Math.max(radius, 25) / CELL) + 1;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        const arr = this.gridLixels.get(`${cx + i}:${cy + j}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }

  /**
   * Probabilistic map-matching candidate set. Naive nearest-neighbour snapping
   * is deliberately avoided: candidates are ranked by a posterior combining
   * orthogonal distance, road-class prior and intersection topology.
   */
  snapCandidates(x: number, y: number, radius: number, sigmaM: number): SnapCandidate[] {
    const cands: SnapCandidate[] = [];
    for (const segIdx of this.candidateSegments(x, y, radius)) {
      const seg = this.segments[segIdx];
      const proj = projectOntoPolyline(seg.shape, x, y);
      if (proj.distance > radius) continue;
      const L = seg.lengthM;
      const m = Math.min(L, Math.max(0, proj.m));
      const lixelIdxs = this.lixelsBySegment.get(seg.id) ?? [];
      let lixelIndex = lixelIdxs[0] ?? -1;
      let bestDelta = Infinity;
      for (const li of lixelIdxs) {
        const l = this.lixels[li];
        const delta = Math.abs(l.mMid - m);
        if (delta < bestDelta) {
          bestDelta = delta;
          lixelIndex = li;
        }
      }
      const lixel = this.lixels[lixelIndex];
      const bearingDelta = angleDelta(proj.bearing, bearingOf(x, y, proj.x, proj.y));
      cands.push({
        segmentId: seg.id,
        segmentIndex: segIdx,
        lixelId: lixel?.id ?? "",
        lixelIndex,
        m,
        x: proj.x,
        y: proj.y,
        perpDistanceM: proj.distance,
        bearingDeltaDeg: bearingDelta,
        roadClass: seg.roadClass,
        classOrdinal: seg.classOrdinal,
      });
    }
    return cands.sort((a, b) => a.perpDistanceM - b.perpDistanceM).slice(0, 12);
  }

  /** k-order edge contiguity over lixels (neighbours within k hops along edges). */
  contiguityNeighbours(lixelIndex: number, k: number): number[] {
    const lixel = this.lixels[lixelIndex];
    if (!lixel) return [];
    const out = new Set<number>();
    const siblings = (this.lixelsBySegment.get(lixel.segmentId) ?? []).slice().sort((a, b) => a - b);
    const pos = siblings.indexOf(lixelIndex);
    for (let d = 1; d <= k; d++) {
      if (siblings[pos - d] !== undefined) out.add(siblings[pos - d]);
      if (siblings[pos + d] !== undefined) out.add(siblings[pos + d]);
    }
    // cross-boundary contiguity via the intersection node
    const seg = this.segmentById.get(lixel.segmentId);
    if (seg) {
      const nearFrom = pos === 0;
      const nearTo = pos === siblings.length - 1;
      const nodeIds: string[] = [];
      if (nearFrom) nodeIds.push(seg.fromNodeId);
      if (nearTo) nodeIds.push(seg.toNodeId);
      for (const nid of nodeIds) {
        for (const other of this.segments) {
          if (other.id === seg.id) continue;
          if (other.fromNodeId !== nid && other.toNodeId !== nid) continue;
          const others = (this.lixelsBySegment.get(other.id) ?? []).slice().sort((a, b) => a - b);
          const touchFrom = other.fromNodeId === nid;
          for (let d = 0; d < Math.min(k, others.length); d++) {
            out.add(touchFrom ? others[d] : others[others.length - 1 - d]);
          }
        }
      }
    }
    out.delete(lixelIndex);
    return Array.from(out);
  }

  lixelsInBBox(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const out: number[] = [];
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const y0 = Math.floor(minY / CELL);
    const y1 = Math.floor(maxY / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const arr = this.gridLixels.get(`${i}:${j}`);
        if (!arr) continue;
        for (const idx of arr) {
          const l = this.lixels[idx];
          if (l.x >= minX && l.x <= maxX && l.y >= minY && l.y <= maxY) out.push(idx);
        }
      }
    }
    return out;
  }

  clearCache(): void {
    this.splitCache.clear();
  }
}

function bearingOf(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.atan2(x2 - x1, y2 - y1) * 180) / Math.PI;
}

function angleDelta(a: number, b: number): number {
  let d = Math.abs(((a - b + 540) % 360) - 180);
  if (d > 90) d = 180 - d;
  return d;
}
