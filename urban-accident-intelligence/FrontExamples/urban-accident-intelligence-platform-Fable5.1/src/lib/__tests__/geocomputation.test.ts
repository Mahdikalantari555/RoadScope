import { describe, it, expect } from "vitest";
import { RoadNetwork, lixelize, makeProjection, projectOnPolyline, convexHull, polylineLength } from "@/lib/geo/network";
import { mapMatch, credibilityScore, conflationCandidates } from "@/lib/analysis/mapmatch";
import { kernel, networkKDE, getisOrdGiStar, buildNetworkWeights, networkDBSCAN, benchmark, planarKDE } from "@/lib/analysis/network-stats";
import { rng, temporalProfile } from "@/lib/sim/generator";

/** Test fixture: a "+" junction (node 0 centre) with 4 legs of 100 m and a detached parallel road 20 m away. */
function fixture() {
  const nodes = [{ id: 0, xy: [0, 0] as [number, number], degree: 0 }, { id: 1, xy: [100, 0] as [number, number], degree: 0 }, { id: 2, xy: [-100, 0] as [number, number], degree: 0 }, { id: 3, xy: [0, 100] as [number, number], degree: 0 }, { id: 4, xy: [0, -100] as [number, number], degree: 0 }, { id: 5, xy: [0, 20] as [number, number], degree: 0 }, { id: 6, xy: [100, 20] as [number, number], degree: 0 }];
  const mk = (id: number, from: number, to: number, cls = "local") => ({ id, from, to, length: 100, coords: [nodes[from].xy, nodes[to].xy], roadClass: cls, aadt: 1000, speedLimit: 30, lanes: 2, sinuosity: 1 });
  const segs = [mk(1, 0, 1, "arterial"), mk(2, 0, 2), mk(3, 0, 3), mk(4, 0, 4), mk(5, 5, 6)];
  const lix: { id: number; segmentId: number; idx: number; mStart: number; mEnd: number; length: number; mid: [number, number] }[] = [];
  let id = 1;
  for (const s of segs) for (const l of lixelize(s.coords, s.length, 25)) lix.push({ id: id++, segmentId: s.id, idx: l.idx, mStart: l.mStart, mEnd: l.mEnd, length: l.length, mid: l.mid });
  return new RoadNetwork(nodes, segs, lix);
}

describe("projection & LRS", () => {
  it("round-trips lon/lat ↔ metric plane", () => { const p = makeProjection(8.54, 47.37); const [x, y] = p.toXY(8.55, 47.38); const [lon, lat] = p.toLonLat(x, y); expect(lon).toBeCloseTo(8.55, 9); expect(lat).toBeCloseTo(47.38, 9); expect(x).toBeGreaterThan(700); expect(x).toBeLessThan(800); });
  it("lixelizes an edge into uniform units preserving m-offsets 0..L", () => { const c: [number, number][] = [[0, 0], [130, 0]]; const L = lixelize(c, 130, 25); expect(L).toHaveLength(5); expect(L[0].mStart).toBe(0); expect(L[4].mEnd).toBe(130); expect(L.reduce((a, l) => a + l.length, 0)).toBeCloseTo(130); for (const l of L) expect(l.length).toBeCloseTo(26); });
  it("orthogonally projects onto a polyline with correct m", () => { const r = projectOnPolyline([[0, 0], [100, 0]], [40, 7]); expect(r.m).toBeCloseTo(40); expect(r.d).toBeCloseTo(7); });
  it("computes polyline length and convex hull", () => { expect(polylineLength([[0, 0], [3, 4], [3, 0]])).toBeCloseTo(9); expect(convexHull([[0, 0], [1, 1], [2, 0], [1, 0.5], [0, 2], [2, 2]])).toHaveLength(4); });
});

describe("network distance", () => {
  const net = fixture();
  it("distance along the same edge is |Δm|", () => { expect(net.pointDistance({ segmentId: 1, m: 10 }, { segmentId: 1, m: 60 }, 1000)).toBeCloseTo(50); });
  it("routes through the junction between legs", () => { expect(net.pointDistance({ segmentId: 1, m: 30 }, { segmentId: 3, m: 40 }, 1000)).toBeCloseTo(70); });
  it("does NOT connect topologically disjoint parallel roads (planar distance would be 20 m)", () => { expect(net.pointDistance({ segmentId: 1, m: 50 }, { segmentId: 5, m: 50 }, 1000)).toBe(Infinity); });
  it("respects the bandwidth bound", () => { const d = net.lixelDistancesFrom({ segmentId: 1, m: 0 }, 60); for (const v of d.values()) expect(v.d).toBeLessThanOrEqual(60); expect(d.size).toBeGreaterThan(0); });
  it("applies equal-split factor 1/(deg-1) across a degree-4 junction", () => { const d = net.lixelDistancesFrom({ segmentId: 1, m: 50 }, 200); const onLeg3 = [...d.entries()].find(([id]) => net.lixels.get(id)!.segmentId === 3); expect(onLeg3![1].split).toBeCloseTo(1 / 3); });
});

describe("probabilistic map-matching", () => {
  const net = fixture();
  it("snaps to nearest edge when unambiguous with posterior ≈ 1", () => { const c = mapMatch(net, [-60, 4], 10); expect(c[0].segmentId).toBe(2); expect(c[0].posterior).toBeGreaterThan(0.95); expect(c[0].m).toBeCloseTo(60); });
  it("keeps competing hypotheses for parallel roads", () => { const c = mapMatch(net, [50, 10], 15); const ids = c.map((x) => x.segmentId); expect(ids).toContain(1); expect(ids).toContain(5); expect(c.reduce((a, x) => a + x.posterior, 0)).toBeCloseTo(1); });
  it("extends candidates to all legs at a junction", () => { const c = mapMatch(net, [6, 6], 10); expect(c.filter((x) => x.nearJunctionNodeId === 0).length).toBeGreaterThanOrEqual(4); });
  it("credibility is bounded and monotone in witnesses", () => { const a = credibilityScore(1, 0.9, 0.8), b = credibilityScore(4, 0.9, 0.8); expect(b).toBeGreaterThan(a); expect(b).toBeLessThanOrEqual(1); expect(credibilityScore(0, 0, 0)).toBe(0); });
  it("conflation respects both space and time windows", () => { const t = new Date("2025-01-01T10:00:00Z"); const others = [{ id: 1, p: { segmentId: 3, m: 40 }, t: new Date(t.getTime() + 10 * 60e3) }, { id: 2, p: { segmentId: 3, m: 40 }, t: new Date(t.getTime() + 500 * 60e3) }, { id: 3, p: { segmentId: 5, m: 50 }, t }]; const h = conflationCandidates(net, { segmentId: 1, m: 30 }, t, others, 150, 60); expect(h.map((x) => x.id)).toEqual([1]); expect(h[0].dNet).toBeCloseTo(70); });
});

describe("spatial statistics", () => {
  const net = fixture();
  it("kernels integrate to ~1 on their support", () => { for (const k of ["gaussian", "epanechnikov", "quartic"] as const) { let s = 0; for (let u = -3; u <= 3; u += 0.001) s += kernel(k, u) * 0.001; expect(s).toBeCloseTo(1, 1); } });
  it("NKDE mass is concentrated near the event and zero on disjoint roads", () => { const d = networkKDE(net, [{ id: 1, p: { segmentId: 1, m: 50 }, xy: [50, 0], weight: 1 }], 30, "gaussian"); const near = [...d.entries()].find(([id]) => { const l = net.lixels.get(id)!; return l.segmentId === 1 && l.mStart <= 50 && l.mEnd >= 50; })!; const far = [...d.entries()].filter(([id]) => net.lixels.get(id)!.segmentId === 5); expect(near[1]).toBeGreaterThan(0); for (const [, v] of far) expect(v).toBe(0); });
  it("planar KDE leaks onto the disjoint parallel road (the distortion NKDE avoids)", () => { const d = planarKDE(net, [{ id: 1, p: { segmentId: 1, m: 50 }, xy: [50, 0], weight: 1 }], 30, "gaussian"); const far = [...d.entries()].filter(([id]) => net.lixels.get(id)!.segmentId === 5); expect(Math.max(...far.map(([, v]) => v))).toBeGreaterThan(0); });
  it("Gi* refuses to run on zero-variance input and reports assumptions", () => { const W = buildNetworkWeights(net, 50, "binary"); const x = new Map([...net.lixels.keys()].map((id) => [id, 1])); const r = getisOrdGiStar(x, W, 19); expect(r.results).toHaveLength(0); expect(r.assumptions.variancePositive).toBe(false); });
  it("Gi* flags a concentrated cluster as hot with FDR control on a larger synthetic network", () => {
    const nodes = Array.from({ length: 41 }, (_, i) => ({ id: i, xy: [i * 100, 0] as [number, number], degree: 0 }));
    const segs = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, from: i, to: i + 1, length: 100, coords: [nodes[i].xy, nodes[i + 1].xy], roadClass: "local", aadt: 1, speedLimit: 30, lanes: 2, sinuosity: 1 }));
    const lix: { id: number; segmentId: number; idx: number; mStart: number; mEnd: number; length: number; mid: [number, number] }[] = []; let id = 1;
    for (const s of segs) for (const l of lixelize(s.coords, s.length, 25)) lix.push({ id: id++, segmentId: s.id, idx: l.idx, mStart: l.mStart, mEnd: l.mEnd, length: l.length, mid: l.mid });
    const n2 = new RoadNetwork(nodes, segs, lix);
    const x = new Map<number, number>(); const r = rng(1);
    for (const l of lix) x.set(l.id, l.segmentId >= 20 && l.segmentId <= 22 ? 8 + Math.floor(r.u() * 4) : Math.floor(r.u() * 2));
    const W = buildNetworkWeights(n2, 150, "gaussian"); const res = getisOrdGiStar(x, W, 199);
    const hot = res.results.filter((q) => q.cls.startsWith("hot9")); expect(hot.length).toBeGreaterThan(0);
    for (const h of hot) expect(n2.lixels.get(h.id)!.segmentId).toBeGreaterThanOrEqual(18);
    expect(res.moranI).toBeGreaterThan(0);
  });
  it("N-DBSCAN groups by network reachability, not Euclidean proximity", () => { const ev = [{ id: 1, p: { segmentId: 1, m: 40 }, xy: [40, 0] as [number, number], weight: 1 }, { id: 2, p: { segmentId: 1, m: 60 }, xy: [60, 0] as [number, number], weight: 1 }, { id: 3, p: { segmentId: 1, m: 80 }, xy: [80, 0] as [number, number], weight: 1 }, { id: 4, p: { segmentId: 5, m: 50 }, xy: [50, 20] as [number, number], weight: 1 }]; const r = networkDBSCAN(net, ev, 50, 2); expect(r.clusters).toHaveLength(1); expect(r.labels.get(4)).toBe(-1); });
  it("benchmark gives RRI = 1 and RMSE = 0 for a perfect prediction", () => { const truth = new Map([[1, 1], [2, 5], [3, 0.5], [4, 2], [5, 9], [6, 3], [7, 1], [8, 0.2], [9, 4], [10, 6]]); const lens = new Map([...truth.keys()].map((k) => [k, 25])); const b = benchmark(new Map(truth), truth, lens, 0.2); expect(b.RRI).toBeCloseTo(1); expect(b.rmse).toBeCloseTo(0); expect(b.spearman).toBeCloseTo(1); });
});

describe("simulator", () => {
  it("seeded RNG is reproducible and Poisson mean is right", () => { const a = rng(7), b = rng(7); expect(a.u()).toBe(b.u()); let s = 0; for (let i = 0; i < 4000; i++) s += a.poisson(3); expect(s / 4000).toBeCloseTo(3, 0); });
  it("temporal profile has rush-hour peaks and is flat for uniform scenario", () => { const peak = temporalProfile("diurnal", new Date("2025-03-05T17:30:00Z")), night = temporalProfile("diurnal", new Date("2025-03-05T03:00:00Z")); expect(peak).toBeGreaterThan(night * 3); expect(temporalProfile("uniform", new Date())).toBe(1); });
});
