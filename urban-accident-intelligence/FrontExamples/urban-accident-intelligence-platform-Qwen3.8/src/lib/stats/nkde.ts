/**
 * Network Kernel Density Estimation (NKDE) and its planar (Euclidean) counterfactual.
 *
 * NKDE (Okabe, Aoki & Satoh 2009; Okabe & Sugihara 2012):
 *
 *        λ̂_net(u) = Σ_j  w_j · K( d_N(u, v_j) / h ) / h  ·  Π_{v ∈ V(path)} 1/(deg(v)-1)
 *
 * with d_N the shortest-path distance on the lixel-centre graph. The product
 * term is the *equal-splitting* (discontinuous) correction that stops kernel
 * mass from accumulating at vertices, which is the principal source of
 * topological bias in naive planar KDE. An approximate boundary correction
 * divides by the local kernel coverage c(u) = Σ_k L_k K(d_N(u,k)/h)/h.
 *
 * Planar KDE:
 *        f̂_pla(u) = Σ_j w_j · K₂( ‖u - v_j‖ / h ) / h²
 * which ignores the network entirely and is retained solely as the reference
 * surface for quantifying planar distortion (US-4.1).
 */
import type { RoadGraph } from "@/lib/geo/graph";
import { pearson, rmse, spearman } from "@/lib/stats/common";

export type KernelName = "gaussian" | "epanechnikov" | "quartic" | "triangular" | "uniform";

export const KERNELS: Record<KernelName, { support: number; k: (u: number) => number; norm1d: number; norm2d: number }> = {
  gaussian: { support: 3, k: (u) => Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI), norm1d: 1, norm2d: 2 * Math.PI },
  epanechnikov: { support: 1, k: (u) => (u <= 1 ? 0.75 * (1 - u * u) : 0), norm1d: 1, norm2d: Math.PI },
  quartic: { support: 1, k: (u) => (u <= 1 ? (15 / 16) * Math.pow(1 - u * u, 2) : 0), norm1d: 1, norm2d: Math.PI },
  triangular: { support: 1, k: (u) => (u <= 1 ? 1 - Math.abs(u) : 0), norm1d: 1, norm2d: 2 * Math.PI },
  uniform: { support: 1, k: (u) => (u <= 1 ? 0.5 : 0), norm1d: 1, norm2d: Math.PI },
};

export interface WeightedPoint {
  lixelIndex: number;
  x: number;
  y: number;
  weight: number;
}

export interface NkdeParams {
  bandwidthM: number;
  kernel: KernelName;
  edgeCorrection: boolean;
  splitting: boolean;
}

export const DEFAULT_NKDE: NkdeParams = { bandwidthM: 320, kernel: "quartic", edgeCorrection: true, splitting: true };

export interface DensitySurface {
  values: Float64Array;
  unit: string;
  totalWeight: number;
  mean: number;
  max: number;
  nonZero: number;
  runtimeMs: number;
}

export function nkde(graph: RoadGraph, points: WeightedPoint[], params: Partial<NkdeParams> = {}): DensitySurface {
  const p: NkdeParams = { ...DEFAULT_NKDE, ...params };
  const t0 = Date.now();
  const h = Math.max(20, p.bandwidthM);
  const kern = KERNELS[p.kernel];
  const n = graph.lixels.length;
  const raw = new Float64Array(n);
  const coverage = new Float64Array(n);
  const radius = h * kern.support;

  for (const pt of points) {
    if (pt.lixelIndex < 0 || pt.lixelIndex >= n) continue;
    for (const t of graph.spread(pt.lixelIndex, radius, p.splitting)) {
      const u = t.distance / h;
      if (u > kern.support) continue;
      raw[t.lixelIndex] += (pt.weight * kern.k(u) * t.split) / h;
    }
  }

  if (p.edgeCorrection) {
    for (let i = 0; i < n; i++) {
      const l = graph.lixels[i];
      let c = 0;
      for (const t of graph.spread(i, radius, p.splitting)) {
        const u = t.distance / h;
        if (u > kern.support) continue;
        c += (graph.lixels[t.lixelIndex].lengthM * kern.k(u) * t.split) / h;
      }
      coverage[i] = c;
    }
    for (let i = 0; i < n; i++) {
      if (coverage[i] > 1e-9) raw[i] = raw[i] / coverage[i];
    }
  }

  // per-metre -> per-kilometre of network
  const values = new Float64Array(n);
  let total = 0;
  let max = 0;
  let nonZero = 0;
  for (let i = 0; i < n; i++) {
    values[i] = raw[i] * 1000;
    total += values[i] * (graph.lixels[i].lengthM / 1000);
    if (values[i] > max) max = values[i];
    if (values[i] > 1e-12) nonZero++;
  }
  return {
    values,
    unit: "crashes · km⁻¹ (network-constrained)",
    totalWeight: points.reduce((s, p2) => s + p2.weight, 0),
    mean: n ? Array.from(values).reduce((a, b) => a + b, 0) / n : 0,
    max,
    nonZero,
    runtimeMs: Date.now() - t0,
  };
}

export interface PlanarParams {
  bandwidthM: number;
  kernel: KernelName;
}

/** Planar (Euclidean) KDE evaluated at lixel centroids — the bias reference. */
export function planarKde(graph: RoadGraph, points: WeightedPoint[], params: Partial<PlanarParams> = {}): DensitySurface {
  const p = { bandwidthM: 320, kernel: "quartic" as KernelName, ...params };
  const t0 = Date.now();
  const h = Math.max(20, p.bandwidthM);
  const kern = KERNELS[p.kernel];
  const radius = h * kern.support;
  const n = graph.lixels.length;
  const values = new Float64Array(n);

  // Uniform grid bucket index over raw observation coordinates.
  const cell = radius;
  const buckets = new Map<string, number[]>();
  points.forEach((pt, i) => {
    const key = `${Math.floor(pt.x / cell)}:${Math.floor(pt.y / cell)}`;
    const arr = buckets.get(key);
    if (arr) arr.push(i);
    else buckets.set(key, [i]);
  });

  for (let i = 0; i < n; i++) {
    const l = graph.lixels[i];
    const cx = Math.floor(l.x / cell);
    const cy = Math.floor(l.y / cell);
    let acc = 0;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const arr = buckets.get(`${gx}:${gy}`);
        if (!arr) continue;
        for (const pi of arr) {
          const pt = points[pi];
          const d = Math.hypot(l.x - pt.x, l.y - pt.y);
          const u = d / h;
          if (u > kern.support) continue;
          acc += (pt.weight * kern.k(u)) / (h * h * Math.PI);
        }
      }
    }
    values[i] = acc;
  }

  let max = 0;
  let nonZero = 0;
  for (let i = 0; i < n; i++) {
    if (values[i] > max) max = values[i];
    if (values[i] > 1e-15) nonZero++;
  }
  return {
    values,
    unit: "crashes · m⁻² (planar)",
    totalWeight: points.reduce((s, q) => s + q.weight, 0),
    mean: n ? Array.from(values).reduce((a, b) => a + b, 0) / n : 0,
    max,
    nonZero,
    runtimeMs: Date.now() - t0,
  };
}

export interface ComparisonStats {
  pearson: number;
  spearman: number;
  rmseStandardized: number;
  meanSignedDifference: number;
  intersectionOverestimationPct: number;
  corridorOverestimationPct: number;
  overestimatedLixels: number;
  underestimatedLixels: number;
  maxAbsDifference: number;
}

export function compareSurfaces(
  graph: RoadGraph,
  net: Float64Array,
  planar: Float64Array,
): { difference: Float64Array; stats: ComparisonStats } {
  const n = net.length;
  const normalize = (v: Float64Array) => {
    let max = 0;
    for (let i = 0; i < n; i++) if (v[i] > max) max = v[i];
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = max === 0 ? 0 : v[i] / max;
    return out;
  };
  const a = normalize(net);
  const b = normalize(planar);
  const difference = new Float64Array(n);
  for (let i = 0; i < n; i++) difference[i] = b[i] - a[i];

  const inter: number[] = [];
  const interNet: number[] = [];
  const corridor: number[] = [];
  let over = 0;
  let under = 0;
  let sumSigned = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    sumSigned += difference[i];
    if (Math.abs(difference[i]) > maxAbs) maxAbs = Math.abs(difference[i]);
    if (difference[i] > 0.01) over++;
    if (difference[i] < -0.01) under++;
    if (graph.lixels[i].distToNodeM < 30) {
      inter.push(b[i]);
      interNet.push(a[i]);
    } else {
      corridor.push(difference[i]);
    }
  }
  const meanOf = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
  const netArr = Array.from(a);
  const plaArr = Array.from(b);
  return {
    difference,
    stats: {
      pearson: pearson(netArr, plaArr),
      spearman: spearman(netArr, plaArr),
      rmseStandardized: rmse(netArr, plaArr),
      meanSignedDifference: sumSigned / Math.max(1, n),
      intersectionOverestimationPct: meanOf(inter) === 0 ? 0 : ((meanOf(inter) - meanOf(interNet)) / Math.max(1e-9, meanOf(interNet))) * 100,
      corridorOverestimationPct: meanOf(corridor) * 100,
      overestimatedLixels: over,
      underestimatedLixels: under,
      maxAbsDifference: maxAbs,
    },
  };
}
