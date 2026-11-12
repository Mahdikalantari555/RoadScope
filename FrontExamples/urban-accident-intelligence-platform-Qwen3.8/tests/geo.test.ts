import { describe, expect, it } from "vitest";
import { crsForOrigin, gridKey, haversineM, toUtm, toWgs84, utmZoneForLongitude } from "@/lib/geo/projection";
import { RoadGraph, lixelizeSegment, pointAtM, polylineLength, projectOntoPolyline } from "@/lib/geo/graph";
import type { GraphLixel, GraphNode, GraphSegment } from "@/lib/geo/graph";

const crs = crsForOrigin(13.4049, 52.5201);

describe("dual-CRS projection", () => {
  it("selects the correct UTM zone and EPSG code", () => {
    expect(utmZoneForLongitude(13.4049)).toBe(33);
    expect(crs.srid).toBe(32633);
    expect(crs.name).toContain("UTM zone 33N");
    expect(crsForOrigin(-73.9857, 40.7484).srid).toBe(32618);
    expect(crsForOrigin(151.2093, -33.8688).srid).toBe(32756);
  });

  it("round-trips WGS84 -> UTM -> WGS84 within 1 mm", () => {
    const samples: Array<[number, number]> = [
      [13.4049, 52.5201],
      [13.3, 52.45],
      [13.55, 52.6],
      [-73.9857, 40.7484],
      [151.2093, -33.8688],
      [0, 0],
    ];
    for (const [lon, lat] of samples) {
      const local = crsForOrigin(lon, lat);
      const p = toUtm(lon, lat, local);
      const back = toWgs84(p.x, p.y, local);
      expect(Math.abs(back.lon - lon)).toBeLessThan(1e-7);
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-7);
      expect(haversineM(lon, lat, back.lon, back.lat)).toBeLessThan(0.01);
    }
  });

  it("preserves metric scale: 1 degree of latitude ≈ 111 km", () => {
    const a = toUtm(13.4, 52.0, crs);
    const b = toUtm(13.4, 53.0, crs);
    expect(Math.abs(b.y - a.y)).toBeGreaterThan(110000);
    expect(Math.abs(b.y - a.y)).toBeLessThan(112500);
  });

  it("produces stable spatial-hash grid keys", () => {
    expect(gridKey(250, 350)).toBe("2:3");
    expect(gridKey(250, 350, 100)).toBe(gridKey(299, 399, 100));
    expect(gridKey(-50, -50)).toBe("-1:-1");
  });
});

function seg(id: string, from: GraphNode, to: GraphNode, shape: Array<[number, number]>, roadClass = "residential"): GraphSegment {
  const L = polylineLength(shape);
  return {
    id,
    fromNodeId: from.id,
    toNodeId: to.id,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    shape,
    lengthM: L,
    roadClass,
    classOrdinal: 5,
    name: id,
    lanes: 2,
    speedLimitKph: 50,
    aadt: 3000,
    sinuosity: 1,
    curvaturePerKm: 0,
    lighting: "lit",
    surface: "asphalt",
    isBridge: false,
    sidewalk: true,
    cycleLane: false,
    vktPerDay: 3000 * (L / 1000),
  };
}

describe("linear referencing & lixelisation", () => {
  const nA: GraphNode = { id: "A", x: 0, y: 0, degree: 2, control: "none", nodeType: "intersection", isGradeSeparated: false };
  const nB: GraphNode = { id: "B", x: 100, y: 0, degree: 3, control: "yield", nodeType: "intersection", isGradeSeparated: false };
  const nC: GraphNode = { id: "C", x: 100, y: 100, degree: 2, control: "none", nodeType: "intersection", isGradeSeparated: false };
  const s1 = seg("E1", nA, nB, [[0, 0], [100, 0]]);
  const s2 = seg("E2", nB, nC, [[100, 0], [100, 100]]);

  it("subdivides into uniform lixels preserving provenance and m-values", () => {
    const lixels = lixelizeSegment(s1 as any, 0, 25, "L");
    expect(lixels).toHaveLength(4);
    expect(lixels[0].mStart).toBe(0);
    expect(lixels[0].mEnd).toBe(25);
    expect(lixels[3].mEnd).toBeCloseTo(100, 9);
    expect(lixels.every((l) => l.segmentId === "E1")).toBe(true);
    expect(lixels.reduce((s, l) => s + l.lengthM, 0)).toBeCloseTo(100, 9);
    // non-divisible length still yields uniform units covering the whole edge
    const odd = lixelizeSegment({ ...s1, shape: [[0, 0], [97, 0]] } as any, 0, 25, "L");
    expect(odd.reduce((s, l) => s + l.lengthM, 0)).toBeCloseTo(97, 9);
    expect(new Set(odd.map((l) => Math.round(l.lengthM * 1000))).size).toBe(1);
  });

  it("places lixel centroids by arc length and records intersection distance", () => {
    const lixels = lixelizeSegment(s1 as any, 0, 25, "L");
    expect(lixels[0].x).toBeCloseTo(12.5, 9);
    expect(lixels[0].distToNodeM).toBeCloseTo(12.5, 9);
    expect(lixels[3].distToNodeM).toBeCloseTo(12.5, 9);
    expect(lixels[1].distToNodeM).toBeCloseTo(37.5, 9);
  });

  it("projects points orthogonally onto curved centrelines", () => {
    const curve: Array<[number, number]> = [[0, 0], [50, 20], [100, 0]];
    const p = projectOntoPolyline(curve, 50, 40);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(20, 6);
    expect(p.distance).toBeCloseTo(20, 6);
    expect(p.m).toBeCloseTo(polylineLength(curve) / 2, 6);
    const at = pointAtM(curve, 0);
    expect(at.x).toBe(0);
  });
});

describe("lixel-centre network graph", () => {
  const nA: GraphNode = { id: "A", x: 0, y: 0, degree: 1, control: "none", nodeType: "dead_end", isGradeSeparated: false };
  const nB: GraphNode = { id: "B", x: 100, y: 0, degree: 3, control: "signal", nodeType: "intersection", isGradeSeparated: false };
  const nC: GraphNode = { id: "C", x: 200, y: 0, degree: 1, control: "none", nodeType: "dead_end", isGradeSeparated: false };
  const nD: GraphNode = { id: "D", x: 100, y: 100, degree: 1, control: "none", nodeType: "dead_end", isGradeSeparated: false };
  const segments = [
    seg("E1", nA, nB, [[0, 0], [100, 0]]),
    seg("E2", nB, nC, [[100, 0], [200, 0]]),
    seg("E3", nB, nD, [[100, 0], [100, 100]]),
  ];
  const lixels: GraphLixel[] = [];
  segments.forEach((s, si) => {
    for (const l of lixelizeSegment(s as any, si, 50, "L")) lixels.push({ ...l, id: `L${lixels.length}` });
  });
  const graph = new RoadGraph([nA, nB, nC, nD], segments, lixels);

  it("returns exact network distances, never Euclidean shortcuts", () => {
    // lixel 0 = E1 [0,50], lixel 3 = E2 [100,150]
    const d = graph.networkDistance(0, 3);
    expect(d).toBeCloseTo(150, 6);
    const euclid = Math.hypot(lixels[0].x - lixels[3].x, lixels[0].y - lixels[3].y);
    expect(d).toBeGreaterThanOrEqual(euclid - 1e-6);
  });

  it("measures around-the-corner distance through the junction", () => {
    // lixel 0 centre (25,0) -> node B (100,0) -> lixel 5 centre (100,75) = 75 + 75
    const d = graph.networkDistance(0, 5);
    expect(d).toBeCloseTo(150, 6);
    const euclid = Math.hypot(lixels[0].x - lixels[5].x, lixels[0].y - lixels[5].y);
    expect(euclid).toBeCloseTo(Math.hypot(75, 75), 6);
    expect(d).toBeGreaterThan(euclid);
  });

  it("is symmetric and returns 0 for identical units", () => {
    expect(graph.networkDistance(1, 4)).toBeCloseTo(graph.networkDistance(4, 1), 9);
    expect(graph.networkDistance(2, 2)).toBe(0);
  });

  it("applies Okabe equal-splitting at a degree-3 vertex", () => {
    const spread = graph.spread(0, 500, true);
    const beyond = spread.find((t) => t.lixelIndex === 5);
    expect(beyond).toBeDefined();
    // path crosses vertex B (degree 3) once -> factor 1/(3-1)
    expect(beyond!.split).toBeCloseTo(0.5, 9);
    const noSplit = graph.spread(0, 500, false).find((t) => t.lixelIndex === 5);
    expect(noSplit!.split).toBe(1);
  });

  it("truncates the spread at the bandwidth", () => {
    const spread = graph.spread(0, 60, true);
    expect(spread.every((t) => t.distance <= 75)).toBe(true);
    expect(spread.some((t) => t.lixelIndex === 0)).toBe(true);
  });

  it("supports k-order contiguity across shared intersection nodes", () => {
    const nb = graph.contiguityNeighbours(1, 1);
    expect(nb).toContain(0);
    expect(nb).toContain(2);
    const nb2 = graph.contiguityNeighbours(1, 2);
    expect(nb2.length).toBeGreaterThan(nb.length);
  });

  it("finds map-matching candidates from the spatial grid index", () => {
    const cands = graph.snapCandidates(60, 12, 150, 15);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0].segmentId).toBe("E1");
    expect(cands[0].perpDistanceM).toBeCloseTo(12, 6);
    expect(cands[0].m).toBeCloseTo(60, 6);
  });

  it("returns no candidate beyond the search radius", () => {
    expect(graph.snapCandidates(5000, 5000, 50, 15)).toHaveLength(0);
  });

  it("bbox queries return only lixels inside the window", () => {
    const inside = graph.lixelsInBBox(-10, -10, 110, 10);
    expect(inside.length).toBe(2);
    expect(inside.every((i) => lixels[i].x <= 110)).toBe(true);
  });
});
