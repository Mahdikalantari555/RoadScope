/**
 * Geospatial engine.
 *
 * Pure, dependency-free spatial mathematics operating in a local equirectangular
 * metric frame (see `metricOrigin`). At city extent (< 20 km) the distortion of
 * this projection relative to a proper local CRS such as EPSG:25832 is below
 * 0.1 %, which is far inside the positional accuracy of crowdsourced reports.
 *
 * In the PostGIS deployment these operations are pushed down to SQL
 * (ST_MakeValid, ST_SnapToGrid, ST_ClusterDBSCAN, ST_KNN). The module keeps the
 * same function signatures so the swap is a transport change only.
 */

import type {
  AnalysisGrid,
  ClusterResult,
  DbscanResult,
  GridCell,
  Position,
  RoadSegment,
} from "./types";

export const metricOrigin = { lon: 13.412, lat: 52.5145 };

const R = 6371008.8;
const DEG = Math.PI / 180;

/** Great-circle distance in metres (WGS84 sphere). */
export function haversineM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const la1 = aLat * DEG;
  const la2 = bLat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** WGS84 lon/lat -> local metric frame (metres east/north of `metricOrigin`). */
export function project(lon: number, lat: number, origin = metricOrigin): [number, number] {
  const x = (lon - origin.lon) * DEG * R * Math.cos(origin.lat * DEG);
  const y = (lat - origin.lat) * DEG * R;
  return [x, y];
}

/** Local metric frame -> WGS84 lon/lat. */
export function unproject(x: number, y: number, origin = metricOrigin): [number, number] {
  const lon = origin.lon + (x / (R * Math.cos(origin.lat * DEG))) / DEG;
  const lat = origin.lat + y / R / DEG;
  return [lon, lat];
}

export function euclideanM(
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
  origin = metricOrigin,
): number {
  const [ax, ay] = project(aLon, aLat, origin);
  const [bx, by] = project(bLon, bLat, origin);
  return Math.hypot(ax - bx, ay - by);
}

export interface SpatialPoint {
  id: number;
  lon: number;
  lat: number;
  weight: number;
}

export function bboxOf(points: { lon: number; lat: number }[]): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  if (!points.length) return { minLon: 13.368, minLat: 52.4925, maxLon: 13.456, maxLat: 52.5365 };
  return { minLon, minLat, maxLon, maxLat };
}

// ---------------------------------------------------------------------------
// Regular analysis lattice
// ---------------------------------------------------------------------------

export function buildGrid(
  points: { lon: number; lat: number }[],
  cellSizeM: number,
  padCells = 1,
): { grid: Omit<AnalysisGrid, "cells" | "statistics">; counts: number[]; sums: number[] } {
  const b = bboxOf(points);
  const [minX, minY] = project(b.minLon, b.minLat);
  const [maxX, maxY] = project(b.maxLon, b.maxLat);
  const nx = Math.max(2, Math.ceil((maxX - minX) / cellSizeM) + padCells * 2);
  const ny = Math.max(2, Math.ceil((maxY - minY) / cellSizeM) + padCells * 2);
  const ox = minX - padCells * cellSizeM;
  const oy = minY - padCells * cellSizeM;
  const counts = new Array<number>(nx * ny).fill(0);
  const sums = new Array<number>(nx * ny).fill(0);
  for (const p of points) {
    const [x, y] = project(p.lon, p.lat);
    const i = Math.floor((x - ox) / cellSizeM);
    const j = Math.floor((y - oy) / cellSizeM);
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
    const k = j * nx + i;
    counts[k] += 1;
    sums[k] += (p as { weight?: number }).weight ?? 1;
  }
  return {
    grid: {
      cellSizeM,
      minLon: b.minLon,
      minLat: b.minLat,
      maxLon: b.maxLon,
      maxLat: b.maxLat,
      nx,
      ny,
    },
    counts,
    sums,
  };
}

function cellCentre(
  g: Omit<AnalysisGrid, "cells" | "statistics">,
  i: number,
  j: number,
): { lon: number; lat: number } {
  const b = bboxOf([{ lon: g.minLon, lat: g.minLat }, { lon: g.maxLon, lat: g.maxLat }]);
  const [minX, minY] = project(b.minLon, b.minLat);
  const ox = minX - g.cellSizeM;
  const oy = minY - g.cellSizeM;
  const [lon, lat] = unproject(ox + (i + 0.5) * g.cellSizeM, oy + (j + 0.5) * g.cellSizeM);
  return { lon, lat };
}

// ---------------------------------------------------------------------------
// 1. Kernel Density Estimation (Gaussian, adaptive lattice)
// ---------------------------------------------------------------------------

export interface KdeOptions {
  bandwidthM: number;
  cellSizeM: number;
  /** 'uniform' weights every event; 'severity' weights by severity weight. */
  weighting: "uniform" | "severity";
  /** Normalisation: 'density' -> events per km², 'index' -> 0..1 relative. */
  normalisation: "density" | "index";
}

export interface KdeResult {
  grid: AnalysisGrid;
  params: KdeOptions;
  statistics: Record<string, number>;
}

export function kernelDensity(
  points: SpatialPoint[],
  opts: KdeOptions,
): KdeResult {
  const h = Math.max(20, opts.bandwidthM);
  const weights = opts.weighting === "severity" ? points.map((p) => p.weight) : points.map(() => 1);
  const { grid: g, sums } = buildGrid(points, opts.cellSizeM);
  const cells: GridCell[] = [];
  const peak = 2 / (Math.PI * h * h);

  // Project all points once.
  const proj = points.map((p) => project(p.lon, p.lat));
  const b = bboxOf([{ lon: g.minLon, lat: g.minLat }, { lon: g.maxLon, lat: g.maxLat }]);
  const [minX, minY] = project(b.minLon, b.minLat);
  const ox = minX - g.cellSizeM;
  const oy = minY - g.cellSizeM;

  const cutoff = 3 * h;
  let maxVal = 0;
  let sumVal = 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const cx = ox + (i + 0.5) * g.cellSizeM;
      const cy = oy + (j + 0.5) * g.cellSizeM;
      let v = 0;
      for (let n = 0; n < proj.length; n++) {
        const dx = proj[n][0] - cx;
        if (dx > cutoff || dx < -cutoff) continue;
        const dy = proj[n][1] - cy;
        if (dy > cutoff || dy < -cutoff) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > cutoff * cutoff) continue;
        v += weights[n] * peak * Math.exp(-d2 / (2 * h * h));
      }
      // intensity per km²
      const perKm2 = v * 1e6;
      if (perKm2 > maxVal) maxVal = perKm2;
      sumVal += perKm2;
      const c = cellCentre(g, i, j);
      cells.push({
        i,
        j,
        lon: c.lon,
        lat: c.lat,
        value: perKm2,
        count: sums[j * g.nx + i],
      });
    }
  }
  if (opts.normalisation === "index") {
    for (const c of cells) c.value = maxVal > 0 ? c.value / maxVal : 0;
  }
  return {
    grid: {
      ...g,
      cells,
      statistics: {
        bandwidthM: h,
        cellSizeM: opts.cellSizeM,
        peakDensityPerKm2: maxVal,
        meanDensityPerKm2: cells.length ? sumVal / cells.length : 0,
        pointCount: points.length,
        cellCount: cells.length,
      },
    },
    params: opts,
    statistics: {
      bandwidthM: h,
      peakDensityPerKm2: maxVal,
      meanDensityPerKm2: cells.length ? sumVal / cells.length : 0,
      points: points.length,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. DBSCAN (density-based spatial clustering of applications with noise)
// ---------------------------------------------------------------------------

export function dbscan(points: SpatialPoint[], epsM: number, minPts: number): DbscanResult {
  const n = points.length;
  const proj = points.map((p) => project(p.lon, p.lat));
  const labels = new Array<number>(n).fill(-2); // -2 undefined, -1 noise
  let clusterId = 0;

  // Uniform grid index to keep neighbourhood queries near-linear.
  const cellSize = Math.max(1, epsM);
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
  proj.forEach((p, idx) => {
    const k = key(p[0], p[1]);
    const arr = buckets.get(k);
    if (arr) arr.push(idx);
    else buckets.set(k, [idx]);
  });

  const regionQuery = (idx: number): number[] => {
    const [x, y] = proj[idx];
    const ci = Math.floor(x / cellSize);
    const cj = Math.floor(y / cellSize);
    const out: number[] = [];
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const arr = buckets.get(`${ci + a}:${cj + b}`);
        if (!arr) continue;
        for (const j of arr) {
          if (Math.hypot(proj[j][0] - x, proj[j][1] - y) <= epsM) out.push(j);
        }
      }
    }
    return out;
  };

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    const neighbours = regionQuery(i);
    if (neighbours.length < minPts) {
      labels[i] = -1;
      continue;
    }
    labels[i] = clusterId;
    const seedSet = [...neighbours];
    for (let s = 0; s < seedSet.length; s++) {
      const q = seedSet[s];
      if (labels[q] === -1) labels[q] = clusterId;
      if (labels[q] !== -2) continue;
      labels[q] = clusterId;
      const qn = regionQuery(q);
      if (qn.length >= minPts) {
        for (const x of qn) if (!seedSet.includes(x)) seedSet.push(x);
      }
    }
    clusterId++;
  }

  const byCluster = new Map<number, number[]>();
  const noise: number[] = [];
  labels.forEach((l, idx) => {
    if (l < 0) noise.push(idx);
    else {
      const arr = byCluster.get(l);
      if (arr) arr.push(idx);
      else byCluster.set(l, [idx]);
    }
  });

  const clusters: ClusterResult[] = [];
  for (const [id, members] of byCluster) {
    let sx = 0,
      sy = 0,
      slon = 0,
      slat = 0,
      maxD = 0;
    const severityMix: Record<string, number> = {};
    for (const m of members) {
      sx += proj[m][0];
      sy += proj[m][1];
      slon += points[m].lon;
      slat += points[m].lat;
    }
    const cx = sx / members.length;
    const cy = sy / members.length;
    for (const m of members) {
      maxD = Math.max(maxD, Math.hypot(proj[m][0] - cx, proj[m][1] - cy));
    }
    clusters.push({
      clusterId: id,
      pointIds: members.map((m) => points[m].id),
      lon: slon / members.length,
      lat: slat / members.length,
      centroidLon: slon / members.length,
      centroidLat: slat / members.length,
      size: members.length,
      radiusM: maxD,
      severityMix,
    });
  }
  clusters.sort((a, b) => b.size - a.size);

  return {
    clusters,
    noise,
    labels,
    params: { epsM, minPts },
    statistics: {
      clusterCount: clusters.length,
      noiseCount: noise.length,
      clusteredRatio: n ? (n - noise.length) / n : 0,
      largestCluster: clusters[0]?.size ?? 0,
      points: n,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Getis-Ord Gi* (hotspot analysis) on the analysis lattice
// ---------------------------------------------------------------------------

function normCdf(z: number): number {
  // Abramowitz & Stegun 26.2.17 approximation of the standard normal CDF.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

export interface GiStarOptions {
  bandM: number;
  cellSizeM: number;
  /** Benjamini-Hochberg FDR correction for multiple testing. */
  fdr: boolean;
  valueSource: "count" | "severity_weighted";
}

export function giStar(points: SpatialPoint[], opts: GiStarOptions) {
  const weights = opts.valueSource === "severity_weighted" ? points.map((p) => p.weight) : points.map(() => 1);
  const { grid: g, sums } = buildGrid(points, opts.cellSizeM);
  const b = bboxOf([{ lon: g.minLon, lat: g.minLat }, { lon: g.maxLon, lat: g.maxLat }]);
  const [minX, minY] = project(b.minLon, b.minLat);
  const ox = minX - g.cellSizeM;
  const oy = minY - g.cellSizeM;

  // Assign weighted values to cells.
  const values = new Array<number>(g.nx * g.ny).fill(0);
  points.forEach((p, n) => {
    const [x, y] = project(p.lon, p.lat);
    const i = Math.floor((x - ox) / opts.cellSizeM);
    const j = Math.floor((y - oy) / opts.cellSizeM);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return;
    values[j * g.nx + i] += weights[n];
  });

  const N = values.length;
  const mean = values.reduce((a, b2) => a + b2, 0) / N;
  const sd = Math.sqrt(values.reduce((a, b2) => a + (b2 - mean) ** 2, 0) / N);
  const band = Math.max(opts.cellSizeM, opts.bandM);
  const radiusCells = Math.ceil(band / opts.cellSizeM);
  const band2 = band * band;

  const cells: GridCell[] = [];
  const raw: { p: number; z: number }[] = [];

  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      let sumW = 0;
      let sumW2 = 0;
      let sumWx = 0;
      let neighbours = 0;
      for (let dj = -radiusCells; dj <= radiusCells; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= g.ny) continue;
        for (let di = -radiusCells; di <= radiusCells; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= g.nx) continue;
          const d2 = (di * opts.cellSizeM) ** 2 + (dj * opts.cellSizeM) ** 2;
          if (d2 > band2) continue;
          const w = 1;
          sumW += w;
          sumW2 += w * w;
          sumWx += w * values[jj * g.nx + ii];
          neighbours++;
        }
      }
      const xBar = mean;
      const S = sd || 1e-9;
      const numerator = sumWx - xBar * sumW;
      const denom = S * Math.sqrt((N * sumW2 - sumW * sumW) / (N - 1));
      const z = denom === 0 ? 0 : numerator / denom;
      const p = 2 * (1 - normCdf(Math.abs(z)));
      const c = cellCentre(g, i, j);
      cells.push({
        i,
        j,
        lon: c.lon,
        lat: c.lat,
        value: values[j * g.nx + i],
        count: sums[j * g.nx + i],
        zScore: z,
        pValue: p,
        significant: p < 0.05,
        neighbourCount: neighbours,
      });
      raw.push({ p, z });
    }
  }

  // Benjamini-Hochberg FDR at q = 0.05.
  if (opts.fdr && raw.length) {
    const order = raw.map((r, idx) => ({ ...r, idx })).sort((a, b2) => a.p - b2.p);
    const q = 0.05;
    let maxRank = 0;
    for (let r = 0; r < order.length; r++) {
      const threshold = ((r + 1) / order.length) * q;
      if (order[r].p <= threshold) maxRank = r + 1;
    }
    const fdrCut = maxRank > 0 ? order[maxRank - 1].p : 0;
    for (const c of cells) c.fdrThreshold = fdrCut;
    for (const c of cells) c.significant = maxRank > 0 && (c.pValue ?? 1) <= fdrCut;
  }

  const hot = cells.filter((c) => c.significant && (c.zScore ?? 0) > 0).length;
  const cold = cells.filter((c) => c.significant && (c.zScore ?? 0) < 0).length;

  return {
    grid: {
      ...g,
      cells,
      statistics: {
        cells: cells.length,
        hotCells: hot,
        coldCells: cold,
        mean,
        sd,
      },
    },
    params: opts,
    statistics: {
      cells: cells.length,
      hotCells: hot,
      coldCells: cold,
      meanCellCount: mean,
      sdCellCount: sd,
      bandM: band,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Nearest road-segment assignment & 5. segment aggregation
// ---------------------------------------------------------------------------

function distanceToSegmentM(
  lon: number,
  lat: number,
  a: Position,
  b: Position,
): number {
  const [px, py] = project(lon, lat);
  const [ax, ay] = project(a[0], a[1]);
  const [bx, by] = project(b[0], b[1]);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function nearestSegment(
  lon: number,
  lat: number,
  segments: RoadSegment[],
  maxDistanceM = 120,
): { segment: RoadSegment | null; distanceM: number } {
  let best: RoadSegment | null = null;
  let bestD = Infinity;
  for (const s of segments) {
    for (let k = 0; k < s.coordinates.length - 1; k++) {
      const d = distanceToSegmentM(lon, lat, s.coordinates[k], s.coordinates[k + 1]);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (bestD === 0) break;
  }
  return { segment: bestD <= maxDistanceM ? best : null, distanceM: bestD };
}

export interface SegmentAggregation {
  segmentId: number;
  count: number;
  severityWeighted: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  densityPerKm: number;
  meanPositionalAccuracy: number;
  verifiedRatio: number;
}

export function aggregateBySegment<
  T extends {
    roadSegmentId: number | null;
    severityCode: string;
    severityWeight: number;
    categoryCode: string;
    positionalAccuracyM: number;
    status: string;
  },
>(accidents: T[], segments: RoadSegment[]): Map<number, SegmentAggregation> {
  const out = new Map<number, SegmentAggregation>();
  const byId = new Map(segments.map((s) => [s.id, s]));
  for (const a of accidents) {
    if (a.roadSegmentId == null) continue;
    let rec = out.get(a.roadSegmentId);
    if (!rec) {
      const seg = byId.get(a.roadSegmentId);
      rec = {
        segmentId: a.roadSegmentId,
        count: 0,
        severityWeighted: 0,
        bySeverity: {},
        byCategory: {},
        densityPerKm: 0,
        meanPositionalAccuracy: 0,
        verifiedRatio: 0,
      };
      out.set(a.roadSegmentId, rec);
      if (seg) rec.densityPerKm = 0;
    }
    rec.count += 1;
    rec.severityWeighted += a.severityWeight;
    rec.bySeverity[a.severityCode] = (rec.bySeverity[a.severityCode] ?? 0) + 1;
    rec.byCategory[a.categoryCode] = (rec.byCategory[a.categoryCode] ?? 0) + 1;
    rec.meanPositionalAccuracy += a.positionalAccuracyM;
    if (a.status === "verified") rec.verifiedRatio += 1;
  }
  for (const [id, rec] of out) {
    const seg = byId.get(id);
    rec.meanPositionalAccuracy = rec.count ? rec.meanPositionalAccuracy / rec.count : 0;
    rec.verifiedRatio = rec.count ? rec.verifiedRatio / rec.count : 0;
    rec.densityPerKm = seg && seg.lengthM > 0 ? rec.count / (seg.lengthM / 1000) : rec.count;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statistic helpers used across the analytical views
// ---------------------------------------------------------------------------

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

/** Simple linear normalisation to 0..1 across an array. */
export function normalise(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!isFinite(min) || !isFinite(max) || max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}
