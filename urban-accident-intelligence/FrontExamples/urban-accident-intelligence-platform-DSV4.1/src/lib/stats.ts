/**
 * Pure spatial-statistics helpers. No UI, no database — unit-testable.
 *
 * Implemented methods
 * -------------------
 * 1. Gaussian kernel density estimation (KDE) on a regular lattice with
 *    separable convolution and optional quadrat weights.
 * 2. Getis-Ord Gi* local statistic with normal approximation and a
 *    false-discovery-rate note (assumption checks returned with the result).
 * 3. DBSCAN density-based clustering with a uniform grid index.
 * 4. Descriptive summaries (quantiles, classification breaks, standardisation).
 */
import { type XY, pointToSegment } from "./geo";

/* ------------------------------------------------------------------ summary */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function variance(values: number[], sample = true): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const denom = sample ? values.length - 1 : values.length;
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / denom;
}

export function stdev(values: number[]): number {
  return Math.sqrt(variance(values));
}

export function quantile(sortedOrUnsorted: number[], q: number): number {
  if (sortedOrUnsorted.length === 0) return 0;
  const values = [...sortedOrUnsorted].sort((a, b) => a - b);
  const pos = (values.length - 1) * Math.min(1, Math.max(0, q));
  const base = Math.floor(pos);
  const rest = pos - base;
  if (values[base + 1] === undefined) return values[base];
  return values[base] + rest * (values[base + 1] - values[base]);
}

export function quantileBreaks(values: number[], classes: number): number[] {
  const breaks: number[] = [];
  for (let i = 1; i < classes; i += 1) breaks.push(quantile(values, i / classes));
  return breaks;
}

export function equalIntervalBreaks(min: number, max: number, classes: number): number[] {
  const step = (max - min) / classes;
  return Array.from({ length: classes - 1 }, (_, i) => min + step * (i + 1));
}

export function minMax(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

export function normalise(value: number, min: number, max: number): number {
  if (max - min === 0) return 0;
  return (value - min) / (max - min);
}

export function standardise(value: number, m: number, s: number): number {
  return s === 0 ? 0 : (value - m) / s;
}

export function gini(values: number[]): number {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return 0;
  const n = positive.length;
  const total = positive.reduce((s, v) => s + v, 0);
  let cumulative = 0;
  for (let i = 0; i < n; i += 1) cumulative += (i + 1) * positive[i];
  return (2 * cumulative) / (n * total) - (n + 1) / n;
}

/* ------------------------------------------------------------- distribution */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

export function twoTailedP(z: number): number {
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

/* --------------------------------------------------------------------- KDE */

export type Lattice = {
  minX: number;
  minY: number;
  cellSize: number;
  cols: number;
  rows: number;
  values: number[];
};

/**
 * Gaussian KDE on a regular grid in projected metres.
 * `points` must already be projected into the same metric space as `minX/minY`.
 * Weight support allows severity-weighted or exposure-normalised surfaces.
 */
export function gaussianKde(
  points: XY[],
  weights: number[],
  extent: { minX: number; minY: number; maxX: number; maxY: number },
  cellSize: number,
  bandwidth: number,
): Lattice {
  const cols = Math.max(1, Math.ceil((extent.maxX - extent.minX) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((extent.maxY - extent.minY) / cellSize) + 1);
  const counts = new Float64Array(cols * rows);
  for (let i = 0; i < points.length; i += 1) {
    const col = Math.round((points[i].x - extent.minX) / cellSize);
    const row = Math.round((points[i].y - extent.minY) / cellSize);
    if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
    counts[row * cols + col] += weights[i] ?? 1;
  }
  const radius = Math.max(1, Math.ceil((3 * bandwidth) / cellSize));
  const kernel = new Float64Array(radius * 2 + 1);
  let kernelSum = 0;
  for (let k = -radius; k <= radius; k += 1) {
    const v = Math.exp(-0.5 * ((k * cellSize) / bandwidth) ** 2);
    kernel[k + radius] = v;
    kernelSum += v;
  }
  const normaliser = 1 / (kernelSum * kernelSum);
  // separable convolution: rows then columns
  const tmp = new Float64Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const c = col + k;
        if (c < 0 || c >= cols) continue;
        acc += counts[row * cols + c] * kernel[k + radius];
      }
      tmp[row * cols + col] = acc;
    }
  }
  const out = new Float64Array(cols * rows);
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const r = row + k;
        if (r < 0 || r >= rows) continue;
        acc += tmp[r * cols + col] * kernel[k + radius];
      }
      out[row * cols + col] = acc * normaliser;
    }
  }
  return { minX: extent.minX, minY: extent.minY, cellSize, cols, rows, values: Array.from(out) };
}

/* -------------------------------------------------------------- Getis-Ord * */

export type GiStarResult = {
  index: number;
  gi: number;
  z: number;
  p: number;
  neighbours: number;
  classification: "hot_99" | "hot_95" | "hot_90" | "cold_90" | "cold_95" | "cold_99" | "not_significant" | "isolated";
};

export type GiStarSummary = {
  results: GiStarResult[];
  bandwidth: number;
  n: number;
  meanGi: number;
  sdGi: number;
  hotCount: number;
  coldCount: number;
  isolatedCount: number;
  assumptions: string[];
};

/**
 * Getis-Ord Gi* under complete spatial randomness.
 *
 * Binary, self-inclusive fixed-distance weights following Ord & Getis (1995):
 *   E[Gi*] = W_i · x̄
 *   Var[Gi*] = [W_i(n − W_i)/(n − 1)] · σ²   with population variance σ² of x
 * z = (Σ_j w_ij x_j − E) / sqrt(Var). When σ² = 0 the statistic is undefined and
 * z is reported as 0. Neighbours are selected with a fixed metric distance band.
 */
export function getisOrdGiStar(
  points: XY[],
  bandwidth: number,
  weights: number[] = points.map(() => 1),
): GiStarSummary {
  const n = points.length;
  const totalWeight = weights.reduce((s, v) => s + v, 0);
  const meanWeight = totalWeight / Math.max(1, n);
  const varianceWeight = weights.reduce((s, v) => s + (v - meanWeight) ** 2, 0) / Math.max(1, n);
  const cell = Math.max(bandwidth, 1);
  const grid = new Map<string, number[]>();
  points.forEach((p, index) => {
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  });

  const results: GiStarResult[] = [];
  for (let i = 0; i < n; i += 1) {
    const point = points[i];
    const cx = Math.floor(point.x / cell);
    const cy = Math.floor(point.y / cell);
    let localSum = 0;
    let wSum = 0;
    let neighbours = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          const d = Math.hypot(points[j].x - point.x, points[j].y - point.y);
          if (d <= bandwidth) {
            localSum += weights[j];
            wSum += 1;
            neighbours += 1;
          }
        }
      }
    }
    const expected = wSum * meanWeight;
    const variance = ((wSum * (n - wSum)) / Math.max(1, n - 1)) * varianceWeight;
    const sd = Math.sqrt(Math.max(variance, 0));
    const z = sd === 0 ? 0 : (localSum - expected) / sd;
    const pValue = twoTailedP(z);
    let classification: GiStarResult["classification"];
    if (neighbours <= 1) classification = "isolated";
    else if (z >= 2.576 && pValue <= 0.01) classification = "hot_99";
    else if (z >= 1.96 && pValue <= 0.05) classification = "hot_95";
    else if (z >= 1.645 && pValue <= 0.1) classification = "hot_90";
    else if (z <= -2.576) classification = "cold_99";
    else if (z <= -1.96) classification = "cold_95";
    else if (z <= -1.645) classification = "cold_90";
    else classification = "not_significant";
    results.push({ index: i, gi: localSum, z, p: pValue, neighbours, classification });
  }
  const hotCount = results.filter((r) => r.classification.startsWith("hot")).length;
  const coldCount = results.filter((r) => r.classification.startsWith("cold")).length;
  const isolatedCount = results.filter((r) => r.classification === "isolated").length;
  const expectedMean = meanWeight;
  return {
    results,
    bandwidth,
    n,
    meanGi: expectedMean,
    sdGi: stdev(results.map((r) => r.gi)),
    hotCount,
    coldCount,
    isolatedCount,
    assumptions: [
      `Binary fixed-distance weights within ${Math.round(bandwidth)} m (self-inclusive).`,
      `n = ${n} events; normal approximation requires n ≥ 30 and no global spatial autocorrelation in the null distribution.`,
      hotCount + coldCount > 0
        ? `${hotCount + coldCount} locations reach p ≤ 0.10. Cluster significance is a location-specific screen, not a causal finding; apply FDR control for confirmatory claims.`
        : "No location reaches p ≤ 0.10 at this bandwidth — descriptive concentration only.",
    ],
  };
}

/* ------------------------------------------------------------------ DBSCAN */

export type DbscanResult = {
  labels: Int32Array;
  clusterCount: number;
  noiseCount: number;
  clusters: { clusterId: number; size: number; centroid: XY }[];
};

/** DBSCAN (Ester et al. 1996) with a uniform grid index, eps in metres. */
export function dbscan(points: XY[], eps: number, minPts: number): DbscanResult {
  const n = points.length;
  const labels = new Int32Array(n).fill(-1); // -1 unvisited, 0 noise, >0 cluster
  const cell = Math.max(eps, 1);
  const grid = new Map<string, number[]>();
  const keyOf = (p: XY) => `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
  points.forEach((p, i) => {
    const k = keyOf(p);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  });
  const regionQuery = (p: XY): number[] => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    const found: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (Math.hypot(points[j].x - p.x, points[j].y - p.y) <= eps) found.push(j);
        }
      }
    }
    return found;
  };
  let clusterId = 0;
  for (let i = 0; i < n; i += 1) {
    if (labels[i] !== -1) continue;
    const neighbours = regionQuery(points[i]);
    if (neighbours.length < minPts) {
      labels[i] = 0;
      continue;
    }
    clusterId += 1;
    labels[i] = clusterId;
    const queue = neighbours.filter((j) => j !== i);
    for (let qi = 0; qi < queue.length; qi += 1) {
      const j = queue[qi];
      if (labels[j] === 0) labels[j] = clusterId;
      if (labels[j] !== -1) continue;
      labels[j] = clusterId;
      const jNeighbours = regionQuery(points[j]);
      if (jNeighbours.length >= minPts) queue.push(...jNeighbours);
    }
  }
  const clusters: DbscanResult["clusters"] = [];
  for (let c = 1; c <= clusterId; c += 1) {
    const members = points.filter((_, i) => labels[i] === c);
    if (members.length === 0) continue;
    clusters.push({
      clusterId: c,
      size: members.length,
      centroid: {
        x: members.reduce((s, p) => s + p.x, 0) / members.length,
        y: members.reduce((s, p) => s + p.y, 0) / members.length,
      },
    });
  }
  return {
    labels,
    clusterCount: clusters.length,
    noiseCount: labels.reduce((s, v) => s + (v === 0 ? 1 : 0), 0),
    clusters,
  };
}

/* --------------------------------------------------- segment-based helpers */

export type SegmentGeometry = { a: XY; b: XY };

export function assignNearestSegment(
  point: XY,
  segments: SegmentGeometry[],
): { index: number; distance: number } {
  let best = { index: -1, distance: Infinity };
  segments.forEach((seg, index) => {
    const d = pointToSegment(point, seg.a, seg.b).distance;
    if (d < best.distance) best = { index, distance: d };
  });
  return best;
}

/** Ripley's K and Besag's L for a single distance — descriptive clustering test. */
export function ripleysK(points: XY[], distance: number): { k: number; l: number; expected: number } {
  const n = points.length;
  if (n < 2) return { k: 0, l: 0, expected: 0 };
  const proj = points;
  const cell = Math.max(distance, 1);
  const grid = new Map<string, number[]>();
  proj.forEach((p, i) => {
    const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    const b = grid.get(k);
    if (b) b.push(i);
    else grid.set(k, [i]);
  });
  let pairs = 0;
  for (let i = 0; i < n; i += 1) {
    const cx = Math.floor(proj[i].x / cell);
    const cy = Math.floor(proj[i].y / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i) continue;
          if (Math.hypot(proj[j].x - proj[i].x, proj[j].y - proj[i].y) <= distance) pairs += 1;
        }
      }
    }
  }
  const area = Math.PI * distance ** 2;
  const k = (area * pairs) / (n * (n - 1));
  return { k, l: Math.sqrt(Math.max(k, 0) / Math.PI) - distance, expected: 0 };
}

/** Clark–Evans nearest-neighbour index of clustering (area in m²). */
export function clarkEvans(points: XY[], areaM2: number): { r: number; z: number; meanNearest: number; expected: number } {
  const n = points.length;
  if (n < 3 || areaM2 <= 0) return { r: 0, z: 0, meanNearest: 0, expected: 0 };
  const cell = Math.max(Math.sqrt(areaM2 / n) * 1.5, 25);
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    const b = grid.get(k);
    if (b) b.push(i);
    else grid.set(k, [i]);
  });
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    let nearest = Infinity;
    const cx = Math.floor(points[i].x / cell);
    const cy = Math.floor(points[i].y / cell);
    for (let radius = 0; radius <= 6 && nearest === Infinity; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const bucket = grid.get(`${cx + dx}:${cy + dy}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const d = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
            if (d < nearest) nearest = d;
          }
        }
      }
    }
    if (nearest !== Infinity) sum += nearest;
  }
  const meanNearest = sum / n;
  const expected = 0.5 / Math.sqrt(n / areaM2);
  const r = expected === 0 ? 0 : meanNearest / expected;
  const se = 0.26136 / Math.sqrt((n * n) / areaM2);
  const z = se === 0 ? 0 : (meanNearest - expected) / se;
  return { r, z, meanNearest, expected };
}
