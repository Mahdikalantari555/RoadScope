/**
 * Network-constrained local spatial autocorrelation.
 *
 * Weights matrix W_net
 * --------------------
 *  (a) shortest-path distance decay:  w_ij = exp(-d_N(i,j)/h)  for d_N ≤ h
 *  (b) k-order edge contiguity:       w_ij = 1 for lixels within k topological
 *      hops along parent edges or across a shared intersection node
 * Both are built on the lixel-centre graph, so "neighbourhood" is a network
 * concept, never a Euclidean disc.
 *
 * Getis-Ord Gi* (Ord & Getis 1995), normal approximation:
 *
 *   Gi*ᵢ = ( Σⱼ w_ij xⱼ − x̄ Σⱼ w_ij ) / { S √[ n Σⱼ w²_ij − (Σⱼ w_ij)² ] / (n−1) }
 *
 * Pseudo p-values are obtained by global randomisation (permutation) of x for
 * the statistically salient candidate set, then Benjamini–Hochberg FDR
 * control is applied across all tested units. Assumptions (minimum sample,
 * variance positivity, neighbourhood sparsity) are checked before execution.
 */
import type { RoadGraph } from "@/lib/geo/graph";
import { bhFdr, mean, round, std } from "@/lib/stats/common";
import { Rng } from "@/lib/util/rng";

export type WeightMode = "distance_decay" | "contiguity";

export interface WeightsConfig {
  mode: WeightMode;
  bandwidthM?: number;
  k?: number;
  includeSelf?: boolean;
  minWeight?: number;
}

export interface UnitWeights {
  indices: number[];
  weights: number[];
  sumW: number;
  sumW2: number;
  count: number;
}

export function buildNetworkWeights(graph: RoadGraph, cfg: WeightsConfig): UnitWeights[] {
  const n = graph.lixels.length;
  const out: UnitWeights[] = new Array(n);
  const includeSelf = cfg.includeSelf ?? true;
  const minWeight = cfg.minWeight ?? 1e-4;
  if (cfg.mode === "contiguity") {
    const k = Math.max(1, cfg.k ?? 2);
    for (let i = 0; i < n; i++) {
      const nb = graph.contiguityNeighbours(i, k);
      const indices = includeSelf ? [i, ...nb] : nb;
      const weights = indices.map(() => 1);
      out[i] = summarize(indices, weights, minWeight);
    }
  } else {
    const h = Math.max(30, cfg.bandwidthM ?? 300);
    for (let i = 0; i < n; i++) {
      const indices: number[] = [];
      const weights: number[] = [];
      for (const t of graph.spread(i, h, false)) {
        if (!includeSelf && t.lixelIndex === i) continue;
        const w = Math.exp(-t.distance / h);
        if (w < minWeight) continue;
        indices.push(t.lixelIndex);
        weights.push(w);
      }
      out[i] = summarize(indices, weights, minWeight);
    }
  }
  return out;
}

function summarize(indices: number[], weights: number[], minWeight: number): UnitWeights {
  let sumW = 0;
  let sumW2 = 0;
  const fi: number[] = [];
  const fw: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    if (weights[i] < minWeight) continue;
    sumW += weights[i];
    sumW2 += weights[i] * weights[i];
    fi.push(indices[i]);
    fw.push(weights[i]);
  }
  return { indices: fi, weights: fw, sumW, sumW2, count: fi.length };
}

export interface AssumptionCheck {
  name: string;
  passed: boolean;
  detail: string;
  value: number;
}

export interface LocalResult {
  z: number[];
  pRaw: number[];
  qValue: number[];
  significant05: boolean[];
  significant01: boolean[];
  fdrRejected: boolean[];
  hotspots: number;
  coldspots: number;
  assumptions: AssumptionCheck[];
  globalMoranI: number;
  globalMoranP: number;
  globalMoranZ: number;
  permutationsUsed: number;
  candidateCount: number;
  runtimeMs: number;
  weightMode: WeightMode;
  n: number;
  meanNeighbours: number;
}

export interface LocalParams {
  permutations?: number;
  alpha?: number;
  seed?: number;
  candidateQuantile?: number;
  maxCandidates?: number;
  weightMode?: WeightMode;
  bandwidthM?: number;
  k?: number;
}

export function localGetisOrd(
  graph: RoadGraph,
  x: number[],
  weights: UnitWeights[],
  params: LocalParams = {},
): LocalResult {
  const t0 = Date.now();
  const n = x.length;
  const permutations = params.permutations ?? 999;
  const alpha = params.alpha ?? 0.05;
  const seed = params.seed ?? 42;
  const rng = new Rng(`gi:${seed}`);

  const xbar = mean(x);
  const S = std(x, true);
  const assumptions: AssumptionCheck[] = [];

  const nonZero = x.filter((v) => v > 0).length;
  assumptions.push({
    name: "minimum_sample_size",
    passed: n >= 30,
    value: n,
    detail: `n = ${n} linear units; the normal approximation for Gi* requires n ≥ 30 (Ord & Getis 1995).`,
  });
  assumptions.push({
    name: "variance_positivity",
    passed: S > 1e-12,
    value: round(S, 6),
    detail: S > 1e-12
      ? `S = ${round(S, 6)} — positive variance, statistic is defined.`
      : "S = 0 — the attribute is constant; Gi* is undefined (division by zero variance).",
  });
  const meanNb = mean(weights.map((w) => w.count));
  assumptions.push({
    name: "neighbourhood_sparsity",
    passed: meanNb >= 1 && meanNb < n * 0.5,
    value: round(meanNb, 3),
    detail: `Mean |N(i)| = ${round(meanNb, 2)} lixels. Values ≥ n/2 indicate a bandwidth so large that W_net degenerates to a global mean.`,
  });
  assumptions.push({
    name: "zero_inflation",
    passed: nonZero / Math.max(1, n) >= 0.02,
    value: round(nonZero / Math.max(1, n), 4),
    detail: `${nonZero}/${n} units carry a non-zero attribute (${round((nonZero / Math.max(1, n)) * 100, 1)}%). Extreme zero inflation inflates coldspot counts.`,
  });
  const isolated = weights.filter((w) => w.count <= (params.candidateQuantile ? 1 : 1)).length;
  assumptions.push({
    name: "isolated_units",
    passed: isolated / Math.max(1, n) < 0.25,
    value: isolated,
    detail: `${isolated} units have ≤1 network neighbour (graph articulation / cul-de-sac lixels).`,
  });

  const z = new Array<number>(n).fill(0);
  if (S <= 1e-12) {
    return {
      z,
      pRaw: new Array(n).fill(1),
      qValue: new Array(n).fill(1),
      significant05: new Array(n).fill(false),
      significant01: new Array(n).fill(false),
      fdrRejected: new Array(n).fill(false),
      hotspots: 0,
      coldspots: 0,
      assumptions,
      globalMoranI: 0,
      globalMoranP: 1,
      globalMoranZ: 0,
      permutationsUsed: 0,
      candidateCount: 0,
      runtimeMs: Date.now() - t0,
      weightMode: params.weightMode ?? "distance_decay",
      n,
      meanNeighbours: meanNb,
    };
  }

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (w.sumW === 0) continue;
    let num = 0;
    for (let k = 0; k < w.indices.length; k++) num += w.weights[k] * x[w.indices[k]];
    const denom = (S * Math.sqrt((n * w.sumW2 - w.sumW * w.sumW) / Math.max(1, n - 1))) || 1e-12;
    z[i] = (num - xbar * w.sumW) / denom;
  }

  /* -------- global Moran's I with permutation inference -------- */
  const W = weights.reduce((s, w) => s + w.sumW, 0);
  let moranNum = 0;
  let moranDen = 0;
  for (let i = 0; i < n; i++) moranDen += (x[i] - xbar) ** 2;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    let acc = 0;
    for (let k = 0; k < w.indices.length; k++) acc += w.weights[k] * (x[w.indices[k]] - xbar);
    moranNum += (x[i] - xbar) * acc;
  }
  const globalMoranI = moranDen === 0 || W === 0 ? 0 : (n / W) * (moranNum / moranDen);
  const EI = -1 / Math.max(1, n - 1);
  const permMoran: number[] = [];
  const permZ: number[] = [];
  const candidateQuantile = params.candidateQuantile ?? 0.9;
  const absZ = z.map((v) => Math.abs(v));
  const sortedAbs = absZ.slice().sort((a, b) => b - a);
  const cutoff = sortedAbs[Math.min(n - 1, Math.floor(n * (1 - candidateQuantile)))] ?? 0;
  const candidates = absZ.map((v, i) => ({ v, i })).filter((c) => c.v >= Math.max(1.64, cutoff)).map((c) => c.i);
  const maxCandidates = params.maxCandidates ?? 500;
  const candidateSet = candidates.slice(0, maxCandidates);

  const pRaw = new Array<number>(n).fill(1);
  const exceed = new Map<number, number>(candidateSet.map((i) => [i, 0]));
  const moranExceed = new Map<number, number>(candidateSet.map((i) => [i, 0]));

  for (let p = 0; p < permutations; p++) {
    const perm = rng.shuffle(x);
    const pbar = xbar;
    let pNum = 0;
    let pDen = 0;
    for (let i = 0; i < n; i++) pDen += (perm[i] - pbar) ** 2;
    for (const i of candidateSet) {
      const w = weights[i];
      let acc = 0;
      for (let k = 0; k < w.indices.length; k++) acc += w.weights[k] * perm[w.indices[k]];
      const denom = (S * Math.sqrt((n * w.sumW2 - w.sumW * w.sumW) / Math.max(1, n - 1))) || 1e-12;
      const zp = (acc - pbar * w.sumW) / denom;
      permZ.push(zp);
      if (Math.abs(zp) >= Math.abs(z[i])) exceed.set(i, (exceed.get(i) ?? 0) + 1);
    }
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      let acc = 0;
      for (let k = 0; k < w.indices.length; k++) acc += w.weights[k] * (perm[w.indices[k]] - pbar);
      pNum += (perm[i] - pbar) * acc;
    }
    const Ip = pDen === 0 || W === 0 ? 0 : (n / W) * (pNum / pDen);
    permMoran.push(Ip);
    void moranExceed;
  }

  const moranSd = std(permMoran, true) || 1e-12;
  const globalMoranZ = (globalMoranI - EI) / moranSd;
  const globalMoranP =
    (1 + permMoran.filter((v) => Math.abs(v - EI) >= Math.abs(globalMoranI - EI)).length) / (1 + permMoran.length);

  for (const i of candidateSet) {
    pRaw[i] = (1 + (exceed.get(i) ?? 0)) / (1 + permutations);
  }
  const fdr = bhFdr(pRaw, alpha);
  const significant05 = pRaw.map((p, i) => p < 0.05 && Math.abs(z[i]) > 0 && fdr.rejected[i]);
  const significant01 = pRaw.map((p, i) => p < 0.01 && fdr.rejected[i]);
  let hotspots = 0;
  let coldspots = 0;
  for (let i = 0; i < n; i++) {
    if (significant05[i]) {
      if (z[i] > 0) hotspots++;
      else coldspots++;
    }
  }

  return {
    z,
    pRaw,
    qValue: fdr.qValues,
    significant05,
    significant01,
    fdrRejected: fdr.rejected,
    hotspots,
    coldspots,
    assumptions,
    globalMoranI: round(globalMoranI, 6),
    globalMoranP: round(globalMoranP, 6),
    globalMoranZ: round(globalMoranZ, 4),
    permutationsUsed: permutations,
    candidateCount: candidateSet.length,
    runtimeMs: Date.now() - t0,
    weightMode: params.weightMode ?? "distance_decay",
    n,
    meanNeighbours: round(meanNb, 3),
  };
}

/** Covariate cross-comparison: local Moran's Iᵢ for a single attribute. */
export function localMoran(graph: RoadGraph, x: number[], weights: UnitWeights[], permutations = 499, seed = 7) {
  void graph;
  const n = x.length;
  const xbar = mean(x);
  const dev = x.map((v) => v - xbar);
  const m2 = dev.reduce((s, v) => s + v * v, 0) / Math.max(1, n);
  const Ii = new Array<number>(n).fill(0);
  if (m2 <= 1e-15) return { Ii, quadrants: new Array<string>(n).fill("ns"), pRaw: new Array(n).fill(1), m2 };
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    let acc = 0;
    for (let k = 0; k < w.indices.length; k++) acc += w.weights[k] * dev[w.indices[k]];
    Ii[i] = (dev[i] / m2) * acc;
  }
  const rng = new Rng(`moran:${seed}`);
  const exceed = new Array<number>(n).fill(0);
  for (let p = 0; p < permutations; p++) {
    const perm = rng.shuffle(dev);
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      let acc = 0;
      for (let k = 0; k < w.indices.length; k++) acc += w.weights[k] * perm[w.indices[k]];
      const Ip = (perm[i] / m2) * acc;
      if (Math.abs(Ip) >= Math.abs(Ii[i])) exceed[i]++;
    }
  }
  const pRaw = exceed.map((e) => (1 + e) / (1 + permutations));
  const quadrants = Ii.map((v, i) => {
    if (pRaw[i] > 0.05) return "ns";
    const nbAvg =
      weights[i].indices.reduce((s, j) => s + dev[j], 0) / Math.max(1, weights[i].indices.length);
    if (dev[i] > 0 && nbAvg > 0) return "HH";
    if (dev[i] < 0 && nbAvg < 0) return "LL";
    if (dev[i] > 0 && nbAvg <= 0) return "HL";
    return "LH";
  });
  return { Ii, quadrants, pRaw, m2 };
}
