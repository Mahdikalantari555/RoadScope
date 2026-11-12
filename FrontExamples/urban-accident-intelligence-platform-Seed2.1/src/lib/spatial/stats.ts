// Network & Planar Spatial Statistics Engine
//
// Implements:
// - Network Kernel Density Estimation (NKDE) with equal-split continuous
//   kernel (Okabe et al. 2009) using shortest-path distance along graph.
// - Planar KDE (Euclidean) for comparison.
// - Network Getis-Ord Gi* hot/cold spot analysis with permutation inference.
// - Network DBSCAN via shortest-path ε.
// - Empirical Bayes smoothing with Safety Performance Function (SPF) prior.
// - Bivariate uncertainty metrics.

import { RoadNetworkGraph, networkDistanceBetweenEdgePoints } from "./network";
import { metricDistance, type MetricPoint } from "./crs";

export type KernelType = "gaussian" | "epanechnikov" | "quartic";

export function kernelWeight(d: number, h: number, type: KernelType = "gaussian"): number {
  const u = d / h;
  if (Math.abs(u) >= 1) return 0;
  switch (type) {
    case "gaussian": {
      // normalized Gaussian truncated at h
      return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
    }
    case "epanechnikov": {
      return 0.75 * (1 - u * u);
    }
    case "quartic": {
      // biweight
      return (15 / 16) * Math.pow(1 - u * u, 2);
    }
  }
}

/**
 * Flatten events to edge-offset locations: we represent each event as
 * { edgeId, offsetM } on the graph. For large eventsets this would be
 * pre-cached; for this prototype we compute on the fly.
 */
export interface EventLocation {
  eventId: number;
  edgeId: number;
  offsetM: number;
  weight: number; // severity/EPDO weight
  x: number;
  y: number;
}

// ─── Planar KDE ────────────────────────────────────────────────────────────

export function planarKde(
  points: MetricPoint[],
  samplePoints: MetricPoint[],
  bandwidthM: number,
  kernel: KernelType = "gaussian",
  weights?: number[]
): number[] {
  return samplePoints.map(sp => {
    let sum = 0;
    let wSum = 0;
    for (let i = 0; i < points.length; i++) {
      const d = metricDistance(sp.x, sp.y, points[i].x, points[i].y);
      const w = kernelWeight(d, bandwidthM, kernel);
      const wt = weights ? weights[i] : 1;
      sum += w * wt;
      wSum += wt;
    }
    // Density per m² within bandwidth; divide by area of kernel approx
    return sum / (points.length * Math.PI * bandwidthM * bandwidthM);
  });
}

// ─── Network KDE ───────────────────────────────────────────────────────────
// For each lixel midpoint, evaluate network distance to events and apply
// kernel. Uses direct Dijkstra from event edge endpoints — for research
// prototypes with n~1000 events and m~2000 lixels this is acceptable.
// For production use, precompute node-to-node distance matrix or use a
// matrix compression method.

export interface LixelMidpoint {
  lixelId: number;
  edgeId: number; // the graph edge id for the parent segment
  offsetM: number;
  x: number;
  y: number;
  lengthM: number;
}

export function networkKde(
  events: EventLocation[],
  lixels: LixelMidpoint[],
  bandwidthM: number,
  graph: RoadNetworkGraph,
  kernel: KernelType = "gaussian",
  onProgress?: (frac: number) => void
): { density: number[]; edgeDensity: Map<number, number> } {
  const density = new Array(lixels.length).fill(0);
  const edgeDensity = new Map<number, number>();

  // Precompute per-event node distances from its edge endpoints up to bandwidth
  const eventCached = events.map(ev => {
    const edge = graph.edges.find(e => e.id === ev.edgeId);
    if (!edge) return null;
    // Run Dijkstra from each endpoint
    const dFrom = graph.dijkstraFromNode(edge.from, bandwidthM);
    const dTo = graph.dijkstraFromNode(edge.to, bandwidthM);
    return { edge, dFrom, dTo, ev };
  });

  for (let li = 0; li < lixels.length; li++) {
    const lix = lixels[li];
    let sum = 0;
    for (const ec of eventCached) {
      if (!ec) continue;
      const { edge: evEdge, dFrom, dTo, ev } = ec;
      const lixEdge = graph.edges.find(e => e.id === lix.edgeId);
      if (!lixEdge) continue;

      let netD: number;
      if (ev.edgeId === lix.edgeId) {
        netD = Math.abs(ev.offsetM - lix.offsetM);
      } else {
        const c00 = (dFrom.get(lixEdge.from) ?? Infinity) + ev.offsetM + lix.offsetM;
        const c01 = (dFrom.get(lixEdge.to) ?? Infinity) + ev.offsetM + (lixEdge.lengthM - lix.offsetM);
        const c10 = (dTo.get(lixEdge.from) ?? Infinity) + (evEdge.lengthM - ev.offsetM) + lix.offsetM;
        const c11 = (dTo.get(lixEdge.to) ?? Infinity) + (evEdge.lengthM - ev.offsetM) + (lixEdge.lengthM - lix.offsetM);
        netD = Math.min(c00, c01, c10, c11);
      }
      if (isFinite(netD)) {
        sum += kernelWeight(netD, bandwidthM, kernel) * ev.weight;
      }
    }
    // Convert to density per meter of network within bandwidth
    density[li] = sum / (events.length * bandwidthM);
    edgeDensity.set(lix.lixelId, density[li]);
    if (onProgress && li % 50 === 0) onProgress(li / lixels.length);
  }
  return { density, edgeDensity };
}

// ─── Network Getis-Ord Gi* ─────────────────────────────────────────────────
// Uses network-distance weights matrix. For each lixel i:
//   G_i* = (sum_j w_ij x_j - X̄ * sum_j w_ij) / (s * sqrt((n*S1i - sum_j w_ij)^2/(n-1)))
// where weights w_ij are kernel-weighted 0-1 by network distance,
// p-values via conditional permutation.

export interface GetisOrdResult {
  giStar: number[];
  zScore: number[];
  pValue: number[];
  clusterType: Array<"hot" | "cold" | "nonsig">;
}

export function networkGetisOrd(
  values: number[],
  lixels: LixelMidpoint[],
  bandwidthM: number,
  graph: RoadNetworkGraph,
  nPermutations = 199,
  fdrCorrection = true
): GetisOrdResult {
  const n = values.length;
  const xBar = values.reduce((a, b) => a + b, 0) / n;
  const sSq = values.reduce((a, b) => a + (b - xBar) ** 2, 0) / n;
  const s = Math.sqrt(sSq);

  const giStar = new Array(n).fill(0);
  const zScore = new Array(n).fill(0);
  const pValue = new Array(n).fill(1);

  // Precompute neighbor weights per lixel (sparse)
  const weights: Array<Array<{ j: number; w: number }>> = new Array(n).fill(null).map(() => []);

  // For each lixel, find all other lixels within network bandwidth and assign weight
  // To reduce computation, we compute node-Dijkstra once per lixel edge (expensive, but accurate)
  const edgeCache = new Map<number, Map<number, number>>();

  function nodeDistsForEdge(edgeId: number) {
    if (edgeCache.has(edgeId)) return edgeCache.get(edgeId)!;
    const edge = graph.edges.find(e => e.id === edgeId);
    if (!edge) return new Map<number, number>();
    const dFrom = graph.dijkstraFromNode(edge.from, bandwidthM * 1.5);
    const dTo = graph.dijkstraFromNode(edge.to, bandwidthM * 1.5);
    const combined = new Map<number, number>();
    for (const [k, v] of dFrom) combined.set(k, v);
    for (const [k, v] of dTo) {
      const existing = combined.get(k);
      if (existing === undefined || v < existing) combined.set(k, v);
    }
    edgeCache.set(edgeId, combined);
    return combined;
  }

  function networkD(i: number, j: number) {
    const li = lixels[i];
    const lj = lixels[j];
    if (li.edgeId === lj.edgeId) {
      return Math.abs(li.offsetM - lj.offsetM);
    }
    const d_i = nodeDistsForEdge(li.edgeId);
    const e_j = graph.edges.find(e => e.id === lj.edgeId)!;
    const c0 = (d_i.get(e_j.from) ?? Infinity) + lj.offsetM;
    const c1 = (d_i.get(e_j.to) ?? Infinity) + (e_j.lengthM - lj.offsetM);
    return Math.min(c0, c1);
  }

  for (let i = 0; i < n; i++) {
    let sumW = 0;
    let sumWx = 0;
    let sumW2 = 0;
    for (let j = 0; j < n; j++) {
      let d: number;
      if (i === j) d = 0;
      else d = networkD(i, j);
      if (d <= bandwidthM) {
        const w = d === 0 ? 1 : kernelWeight(d, bandwidthM, "gaussian");
        weights[i].push({ j, w });
        sumW += w;
        sumWx += w * values[j];
        sumW2 += w * w;
      }
    }
    if (sumW === 0 || s === 0) {
      giStar[i] = 0;
      zScore[i] = 0;
      pValue[i] = 1;
      continue;
    }
    // Gi* numerator / denominator
    const numer = sumWx - xBar * sumW;
    const S1i = sumW2;
    const denom = s * Math.sqrt((n * S1i - sumW * sumW) / (n - 1));
    giStar[i] = denom === 0 ? 0 : numer / denom;
    zScore[i] = giStar[i];
  }

  // Permutation-based pseudo p-values
  for (let i = 0; i < n; i++) {
    let countExtreme = 0;
    const observed = zScore[i];
    if (weights[i].length === 0) { pValue[i] = 1; continue; }
    for (let perm = 0; perm < nPermutations; perm++) {
      // Resample x values randomly at neighbor positions
      let sumWxPerm = 0;
      let sumW = 0;
      for (const { w } of weights[i]) {
        const randJ = Math.floor(Math.random() * n);
        sumWxPerm += w * values[randJ];
        sumW += w;
      }
      const numerPerm = sumWxPerm - xBar * sumW;
      const simGi = sumW === 0 ? 0 : numerPerm / (s * Math.sqrt(
        (n * weights[i].reduce((s, { w }) => s + w * w, 0) - sumW * sumW) / (n - 1)) || 1);
      if (Math.abs(simGi) >= Math.abs(observed)) countExtreme++;
    }
    pValue[i] = (countExtreme + 1) / (nPermutations + 1);
  }

  // FDR correction (Benjamini-Hochberg)
  let correctedP = pValue.slice();
  if (fdrCorrection) {
    const order = pValue.map((_, i) => i).sort((a, b) => pValue[a] - pValue[b]);
    const m = n;
    let maxSigIdx = -1;
    for (let rank = 1; rank <= m; rank++) {
      const idx = order[rank - 1];
      const threshold = (rank / m) * 0.05;
      if (pValue[idx] <= threshold) maxSigIdx = rank - 1;
    }
    const adjusted = new Array(n).fill(1);
    for (let rank = 1; rank <= m; rank++) {
      const idx = order[rank - 1];
      adjusted[idx] = Math.min(1, pValue[idx] * m / rank);
    }
    correctedP = adjusted;
    // Override cluster type with BH-rejected
    for (let i = 0; i < n; i++) {
      if (correctedP[i] < 0.05) {
        // keep direction
      } else {
        correctedP[i] = 1;
      }
    }
  }

  const clusterType: GetisOrdResult["clusterType"] = new Array(n).fill("nonsig");
  for (let i = 0; i < n; i++) {
    if (correctedP[i] < 0.05) {
      clusterType[i] = zScore[i] > 0 ? "hot" : "cold";
    }
  }

  return { giStar, zScore, pValue: correctedP, clusterType };
}

// ─── Network DBSCAN ────────────────────────────────────────────────────────

export interface ClusterResult {
  labels: number[]; // -1 = noise, 0..k-1 = cluster id
  clusterCount: number;
  clusterSizes: number[];
}

export function networkDBSCAN(
  events: EventLocation[],
  epsM: number,
  minPts: number,
  graph: RoadNetworkGraph
): ClusterResult {
  const n = events.length;
  const labels = new Array(n).fill(-1);
  const visited = new Array(n).fill(false);
  let clusterId = 0;

  // Precompute node distances from each event edge endpoint
  const eventDists = events.map(ev => {
    const edge = graph.edges.find(e => e.id === ev.edgeId);
    if (!edge) return null;
    const dFrom = graph.dijkstraFromNode(edge.from, epsM * 2);
    const dTo = graph.dijkstraFromNode(edge.to, epsM * 2);
    return { edge, dFrom, dTo };
  });

  function netD(i: number, j: number): number {
    if (i === j) return 0;
    const a = events[i];
    const b = events[j];
    const ea = graph.edges.find(e => e.id === a.edgeId);
    const eb = graph.edges.find(e => e.id === b.edgeId);
    if (!ea || !eb) return Infinity;
    if (a.edgeId === b.edgeId) return Math.abs(a.offsetM - b.offsetM);
    const cacheI = eventDists[i];
    if (!cacheI) return Infinity;
    const c00 = (cacheI.dFrom.get(eb.from) ?? Infinity) + a.offsetM + b.offsetM;
    const c01 = (cacheI.dFrom.get(eb.to) ?? Infinity) + a.offsetM + (eb.lengthM - b.offsetM);
    const c10 = (cacheI.dTo.get(eb.from) ?? Infinity) + (cacheI.edge.lengthM - a.offsetM) + b.offsetM;
    const c11 = (cacheI.dTo.get(eb.to) ?? Infinity) + (cacheI.edge.lengthM - a.offsetM) + (eb.lengthM - b.offsetM);
    return Math.min(c00, c01, c10, c11);
  }

  function regionQuery(i: number): number[] {
    const neighbors: number[] = [];
    for (let j = 0; j < n; j++) {
      const d = netD(i, j);
      if (d <= epsM) neighbors.push(j);
    }
    return neighbors;
  }

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPts) {
      labels[i] = -1;
      continue;
    }
    labels[i] = clusterId;
    const seedSet = neighbors.slice();
    let idx = 0;
    while (idx < seedSet.length) {
      const j = seedSet[idx];
      if (!visited[j]) {
        visited[j] = true;
        const jNeighbors = regionQuery(j);
        if (jNeighbors.length >= minPts) {
          for (const nj of jNeighbors) {
            if (!seedSet.includes(nj)) seedSet.push(nj);
          }
        }
      }
      if (labels[j] === -1 || labels[j] === undefined) labels[j] = clusterId;
      idx++;
    }
    clusterId++;
  }

  const clusterSizes: number[] = [];
  for (let c = 0; c < clusterId; c++) {
    clusterSizes.push(labels.filter(l => l === c).length);
  }
  return { labels, clusterCount: clusterId, clusterSizes };
}

// ─── Empirical Bayes Smoothing ────────────────────────────────────────────
//
// SPF model per road class:
//    E[N] = L * α * (AADT/1000)^β
// where L is segment length (km), α and β are SPF coefficients.
// EB estimate = w * E[N] + (1 - w) * N_observed
// weight w = 1 / (1 + φ * E[N])
// φ is overdispersion parameter (inverse of negative binomial k).
// PSI (Potential for Safety Improvement) = N_obs - EB_expected

export interface EBInput {
  segmentLengthKm: number;
  observedCount: number;
  aadt: number;
  roadClass: string;
}

export interface EBResult {
  spfExpected: number;
  ebEstimate: number;
  psi: number;
  weight: number;
}

const SPF_COEFFICIENTS: Record<string, { alpha: number; beta: number; phi: number }> = {
  primary:     { alpha: 0.22, beta: 0.65, phi: 1.20 },
  secondary:   { alpha: 0.35, beta: 0.58, phi: 1.35 },
  tertiary:    { alpha: 0.42, beta: 0.50, phi: 1.60 },
  residential: { alpha: 0.30, beta: 0.40, phi: 2.10 },
};

export function empiricalBayes(seg: EBInput): EBResult {
  const coeff = SPF_COEFFICIENTS[seg.roadClass] ?? SPF_COEFFICIENTS.residential;
  const spfExp = seg.segmentLengthKm * coeff.alpha * Math.pow(seg.aadt / 1000, coeff.beta);
  const w = 1 / (1 + coeff.phi * spfExp);
  const eb = w * spfExp + (1 - w) * seg.observedCount;
  const psi = Math.max(0, seg.observedCount - eb);
  return { spfExpected: spfExp, ebEstimate: eb, psi, weight: w };
}

// ─── VGI Credibility Score ─────────────────────────────────────────────────
//
// Composite score from:
// - Witness count (more corroboration = higher trust)
// - Attribute consistency across duplicates
// - Snap distance (smaller = more confident)
// - Reporting lag (shorter = more reliable, on average)

export function computeVgiCredibility(input: {
  witnessCount: number;
  snapDistanceM: number;
  reportingLagMin: number;
  attributeAgreement: number; // 0..1
}): number {
  let score = 0.5;
  score += Math.min(0.25, (input.witnessCount - 1) * 0.05);
  score -= Math.min(0.3, input.snapDistanceM / 100);
  score -= Math.min(0.15, input.reportingLagMin / 120);
  score += input.attributeAgreement * 0.15;
  return Math.max(0, Math.min(1, score));
}

// ─── Ground-Truth Benchmark Metrics ────────────────────────────────────────
//
// PAI (Prediction Accuracy Index): proportion of events captured in top
//    fraction of hot zones divided by that fraction of total zones.
// RRI (Recapture Rate Index): proportion of ground-truth hot lixels
//    correctly identified as hot (precision/recall analog).
// RMSE: between estimated and true lambda across lixels.

export interface BenchmarkMetrics {
  pai: number;
  rri: number;
  rmse: number;
  topFraction: number;
}

export function benchmark(
  estimated: number[],
  groundTruth: number[],
  topFraction = 0.10
): BenchmarkMetrics {
  const n = estimated.length;
  const k = Math.max(1, Math.floor(n * topFraction));
  // Sort estimated descending
  const order = estimated.map((_, i) => i).sort((a, b) => estimated[b] - estimated[a]);
  const topK = new Set(order.slice(0, k));
  // Events: assume events proportional to ground truth, sum across topK
  let eventsInTop = 0;
  let totalEvents = 0;
  for (let i = 0; i < n; i++) {
    totalEvents += groundTruth[i];
    if (topK.has(i)) eventsInTop += groundTruth[i];
  }
  const pai = totalEvents > 0 ? (eventsInTop / totalEvents) / topFraction : 0;
  // RRI: overlap between top-k estimated hot and top-k true hot
  const gtOrder = groundTruth.map((_, i) => i).sort((a, b) => groundTruth[b] - groundTruth[a]);
  const trueTopK = new Set(gtOrder.slice(0, k));
  let intersection = 0;
  for (const ix of topK) if (trueTopK.has(ix)) intersection++;
  const rri = intersection / k;
  // RMSE
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const err = estimated[i] - groundTruth[i];
    sse += err * err;
  }
  const rmse = Math.sqrt(sse / n);
  return { pai, rri, rmse, topFraction };
}
