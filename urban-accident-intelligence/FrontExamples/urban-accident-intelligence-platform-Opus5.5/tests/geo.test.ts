import { describe, expect, it } from "vitest";
import { fromUtm, toUtm } from "../src/lib/geo/projection";
import { convexHull, polygonArea, projectOnPolyline, type XY } from "../src/lib/geo/geometry";
import { benjaminiHochberg, mulberry32, normalInv, poissonCI, rateRatio, gini } from "../src/lib/geo/stats";
import { kde } from "../src/lib/geo/kde";
import { getisOrdGiStar, globalMoransI, type AreaUnit } from "../src/lib/geo/hotspot";
import { dbscan, clarkEvans } from "../src/lib/geo/cluster";
import { assessRisk } from "../src/lib/geo/risk";
import { duplicateScore, evaluateDetector } from "../src/lib/geo/duplicates";
import { generateDataset } from "../src/lib/synthetic/generator";

describe("projection (UTM 33N)", () => {
  it("maps the central meridian to false easting", () => {
    const [x] = toUtm(15, 45);
    expect(x).toBeCloseTo(500000, 3);
  });
  it("round-trips with sub-centimetre error", () => {
    for (const [lon, lat] of [[14.2, 44.1], [15.9, 46.3], [15, 45.15]]) {
      const [x, y] = toUtm(lon, lat);
      const [lon2, lat2] = fromUtm(x, y);
      expect(Math.abs(lon - lon2) * 111000).toBeLessThan(0.01);
      expect(Math.abs(lat - lat2) * 111000).toBeLessThan(0.01);
    }
  });
  it("matches a published reference northing (45°N on CM ≈ 4 982 950 m)", () => {
    expect(toUtm(15, 45)[1]).toBeCloseTo(4982950.4, 0);
  });
});

describe("geometry", () => {
  it("projects onto a polyline", () => {
    const p = projectOnPolyline([5, 3], [[0, 0], [10, 0], [10, 10]]);
    expect(p.distance).toBeCloseTo(3);
    expect(p.along).toBeCloseTo(5);
  });
  it("computes the convex hull of a square with interior points", () => {
    const pts: XY[] = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [3, 7]];
    expect(polygonArea(convexHull(pts))).toBeCloseTo(100);
  });
});

describe("statistics", () => {
  it("normal quantile", () => expect(normalInv(0.975)).toBeCloseTo(1.959964, 4));
  it("Garwood Poisson CI", () => {
    expect(poissonCI(0)[1]).toBeCloseTo(3.689, 1);
    const [lo, hi] = poissonCI(10);
    expect(lo).toBeCloseTo(4.795, 1);
    expect(hi).toBeCloseTo(18.39, 0);
  });
  it("Benjamini–Hochberg is monotone and ≥ raw p", () => {
    const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205];
    const q = benjaminiHochberg(p);
    q.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(p[i]));
    expect(q[0]).toBeCloseTo(0.008, 6);
  });
  it("rate ratio of equal rates is ~1", () => expect(rateRatio(100, 10, 200, 20).rr).toBeCloseTo(1));
  it("gini of equal values is 0", () => expect(gini([2, 2, 2, 2])).toBeCloseTo(0));
});

function lattice(n: number, s: number, value: (i: number, j: number) => number): AreaUnit[] {
  const u: AreaUnit[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) u.push({ id: `${i}:${j}`, x: i * s, y: j * s, value: value(i, j) });
  return u;
}

describe("KDE", () => {
  it("conserves mass for interior points (≈ n events)", () => {
    const rng = mulberry32(1);
    const pts = Array.from({ length: 200 }, () => ({ x: 2000 + rng() * 1000, y: 2000 + rng() * 1000, w: 1 }));
    const r = kde(pts, { minX: 0, minY: 0, maxX: 5000, maxY: 5000 }, { cellSize: 25, bandwidth: 300, kernel: "quartic" });
    expect(r.totalMass).toBeGreaterThan(190);
    expect(r.totalMass).toBeLessThan(210);
  });
});

describe("Getis-Ord Gi* and Moran's I", () => {
  it("detects a planted hotspot", () => {
    const rng = mulberry32(3);
    const u = lattice(15, 100, (i, j) => (Math.abs(i - 7) <= 1 && Math.abs(j - 7) <= 1 ? 20 : Math.floor(rng() * 3)));
    const gi = getisOrdGiStar(u, 150, true);
    const centre = gi.find((g) => g.id === "7:7")!;
    expect(centre.cls).toBe("hot99");
  });
  it("controls false positives under CSR-like values with FDR", () => {
    const rng = mulberry32(11);
    const u = lattice(20, 100, () => Math.floor(rng() * 5));
    const sig = getisOrdGiStar(u, 250, true).filter((g) => g.q < 0.05).length;
    expect(sig / u.length).toBeLessThan(0.05);
  });
  it("Moran's I is positive and significant for a smooth gradient", () => {
    const u = lattice(12, 100, (i) => i);
    const m = globalMoransI(u, 150, 199);
    expect(m.I).toBeGreaterThan(0.5);
    expect(m.pPermutation).toBeLessThan(0.05);
  });
});

describe("DBSCAN + Clark–Evans", () => {
  it("finds two clusters and labels noise", () => {
    const rng = mulberry32(5);
    const pts: XY[] = [];
    for (let k = 0; k < 40; k++) pts.push([100 + rng() * 30, 100 + rng() * 30]);
    for (let k = 0; k < 40; k++) pts.push([800 + rng() * 30, 800 + rng() * 30]);
    pts.push([450, 450], [50, 900]);
    const r = dbscan(pts, 20, 5);
    expect(r.clusterCount).toBe(2);
    expect(r.noiseCount).toBe(2);
  });
  it("Clark–Evans R < 1 for clustered points", () => {
    const rng = mulberry32(9);
    const pts: XY[] = Array.from({ length: 100 }, () => [rng() * 50, rng() * 50] as XY);
    expect(clarkEvans(pts, 1000 * 1000)!.R).toBeLessThan(1);
  });
});

describe("risk engine", () => {
  const segs = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `S${i}`, roadClass: i % 2 ? "arterial" : "local", lengthM: 300, speedLimit: i % 2 ? 60 : 30, lanes: 2, lit: true, aadt: 5000 }));
  const events = segs.flatMap((s) => Array.from({ length: s.id === 1 ? 25 : s.id % 5 }, () => ({ segmentId: s.id, severity: "pdo", adverseWeather: false, dark: false, pending: false })));
  const out = assessRisk(segs, events, {
    years: 2,
    epdoWeights: { pdo: 1, slight: 3, serious: 6, fatal: 12 },
    weights: { frequency: 0.4, severity: 0.3, exposure: 0.2, road: 0.05, environment: 0.05 },
    useEmpiricalBayes: true,
    useExposure: true,
    topK: 5,
    simulations: 200,
    seed: 1,
  });
  it("EB estimate lies between expected and observed", () => {
    for (const r of out.rows) {
      expect(r.eb).toBeGreaterThanOrEqual(Math.min(r.n, r.expected) - 1e-9);
      expect(r.eb).toBeLessThanOrEqual(Math.max(r.n, r.expected) + 1e-9);
    }
  });
  it("index bounded and the extreme segment ranks first with high P(top-K)", () => {
    out.rows.forEach((r) => {
      expect(r.index).toBeGreaterThanOrEqual(0);
      expect(r.index).toBeLessThanOrEqual(100);
    });
    const s1 = out.rows.find((r) => r.id === 1)!;
    expect(s1.rankSafety).toBe(1);
    expect(s1.pTopK).toBeGreaterThan(0.9);
  });
});

describe("duplicate detection", () => {
  it("scores near-identical reports above threshold", () => {
    const s = duplicateScore({ id: 1, x: 0, y: 0, t: 0, category: "angle", severityRank: 2 }, { id: 2, x: 15, y: 10, t: 10 * 60000, category: "angle", severityRank: 2 });
    expect(s.score).toBeGreaterThan(0.75);
  });
  it("computes precision / recall", () => {
    const e = evaluateDetector([{ predicted: true, actual: true }, { predicted: true, actual: false }, { predicted: false, actual: true }]);
    expect(e.precision).toBeCloseTo(0.5);
    expect(e.recall).toBeCloseTo(0.5);
  });
});

describe("synthetic generator", () => {
  it("is reproducible for a fixed seed", () => {
    const a = generateDataset({ seed: 7, accidents: 300 });
    const b = generateDataset({ seed: 7, accidents: 300 });
    expect(a.accidents[17]).toEqual(b.accidents[17]);
    expect(a.segments.length).toBe(b.segments.length);
  });
  it("produces the configured volume, duplicates and labels", () => {
    const d = generateDataset({ seed: 3, accidents: 500, scenario: "intersection" });
    expect(d.accidents.filter((x) => x.truth.kind === "duplicate").length).toBe(25);
    expect(d.accidents.filter((x) => x.truth.component === "hotspot").length).toBeGreaterThan(300);
    expect(d.segments.length).toBeGreaterThan(500);
  });
});
