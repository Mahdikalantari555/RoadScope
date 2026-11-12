import { describe, expect, it } from "vitest";
import { RoadGraph, lixelizeSegment, polylineLength } from "@/lib/geo/graph";
import type { GraphLixel, GraphNode, GraphSegment } from "@/lib/geo/graph";
import { DEFAULT_CONFLATION, computeCredibility, conflateReports, kernelValue, scoreSnapCandidates } from "@/lib/vgi/mapmatch";
import { bhFdr, diurnalMatrix, gini, pearson, quantile, spearman } from "@/lib/stats/common";
import { Rng } from "@/lib/util/rng";

function node(id: string, x: number, y: number, degree: number): GraphNode {
  return { id, x, y, degree, control: "none", nodeType: "intersection", isGradeSeparated: false };
}

function seg(id: string, a: GraphNode, b: GraphNode, roadClass: string, shape: Array<[number, number]>, classOrdinal: number): GraphSegment {
  const L = polylineLength(shape);
  return {
    id, fromNodeId: a.id, toNodeId: b.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, shape,
    lengthM: L, roadClass, classOrdinal, name: id, lanes: 2, speedLimitKph: 50, aadt: roadClass === "primary" ? 25000 : 2500,
    sinuosity: 1, curvaturePerKm: 0, lighting: "lit", surface: "asphalt", isBridge: false, sidewalk: true, cycleLane: false, vktPerDay: 0,
  };
}

/** Parallel carriageways 12 m apart — the classic naive-snap failure case. */
function parallelNetwork() {
  const n1 = node("A", 0, 0, 2);
  const n2 = node("B", 300, 0, 2);
  const n3 = node("C", 0, 12, 2);
  const n4 = node("D", 300, 12, 2);
  const primary = seg("P", n1, n2, "primary", [[0, 0], [300, 0]], 2);
  const service = seg("S", n3, n4, "service", [[0, 12], [300, 12]], 6);
  const lixels: GraphLixel[] = [];
  [primary, service].forEach((s, si) => {
    for (const l of lixelizeSegment(s as any, si, 25, "L")) lixels.push({ ...l, id: `L${lixels.length}` });
  });
  return new RoadGraph([n1, n2, n3, n4], [primary, service], lixels);
}

describe("probabilistic topological map-matching", () => {
  const graph = parallelNetwork();

  it("snaps an on-centreline point with near-zero residual", () => {
    const m = scoreSnapCandidates(graph, 150, 0.4, null, { sigmaM: 15 });
    expect(m.chosen?.segmentId).toBe("P");
    expect(m.chosen?.perpDistanceM).toBeLessThan(1);
    expect(m.chosen?.m).toBeCloseTo(150, 6);
  });

  it("does not blindly pick the nearest edge: class prior + topology reweight the posterior", () => {
    // 7 m from the service road, 5 m from the primary: geometry alone is ambiguous
    const m = scoreSnapCandidates(graph, 150, 7, "rear_end", { sigmaM: 20, classPriorWeight: 1.6 });
    expect(m.candidates.length).toBeGreaterThanOrEqual(2);
    const primary = m.candidates.find((c) => c.roadClass === "primary")!;
    const service = m.candidates.find((c) => c.roadClass === "service")!;
    expect(primary.classPrior).toBeGreaterThan(service.classPrior);
    expect(m.entropyNats).toBeGreaterThan(0);
    expect(m.ambiguity).toBeGreaterThan(0);
  });

  it("reports high ambiguity when two candidates are near-equidistant", () => {
    const m = scoreSnapCandidates(graph, 150, 6, null, { sigmaM: 30, classPriorWeight: 0, topologyWeight: 0 });
    expect(m.ambiguity).toBeGreaterThan(0.8);
  });

  it("posteriors form a valid probability distribution", () => {
    const m = scoreSnapCandidates(graph, 40, 3, "pedestrian_struck", { sigmaM: 18 });
    const sum = m.candidates.reduce((s, c) => s + c.posterior, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(m.candidates.every((c) => c.posterior >= 0 && c.posterior <= 1)).toBe(true);
  });

  it("returns no candidate when the observation is far from any centreline", () => {
    const m = scoreSnapCandidates(graph, 9000, 9000, null, { sigmaM: 18 });
    expect(m.chosenIndex).toBe(-1);
    expect(m.candidates).toHaveLength(0);
  });
});

describe("spatiotemporal conflation kernel", () => {
  it("decays with network distance and time gap", () => {
    const base = kernelValue(10, 1, true, true, DEFAULT_CONFLATION);
    expect(kernelValue(120, 1, true, true, DEFAULT_CONFLATION)).toBeLessThan(base);
    expect(kernelValue(10, 100, true, true, DEFAULT_CONFLATION)).toBeLessThan(base);
    expect(base).toBeLessThanOrEqual(1);
  });

  it("penalises attribute disagreement", () => {
    const agree = kernelValue(40, 10, true, true, DEFAULT_CONFLATION);
    const disagree = kernelValue(40, 10, false, false, DEFAULT_CONFLATION);
    expect(disagree).toBeLessThan(agree);
  });

  it("clusters duplicate witnesses and separates distinct incidents", () => {
    const graph = parallelNetwork();
    const lixelIndex = graph.lixelIndexById.get(graph.lixels.find((l) => l.mMid > 130 && l.mMid < 145)!.id)!;
    const t0 = Date.UTC(2025, 5, 10, 17, 30);
    const reports = [
      { id: "r1", x: 150, y: 0, lixelIndex, segmentId: "P", occurredAt: t0, severityCode: "serious_injury", categoryCode: "rear_end", credibilityScore: 60, status: "unverified" },
      { id: "r2", x: 152, y: 4, lixelIndex, segmentId: "P", occurredAt: t0 + 4 * 60000, severityCode: "serious_injury", categoryCode: "rear_end", credibilityScore: 55, status: "unverified" },
      { id: "r3", x: 148, y: -3, lixelIndex, segmentId: "P", occurredAt: t0 + 9 * 60000, severityCode: "serious_injury", categoryCode: "rear_end", credibilityScore: 50, status: "unverified" },
      { id: "r4", x: 10, y: 0, lixelIndex: 0, segmentId: "P", occurredAt: t0 + 3 * 3600000, severityCode: "property_damage", categoryCode: "sideswipe", credibilityScore: 40, status: "unverified" },
    ];
    const clusters = conflateReports(graph, reports, DEFAULT_CONFLATION);
    const big = clusters.find((c) => c.memberIds.length === 3);
    expect(big).toBeDefined();
    expect(big!.memberIds).toEqual(expect.arrayContaining(["r1", "r2", "r3"]));
    expect(clusters.find((c) => c.memberIds.includes("r4"))!.memberIds).toHaveLength(1);
    expect(big!.severityAgreement).toBe(1);
  });

  it("keeps grade-separated crossings apart: Euclidean 0 m, network unreachable", () => {
    // Two carriageways crossing at (200,0) with no shared node = an overpass.
    const w1 = node("W1", 0, 0, 1);
    const w2 = node("W2", 400, 0, 1);
    const n1 = node("N1", 200, -200, 1);
    const n2 = node("N2", 200, 200, 1);
    const east = seg("X", w1, w2, "primary", [[0, 0], [400, 0]], 2);
    const north = seg("Y", n1, n2, "motorway", [[200, -200], [200, 200]], 1);
    const lixels: GraphLixel[] = [];
    [east, north].forEach((s, si) => {
      for (const l of lixelizeSegment(s as any, si, 25, "L")) lixels.push({ ...l, id: `L${lixels.length}` });
    });
    const graph = new RoadGraph([w1, w2, n1, n2], [east, north], lixels);
    const onEast = lixels.findIndex((l) => l.segmentId === "X" && Math.abs(l.x - 212.5) < 1);
    const onNorth = lixels.findIndex((l) => l.segmentId === "Y" && Math.abs(l.y - 12.5) < 1);
    expect(onEast).toBeGreaterThan(0);
    expect(onNorth).toBeGreaterThan(0);
    expect(Math.hypot(lixels[onEast].x - lixels[onNorth].x, lixels[onEast].y - lixels[onNorth].y)).toBeLessThan(30);
    expect(graph.networkDistance(onEast, onNorth, 5000)).toBe(Infinity);
    const t0 = Date.UTC(2025, 5, 10, 8, 0);
    const reports = [
      { id: "a", x: lixels[onEast].x, y: lixels[onEast].y, lixelIndex: onEast, segmentId: "X", occurredAt: t0, severityCode: "minor_injury", categoryCode: "rear_end", credibilityScore: 50, status: "unverified" },
      { id: "b", x: lixels[onNorth].x, y: lixels[onNorth].y, lixelIndex: onNorth, segmentId: "Y", occurredAt: t0 + 60000, severityCode: "minor_injury", categoryCode: "rear_end", credibilityScore: 50, status: "unverified" },
    ];
    const clusters = conflateReports(graph, reports, { ...DEFAULT_CONFLATION, networkDistanceM: 100 });
    expect(clusters).toHaveLength(2);
  });
});

describe("VGI credibility scoring", () => {
  const base = {
    witnesses: 1, severityAgreement: 1, categoryAgreement: 1, meanNetworkDistanceM: 10,
    timeRangeMinutes: 5, meanPriorScore: 50, oldestReportAgeHours: 1, params: DEFAULT_CONFLATION,
  };
  it("is monotonic in witness count", () => {
    const one = computeCredibility(base).total;
    const three = computeCredibility({ ...base, witnesses: 3 }).total;
    const eight = computeCredibility({ ...base, witnesses: 8 }).total;
    expect(three).toBeGreaterThan(one);
    expect(eight).toBeGreaterThanOrEqual(three);
  });
  it("caps single-witness reports below corroborated ones", () => {
    expect(computeCredibility(base).total).toBeLessThan(62.1);
  });
  it("degrades with spatial and attribute disagreement", () => {
    const good = computeCredibility(base).total;
    const spread = computeCredibility({ ...base, witnesses: 4, meanNetworkDistanceM: 300 }).total;
    const conflict = computeCredibility({ ...base, witnesses: 4, severityAgreement: 0.25, categoryAgreement: 0.25 }).total;
    expect(spread).toBeLessThan(computeCredibility({ ...base, witnesses: 4 }).total);
    expect(conflict).toBeLessThan(good + 60);
  });
});

describe("statistical utilities", () => {
  it("Benjamini–Hochberg controls the false discovery rate", () => {
    const p = [0.001, 0.004, 0.02, 0.04, 0.3, 0.6, 0.9];
    const { qValues, rejected, kStar } = bhFdr(p, 0.05);
    expect(kStar).toBeGreaterThan(0);
    expect(rejected[0]).toBe(true);
    expect(rejected[6]).toBe(false);
    expect(qValues.every((q) => q >= 0 && q <= 1)).toBe(true);
    // q-values are monotone non-decreasing in p
    const ordered = p.map((_, i) => i).sort((a, b) => p[a] - p[b]).map((i) => qValues[i]);
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]).toBeGreaterThanOrEqual(ordered[i - 1] - 1e-12);
  });
  it("handles degenerate p-value vectors", () => {
    expect(bhFdr([], 0.05).kStar).toBe(0);
    expect(bhFdr([1, 1, 1], 0.05).rejected.every((r) => !r)).toBe(true);
  });
  it("computes rank correlations robustly with ties", () => {
    expect(spearman([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 9);
    expect(spearman([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 9);
  });
  it("quantiles and Gini behave on edge cases", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBe(0);
    expect(gini([1, 1, 1, 1])).toBeCloseTo(0, 9);
    expect(gini([0, 0, 0, 10])).toBeGreaterThan(0.7);
  });
  it("builds a 7x24 diurnal matrix", () => {
    const rng = new Rng(1);
    const ts = Array.from({ length: 500 }, () => Date.UTC(2025, 5, 1 + rng.int(0, 20), rng.int(0, 23), rng.int(0, 59)));
    const m = diurnalMatrix(ts, ts.map(() => 1));
    expect(m).toHaveLength(7);
    expect(m.every((row) => row.length === 24)).toBe(true);
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(500);
  });
});
