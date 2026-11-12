/**
 * VGI quality engine: probabilistic topological map-matching and
 * spatiotemporal conflation with composite credibility scoring.
 *
 * Map-matching posterior (US-3.1)
 * -------------------------------
 *   P(e,m | z) ∝ N(d⊥ ; 0, σ²) · π_class(e) · τ_topo(d_node, category)
 *
 * where d⊥ is the orthogonal distance from the raw observation to the
 * candidate centreline, σ is the observation's declared/inferred positional
 * uncertainty, π_class is a road-class likelihood prior (proportional to the
 * generator's class risk × exposure, i.e. the prior probability that a crash
 * occurred there) and τ_topo rewards snaps near a junction when the reported
 * taxonomy has high intersection affinity. This avoids naive nearest-neighbour
 * snapping failures at overpasses, parallel carriageways and multi-leg nodes.
 *
 * Conflation (US-3.2)
 * -------------------
 *   K(i,j) = exp(-(d_net/Δd)²) · exp(-|Δt|/Δt*) · agreement(i,j)
 * Single-linkage union-find over K > θ produces witness clusters; a composite
 * credibility score is the weighted geometric mean of six auditable facets.
 */
import type { RoadGraph, SnapCandidate } from "@/lib/geo/graph";
import { CLASS_RISK } from "@/lib/sim/intensity";
import { categoryByCode } from "@/lib/domain/taxonomy";

export interface MatchParams {
  sigmaM: number;
  searchRadiusM: number;
  topologyWeight: number;
  classPriorWeight: number;
}

export const DEFAULT_MATCH_PARAMS: MatchParams = {
  sigmaM: 18,
  searchRadiusM: 140,
  topologyWeight: 0.35,
  classPriorWeight: 0.8,
};

export interface ScoredCandidate extends SnapCandidate {
  classPrior: number;
  topologyBonus: number;
  distanceLikelihood: number;
  posterior: number;
}

export interface MatchResult {
  candidates: ScoredCandidate[];
  chosenIndex: number;
  sigmaM: number;
  entropyNats: number;
  /** 1 - (p1 - p2): high values mean the snap is ambiguous (e.g. overpass). */
  ambiguity: number;
  chosen?: ScoredCandidate;
}

export function classPrior(roadClass: string, aadt: number | null): number {
  const base = CLASS_RISK[roadClass] ?? 0.8;
  const exposure = aadt && aadt > 0 ? Math.pow(aadt / 10000, 0.35) : 0.85;
  return base * exposure;
}

export function scoreSnapCandidates(
  graph: RoadGraph,
  x: number,
  y: number,
  categoryCode: string | null,
  params: Partial<MatchParams> = {},
): MatchResult {
  const p: MatchParams = { ...DEFAULT_MATCH_PARAMS, ...params };
  const sigma = Math.max(3, p.sigmaM);
  const raw = graph.snapCandidates(x, y, p.searchRadiusM, sigma);
  const affinity = categoryCode ? categoryByCode(categoryCode).intersectionAffinity : 0.5;

  const scored: ScoredCandidate[] = raw.map((c) => {
    const seg = graph.segmentById.get(c.segmentId);
    const cp = classPrior(c.roadClass, seg?.aadt ?? null);
    const dNode = seg ? Math.min(c.m, seg.lengthM - c.m) : 250;
    const topo = 1 + p.topologyWeight * affinity * Math.exp(-dNode / 45);
    const dl = Math.exp(-(c.perpDistanceM * c.perpDistanceM) / (2 * sigma * sigma));
    const bearingPenalty = 1 / (1 + Math.pow(Math.max(0, c.bearingDeltaDeg - 45) / 90, 2));
    return {
      ...c,
      classPrior: Math.pow(cp, p.classPriorWeight),
      topologyBonus: topo,
      distanceLikelihood: dl * bearingPenalty,
      posterior: 0,
    };
  });

  const total = scored.reduce((s, c) => s + c.distanceLikelihood * c.classPrior * c.topologyBonus, 0);
  if (total <= 0) {
    return { candidates: scored, chosenIndex: -1, sigmaM: sigma, entropyNats: 0, ambiguity: 1 };
  }
  for (const c of scored) c.posterior = (c.distanceLikelihood * c.classPrior * c.topologyBonus) / total;
  scored.sort((a, b) => b.posterior - a.posterior);

  let entropy = 0;
  for (const c of scored) if (c.posterior > 1e-12) entropy -= c.posterior * Math.log(c.posterior);
  const ambiguity = scored.length > 1 ? 1 - (scored[0].posterior - scored[1].posterior) : 1;

  return { candidates: scored, chosenIndex: 0, sigmaM: sigma, entropyNats: entropy, ambiguity, chosen: scored[0] };
}

/* ------------------------------------------------------------------ */
/* Spatiotemporal conflation                                           */
/* ------------------------------------------------------------------ */

export interface ConflationReport {
  id: string;
  x: number;
  y: number;
  lixelIndex: number;
  segmentId: string | null;
  occurredAt: number;
  severityCode: string;
  categoryCode: string | null;
  credibilityScore: number | null;
  status: string;
}

export interface ConflationParams {
  networkDistanceM: number;
  timeWindowMinutes: number;
  kernelThreshold: number;
}

export const DEFAULT_CONFLATION: ConflationParams = {
  networkDistanceM: 160,
  timeWindowMinutes: 120,
  kernelThreshold: 0.34,
};

export interface Cluster {
  id: string;
  memberIds: string[];
  canonicalId: string;
  meanNetworkDistanceM: number;
  timeRangeMinutes: number;
  severityAgreement: number;
  categoryAgreement: number;
  credibility: CredibilityBreakdown;
}

export interface CredibilityBreakdown {
  total: number;
  witnessAgreement: number;
  attributeConsistency: number;
  spatialProximity: number;
  temporalProximity: number;
  contributorReliability: number;
  reportAge: number;
}

export function kernelValue(
  dNet: number,
  dtMinutes: number,
  severityAgree: boolean,
  categoryAgree: boolean,
  p: ConflationParams,
): number {
  const spatial = Math.exp(-Math.pow(dNet / p.networkDistanceM, 2));
  const temporal = Math.exp(-Math.abs(dtMinutes) / p.timeWindowMinutes);
  const attribute = (severityAgree ? 1 : 0.45) * (categoryAgree ? 1 : 0.7);
  return spatial * temporal * attribute;
}

/**
 * Single-linkage clustering over the spatiotemporal network decay kernel.
 * Network distances come from the lixel-centre graph (shortest path), never
 * Euclidean circles.
 */
export function conflateReports(
  graph: RoadGraph,
  reports: ConflationReport[],
  params: Partial<ConflationParams> = {},
): Cluster[] {
  const p = { ...DEFAULT_CONFLATION, ...params };
  const n = reports.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    let c = i;
    while (parent[c] !== c) {
      const nx = parent[c];
      parent[c] = r;
      c = nx;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Bucket by lixel neighbourhood to keep the pairwise test O(n·k).
  const buckets = new Map<number, number[]>();
  reports.forEach((r, i) => {
    if (r.lixelIndex < 0) return;
    for (const t of graph.spread(r.lixelIndex, p.networkDistanceM * 1.2, false)) {
      const arr = buckets.get(t.lixelIndex);
      if (arr) arr.push(i);
      else buckets.set(t.lixelIndex, [i]);
    }
  });

  const pairSeen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const a = reports[i];
    if (a.lixelIndex < 0) continue;
    const neighbours = buckets.get(a.lixelIndex) ?? [];
    for (const j of neighbours) {
      if (j <= i) continue;
      const key = `${i}|${j}`;
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      const b = reports[j];
      const dt = Math.abs(a.occurredAt - b.occurredAt) / 60000;
      if (dt > p.timeWindowMinutes * 4) continue;
      const dNet = graph.networkDistance(a.lixelIndex, b.lixelIndex, p.networkDistanceM * 3);
      if (!Number.isFinite(dNet) || dNet > p.networkDistanceM * 2) continue;
      const k = kernelValue(dNet, dt, a.severityCode === b.severityCode, a.categoryCode === b.categoryCode, p);
      if (k >= p.kernelThreshold) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = groups.get(r);
    if (arr) arr.push(i);
    else groups.set(r, [i]);
  }

  const clusters: Cluster[] = [];
  let cid = 0;
  for (const [, members] of groups) {
    const memReports = members.map((i) => reports[i]);
    const sevCounts = new Map<string, number>();
    const catCounts = new Map<string, number>();
    for (const r of memReports) {
      sevCounts.set(r.severityCode, (sevCounts.get(r.severityCode) ?? 0) + 1);
      const c = r.categoryCode ?? "unknown";
      catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    }
    const severityAgreement = Math.max(...sevCounts.values()) / memReports.length;
    const categoryAgreement = Math.max(...catCounts.values()) / memReports.length;

    // Pairwise mean network distance within the cluster (bounded sample).
    let dSum = 0;
    let dCount = 0;
    const sample = members.slice(0, 8);
    for (let a = 0; a < sample.length; a++) {
      for (let b = a + 1; b < sample.length; b++) {
        const d = graph.networkDistance(reports[sample[a]].lixelIndex, reports[sample[b]].lixelIndex, 1200);
        if (Number.isFinite(d)) {
          dSum += d;
          dCount++;
        }
      }
    }
    const meanNet = dCount > 0 ? dSum / dCount : 0;
    const times = memReports.map((r) => r.occurredAt);
    const timeRangeMinutes = (Math.max(...times) - Math.min(...times)) / 60000;

    const canonical = memReports.reduce((best, r) => {
      const s = (r.credibilityScore ?? 45) + (r.status === "verified" ? 25 : 0) - r.occurredAt * 0;
      const bs = (best.credibilityScore ?? 45) + (best.status === "verified" ? 25 : 0);
      return s > bs ? r : best;
    }, memReports[0]);

    const credibility = computeCredibility({
      witnesses: memReports.length,
      severityAgreement,
      categoryAgreement,
      meanNetworkDistanceM: meanNet,
      timeRangeMinutes,
      meanPriorScore: memReports.reduce((s, r) => s + (r.credibilityScore ?? 45), 0) / memReports.length,
      oldestReportAgeHours: 0,
      params: p,
    });

    clusters.push({
      id: `CLU-${String(++cid).padStart(5, "0")}`,
      memberIds: memReports.map((r) => r.id),
      canonicalId: canonical.id,
      meanNetworkDistanceM: meanNet,
      timeRangeMinutes,
      severityAgreement,
      categoryAgreement,
      credibility,
    });
  }
  return clusters.sort((a, b) => b.memberIds.length - a.memberIds.length);
}

export function computeCredibility(input: {
  witnesses: number;
  severityAgreement: number;
  categoryAgreement: number;
  meanNetworkDistanceM: number;
  timeRangeMinutes: number;
  meanPriorScore: number;
  oldestReportAgeHours: number;
  params: ConflationParams;
}): CredibilityBreakdown {
  const witnessAgreement = Math.tanh((input.witnesses - 1) / 2.2);
  const attributeConsistency = 0.6 * input.severityAgreement + 0.4 * input.categoryAgreement;
  const spatialProximity = Math.exp(-input.meanNetworkDistanceM / input.params.networkDistanceM);
  const temporalProximity = Math.exp(-input.timeRangeMinutes / input.params.timeWindowMinutes);
  const contributorReliability = Math.min(1, Math.max(0, input.meanPriorScore / 100));
  const reportAge = Math.exp(-Math.max(0, input.oldestReportAgeHours) / 720);

  const weights = { w: 0.26, a: 0.22, s: 0.2, t: 0.12, c: 0.12, g: 0.08 };
  const eps = 0.02;
  const geo =
    Math.pow(Math.max(eps, witnessAgreement), weights.w) *
    Math.pow(Math.max(eps, attributeConsistency), weights.a) *
    Math.pow(Math.max(eps, spatialProximity), weights.s) *
    Math.pow(Math.max(eps, temporalProximity), weights.t) *
    Math.pow(Math.max(eps, contributorReliability), weights.c) *
    Math.pow(Math.max(eps, reportAge), weights.g);
  // Single-witness reports are capped: corroboration is required for high trust.
  const cap = input.witnesses === 1 ? 0.62 : 1;
  const total = Math.round(Math.min(cap, geo) * 1000) / 10;
  return {
    total,
    witnessAgreement: round3(witnessAgreement),
    attributeConsistency: round3(attributeConsistency),
    spatialProximity: round3(spatialProximity),
    temporalProximity: round3(temporalProximity),
    contributorReliability: round3(contributorReliability),
    reportAge: round3(reportAge),
  };
}

export function round3(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}
