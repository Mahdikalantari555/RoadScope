import { describe, expect, it } from "vitest";
import { RoadGraph, lixelizeSegment, polylineLength } from "@/lib/geo/graph";
import type { GraphLixel, GraphNode, GraphSegment } from "@/lib/geo/graph";
import { KERNELS, compareSurfaces, nkde, planarKde } from "@/lib/stats/nkde";
import { buildNetworkWeights, localGetisOrd, localMoran } from "@/lib/stats/getisord";
import { convexHull, nDbScan } from "@/lib/stats/ndbscan";
import { aggregateUnits, compositeScore, empiricalBayes, fitSpf, spfPredict, uncertainty } from "@/lib/stats/risk";
import { evaluateAgainstGroundTruth } from "@/lib/stats/benchmark";
import { Rng } from "@/lib/util/rng";

function buildGrid(cols = 6, rows = 6, step = 120) {
  const nodes: GraphNode[] = [];
  const ids: string[][] = [];
  for (let j = 0; j <= rows; j++) {
    ids[j] = [];
    for (let i = 0; i <= cols; i++) {
      const id = `n${i}_${j}`;
      nodes.push({ id, x: i * step, y: j * step, degree: 0, control: "none", nodeType: "intersection", isGradeSeparated: false });
      ids[j][i] = id;
    }
  }
  const segments: GraphSegment[] = [];
  let k = 0;
  const push = (a: GraphNode, b: GraphNode, roadClass: string, classOrdinal: number) => {
    const shape: Array<[number, number]> = [[a.x, a.y], [b.x, b.y]];
    segments.push({
      id: `e${k++}`, fromNodeId: a.id, toNodeId: b.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, shape,
      lengthM: polylineLength(shape), roadClass, classOrdinal, name: `e${k}`, lanes: 2, speedLimitKph: 50,
      aadt: 4000 + k * 37, sinuosity: 1, curvaturePerKm: 0.1, lighting: "lit", surface: "asphalt",
      isBridge: false, sidewalk: true, cycleLane: false, vktPerDay: (4000 + k * 37) * (polylineLength(shape) / 1000),
    });
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) push(byId.get(ids[j][i])!, byId.get(ids[j][i + 1])!, i % 3 === 0 ? "primary" : "residential", i % 3 === 0 ? 2 : 5);
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) push(byId.get(ids[j][i])!, byId.get(ids[j + 1][i])!, j % 3 === 0 ? "secondary" : "residential", j % 3 === 0 ? 3 : 5);
  // degrees
  const deg = new Map<string, number>();
  for (const s of segments) {
    deg.set(s.fromNodeId, (deg.get(s.fromNodeId) ?? 0) + 1);
    deg.set(s.toNodeId, (deg.get(s.toNodeId) ?? 0) + 1);
  }
  for (const n of nodes) n.degree = deg.get(n.id) ?? 0;
  const lixels: GraphLixel[] = [];
  segments.forEach((s, si) => {
    for (const l of lixelizeSegment(s as any, si, 30, "L")) lixels.push({ ...l, id: `L${lixels.length}` });
  });
  return new RoadGraph(nodes, segments, lixels);
}

const graph = buildGrid();

describe("network KDE", () => {
  const rng = new Rng(7);
  const points = Array.from({ length: 120 }, () => {
    const idx = rng.int(0, graph.lixels.length - 1);
    const l = graph.lixels[idx];
    return { lixelIndex: idx, x: l.x, y: l.y, weight: 1 };
  });

  it("conserves kernel mass on a 1-D line network (∫K = 1)", () => {
    // Single unbranched corridor: analytic mass conservation check.
    const a: GraphNode = { id: "a", x: 0, y: 0, degree: 1, control: "none", nodeType: "dead_end", isGradeSeparated: false };
    const b: GraphNode = { id: "b", x: 1600, y: 0, degree: 1, control: "none", nodeType: "dead_end", isGradeSeparated: false };
    const line: GraphSegment = {
      id: "line", fromNodeId: "a", toNodeId: "b", x1: 0, y1: 0, x2: 1600, y2: 0, shape: [[0, 0], [1600, 0]],
      lengthM: 1600, roadClass: "primary", classOrdinal: 2, name: "line", lanes: 2, speedLimitKph: 50, aadt: 9000,
      sinuosity: 1, curvaturePerKm: 0, lighting: "lit", surface: "asphalt", isBridge: false, sidewalk: true, cycleLane: false, vktPerDay: 1,
    };
    const lineLixels: GraphLixel[] = lixelizeSegment(line as any, 0, 25, "L").map((l, i) => ({ ...l, id: `Q${i}` }));
    const lineGraph = new RoadGraph([a, b], [line], lineLixels);
    const src = Math.floor(lineLixels.length / 2);
    const surface = nkde(lineGraph, [{ lixelIndex: src, x: lineLixels[src].x, y: lineLixels[src].y, weight: 1 }], {
      bandwidthM: 200, kernel: "quartic", edgeCorrection: false, splitting: true,
    });
    let mass = 0;
    for (let i = 0; i < surface.values.length; i++) mass += (surface.values[i] / 1000) * lineLixels[i].lengthM;
    expect(mass).toBeCloseTo(1, 2);
    // Without Okabe splitting the same mass is conserved on a line (no vertices),
    // but on a grid it inflates: verify the branch-inflation effect explicitly.
    const gridNoSplit = nkde(graph, points, { bandwidthM: 200, kernel: "quartic", edgeCorrection: false, splitting: false });
    const gridSplit = nkde(graph, points, { bandwidthM: 200, kernel: "quartic", edgeCorrection: false, splitting: true });
    const massOf = (s: { values: Float64Array }) => Array.from(s.values).reduce((acc, v, i) => acc + (v / 1000) * graph.lixels[i].lengthM, 0);
    expect(massOf(gridNoSplit)).toBeGreaterThan(massOf(gridSplit));
  });

  it("produces strictly non-negative densities with the documented unit", () => {
    const s = nkde(graph, points, { bandwidthM: 250, kernel: "gaussian" });
    expect(Array.from(s.values).every((v) => v >= 0)).toBe(true);
    expect(s.unit).toContain("km");
    expect(s.nonZero).toBeGreaterThan(0);
  });

  it("respects kernel support truncation", () => {
    for (const name of Object.keys(KERNELS) as Array<keyof typeof KERNELS>) {
      const s = nkde(graph, points.slice(0, 20), { bandwidthM: 180, kernel: name, edgeCorrection: false, splitting: false });
      expect(Array.from(s.values).every((v) => Number.isFinite(v))).toBe(true);
    }
    // Epanechnikov support = h: nothing beyond h receives mass
    const s = nkde(graph, [{ lixelIndex: 0, x: graph.lixels[0].x, y: graph.lixels[0].y, weight: 1 }], {
      bandwidthM: 100, kernel: "epanechnikov", edgeCorrection: false, splitting: false,
    });
    let maxDist = 0;
    s.values.forEach((v, i) => {
      if (v > 0) {
        const d = graph.networkDistance(0, i, 5000);
        if (Number.isFinite(d) && d > maxDist) maxDist = d;
      }
    });
    expect(maxDist).toBeLessThanOrEqual(160);
  });

  it("vertex splitting reduces intersection density inflation", () => {
    const dense = nkde(graph, points, { bandwidthM: 220, kernel: "quartic", splitting: false, edgeCorrection: false });
    const split = nkde(graph, points, { bandwidthM: 220, kernel: "quartic", splitting: true, edgeCorrection: false });
    const junctionLixels = graph.lixels.map((l, i) => ({ l, i })).filter((o) => o.l.distToNodeM < 16).map((o) => o.i);
    const meanOf = (arr: Float64Array) => junctionLixels.reduce((s, i) => s + arr[i], 0) / junctionLixels.length;
    expect(meanOf(split.values)).toBeLessThan(meanOf(dense.values));
  });

  it("handles empty and out-of-range input without NaN", () => {
    const empty = nkde(graph, [], { bandwidthM: 200 });
    expect(Array.from(empty.values).every((v) => v === 0)).toBe(true);
    const bad = nkde(graph, [{ lixelIndex: 10 ** 7, x: 0, y: 0, weight: 1 }], { bandwidthM: 200 });
    expect(Array.from(bad.values).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("quantifies planar distortion near intersections", () => {
    const net = nkde(graph, points, { bandwidthM: 250, kernel: "quartic" });
    const pla = planarKde(graph, points, { bandwidthM: 250, kernel: "quartic" });
    const cmp = compareSurfaces(graph, net.values, pla.values);
    expect(cmp.difference.length).toBe(net.values.length);
    expect(Math.abs(cmp.stats.pearson)).toBeLessThanOrEqual(1);
    expect(cmp.stats.rmseStandardized).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(cmp.stats.intersectionOverestimationPct)).toBe(true);
    expect(cmp.stats.overestimatedLixels + cmp.stats.underestimatedLixels).toBeLessThanOrEqual(net.values.length);
  });
});

describe("network Getis-Ord Gi* and Moran", () => {
  it("detects an injected network hotspot and flags coldspots", () => {
    const x = new Array(graph.lixels.length).fill(0).map(() => 0.4);
    const centre = graph.lixels.findIndex((l) => Math.abs(l.x - 360) < 60 && Math.abs(l.y - 360) < 60);
    const hot = graph.spread(centre, 250, false).map((t) => t.lixelIndex);
    for (const i of hot) x[i] += 14;
    const weights = buildNetworkWeights(graph, { mode: "distance_decay", bandwidthM: 250 });
    const res = localGetisOrd(graph, x, weights, { permutations: 199, weightMode: "distance_decay", bandwidthM: 250 });
    expect(res.hotspots).toBeGreaterThan(0);
    expect(res.z[centre]).toBeGreaterThan(2);
    expect(res.assumptions.find((a) => a.name === "variance_positivity")!.passed).toBe(true);
    expect(res.globalMoranI).toBeGreaterThan(0);
    expect(res.qValue.every((q) => q >= 0 && q <= 1)).toBe(true);
  });

  it("refuses to infer on a constant attribute (variance positivity)", () => {
    const x = new Array(graph.lixels.length).fill(3);
    const weights = buildNetworkWeights(graph, { mode: "contiguity", k: 1 });
    const res = localGetisOrd(graph, x, weights, { permutations: 99, weightMode: "contiguity", k: 1 });
    const check = res.assumptions.find((a) => a.name === "variance_positivity")!;
    expect(check.passed).toBe(false);
    expect(res.hotspots).toBe(0);
    expect(res.z.every((z) => z === 0)).toBe(true);
  });

  it("detects no structure in a random field (false positive rate stays low)", () => {
    const rng = new Rng(99);
    const x = Array.from({ length: graph.lixels.length }, () => rng.poisson(2));
    const weights = buildNetworkWeights(graph, { mode: "distance_decay", bandwidthM: 220 });
    const res = localGetisOrd(graph, x, weights, { permutations: 199 });
    const rate = (res.hotspots + res.coldspots) / graph.lixels.length;
    expect(rate).toBeLessThan(0.15);
  });

  it("builds contiguity weights that never exceed the graph size", () => {
    const w = buildNetworkWeights(graph, { mode: "contiguity", k: 2 });
    expect(w).toHaveLength(graph.lixels.length);
    expect(w.every((u) => u.count >= 1 && u.count <= graph.lixels.length)).toBe(true);
  });

  it("assigns LISA quadrants", () => {
    const rng = new Rng(5);
    const x = Array.from({ length: graph.lixels.length }, () => rng.poisson(3));
    const w = buildNetworkWeights(graph, { mode: "contiguity", k: 1 });
    const m = localMoran(graph, x, w, 99, 3);
    expect(m.Ii).toHaveLength(x.length);
    expect(new Set(m.quadrants).size).toBeGreaterThan(1);
  });
});

describe("network DBSCAN", () => {
  it("clusters network-adjacent points and isolates noise", () => {
    const rng = new Rng(11);
    const centre = graph.lixels.findIndex((l) => Math.abs(l.x - 300) < 60 && Math.abs(l.y - 240) < 60);
    const near = graph.spread(centre, 200, false).map((t) => t.lixelIndex);
    const points = [
      ...near.slice(0, 14).map((li, i) => ({ id: `p${i}`, lixelIndex: li, x: graph.lixels[li].x, y: graph.lixels[li].y, weight: 1, severityCode: "minor_injury", occurredAt: Date.UTC(2025, 5, 1) })),
      { id: "far", lixelIndex: graph.lixels.length - 1, x: graph.lixels[graph.lixels.length - 1].x, y: graph.lixels[graph.lixels.length - 1].y, weight: 1, severityCode: "property_damage", occurredAt: Date.UTC(2025, 5, 1) },
    ];
    const res = nDbScan(graph, points, { epsilonM: 220, minPoints: 4 });
    expect(res.clusters.length).toBeGreaterThanOrEqual(1);
    expect(res.clusters[0].size).toBeGreaterThan(4);
    expect(res.noiseCount).toBeGreaterThanOrEqual(1);
    expect(res.clusters[0].hull.length).toBeGreaterThanOrEqual(3);
    expect(res.clusters[0].networkSpanM).toBeGreaterThan(0);
    expect(res.clusters[0].spanRatio).toBeGreaterThan(0.5);
    void rng;
  });

  it("returns everything as noise when minPoints is unreachable", () => {
    const points = [
      { id: "a", lixelIndex: 0, x: graph.lixels[0].x, y: graph.lixels[0].y, weight: 1, severityCode: "fatal", occurredAt: 0 },
      { id: "b", lixelIndex: graph.lixels.length - 1, x: 0, y: 0, weight: 1, severityCode: "fatal", occurredAt: 0 },
    ];
    const res = nDbScan(graph, points, { epsilonM: 100, minPoints: 5 });
    expect(res.clusters).toHaveLength(0);
    expect(res.noiseCount).toBe(2);
  });

  it("computes convex hulls correctly", () => {
    const hull = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
    expect(hull).toHaveLength(4);
  });
});

describe("exposure-aware risk and Empirical Bayes", () => {
  const rng = new Rng(23);
  const units = graph.lixels.map((l, i) => {
    const seg = graph.segmentById.get(l.segmentId)!;
    const aadt = i % 7 === 0 ? null : seg.aadt;
    const lengthKm = l.lengthM / 1000;
    const vkt = aadt ? (aadt * lengthKm * 365) / 1e6 : null;
    const expected = vkt ? vkt * 1.6 : lengthKm * 4;
    return {
      unitId: l.id, level: "lixel" as const, segmentId: l.segmentId, lixelIndices: [i], lengthKm,
      roadClass: l.roadClass, aadt, vktPerWindow: vkt,
      crashCount: rng.poisson(expected * (i % 23 === 0 ? 4 : 1)),
      crashDensityPerKm: 0, epdo: 0, epdoPerKm: 0, crashRatePerMvkt: null,
      hasExposure: Boolean(vkt), verifiedCount: i % 2, vgiOnlyCount: i % 3, meanDriftM: 12,
    };
  });

  it("fits an SPF and reports overdispersion", () => {
    const { fit, excluded } = fitSpf(units);
    expect(fit).not.toBeNull();
    expect(fit!.n).toBeGreaterThan(50);
    expect(excluded).toBeGreaterThan(0);
    expect(fit!.phi).toBeGreaterThan(0);
    expect(fit!.betaVkt).toBeGreaterThan(0);
    const mu = spfPredict(units.find((u) => u.hasExposure)!, fit!);
    expect(mu).toBeGreaterThan(0);
  });

  it("shrinks low-exposure spikes toward the prior (regression-to-the-mean)", () => {
    const small = empiricalBayes(8, 1.0, 1.5);
    const large = empiricalBayes(8, 7.5, 1.5);
    expect(small.weight).toBeLessThan(large.weight);
    expect(small.estimate).toBeLessThan(8);
    expect(small.estimate).toBeGreaterThan(1.0);
    expect(large.estimate).toBeCloseTo(8 * large.weight + 7.5 * (1 - large.weight), 6);
    expect(small.excess).toBeGreaterThan(large.excess);
    expect(small.psi).toBeGreaterThan(0);
  });

  it("produces ordered credible intervals containing the estimate", () => {
    const eb = empiricalBayes(5, 3, 2);
    expect(eb.lower95).toBeLessThan(eb.upper95);
    expect(eb.estimate).toBeGreaterThanOrEqual(eb.lower95 - 1e-9);
    expect(eb.estimate).toBeLessThanOrEqual(eb.upper95 + 1e-9);
  });

  it("handles zero exposure and zero counts without NaN", () => {
    const eb = empiricalBayes(0, 0.000001, 1.5);
    expect(Number.isFinite(eb.estimate)).toBe(true);
    expect(eb.psi).toBe(0);
    const noExposure = { ...units[0], hasExposure: false, vktPerWindow: null, aadt: null, crashCount: 3 };
    const u = uncertainty(noExposure, eb, 30);
    expect(u.total).toBeGreaterThan(0.3);
    expect(u.components.exposureGap).toBeGreaterThan(0.5);
  });

  it("aggregates lixels and segments consistently", () => {
    const incidents = units.slice(0, 40).map((u, i) => ({
      lixelIndex: u.lixelIndices[0], segmentId: u.segmentId, weight: 1, epdo: i % 4 === 0 ? 26 : 1,
      severityRank: 2, isVerified: i % 3 === 0, isVgiOnly: i % 3 !== 0, positionalDriftM: 15,
    }));
    const lixelAgg = aggregateUnits(graph, incidents, "lixel", 365);
    const segAgg = aggregateUnits(graph, incidents, "segment", 365);
    expect(lixelAgg).toHaveLength(graph.lixels.length);
    expect(segAgg).toHaveLength(graph.segments.length);
    const totalL = lixelAgg.reduce((s, u) => s + u.crashCount, 0);
    const totalS = segAgg.reduce((s, u) => s + u.crashCount, 0);
    expect(totalL).toBeCloseTo(incidents.length, 6);
    expect(totalS).toBeCloseTo(incidents.length, 6);
  });

  it("normalises composite weights and returns ranks in [0,1]", () => {
    const inputs = units.slice(0, 60).map((u) => ({
      ebEstimate: u.crashCount, epdoPerKm: u.crashCount / Math.max(1e-6, u.lengthKm), curvaturePerKm: 0.4,
      sinuosity: 1.05, speedLimitKph: 50, lanes: 2, unlitShare: 0.2, wetShare: 0.2, exposureGapPenalty: u.hasExposure ? 0 : 1,
    }));
    const { scores } = compositeScore(inputs, { ebRisk: 2, severity: 2, geometry: 1, environment: 1, exposure: 1 });
    expect(scores).toHaveLength(60);
    expect(scores.every((s) => s >= 0 && s <= 1)).toBe(true);
    expect(Math.max(...scores)).toBeGreaterThan(0.5);
    expect(Math.max(...scores)).toBeLessThanOrEqual(1);
    expect(Math.min(...scores)).toBeLessThan(0.1);
  });
});

describe("ground-truth benchmarking", () => {
  it("gives a perfect estimator PAI ≈ N/n_k and a random estimator PAI ≈ 1", () => {
    const n = 1000;
    const rng = new Rng(3);
    const truth = Array.from({ length: n }, (_, i) => (i < 50 ? 3 : 0.05));
    const realized = truth.map((l) => rng.poisson(l));
    const perfect = evaluateAgainstGroundTruth({ predicted: truth, trueLambda: truth, realizedCounts: realized, topPercent: [5, 10] });
    expect(perfect.rri10).toBeGreaterThan(0.7);
    expect(perfect.pai10).toBeGreaterThan(5);
    const random = evaluateAgainstGroundTruth({ predicted: Array.from({ length: n }, () => rng.next()), trueLambda: truth, realizedCounts: realized, topPercent: [5, 10] });
    expect(random.pai10).toBeLessThan(3);
    expect(random.rmseVsLambda).toBeGreaterThan(perfect.rmseVsLambda);
    expect(perfect.spearmanVsLambda).toBeGreaterThan(0.9);
  });

  it("is scale-invariant after rescaling", () => {
    const n = 400;
    const truth = Array.from({ length: n }, (_, i) => (i % 20 === 0 ? 2 : 0.1));
    const scaledTruth = truth.map((v) => v * 7.3);
    const a = evaluateAgainstGroundTruth({ predicted: truth, trueLambda: truth, realizedCounts: truth.map((v) => Math.round(v)) });
    const b = evaluateAgainstGroundTruth({ predicted: scaledTruth, trueLambda: truth, realizedCounts: truth.map((v) => Math.round(v)) });
    expect(a.rmseVsLambda).toBeCloseTo(b.rmseVsLambda, 6);
    expect(a.spearmanVsLambda).toBeCloseTo(b.spearmanVsLambda, 6);
    // biasRatio intentionally measures the estimator's own scale
    expect(a.biasRatio).toBeCloseTo(1, 5);
    expect(b.biasRatio).toBeCloseTo(1 / 7.3, 5);
  });

  it("degrades gracefully on degenerate inputs", () => {
    const res = evaluateAgainstGroundTruth({ predicted: [], trueLambda: [], realizedCounts: [] });
    expect(res.n).toBe(0);
    expect(Number.isFinite(res.rmseVsLambda)).toBe(true);
  });
});
