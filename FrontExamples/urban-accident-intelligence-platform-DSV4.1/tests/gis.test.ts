/**
 * Unit tests for the framework-free GIS core.
 * Run: npx tsx --test tests/*.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { destination, haversine, makeProjection, pointToSegment, project, unproject } from "../src/lib/geo";
import { clarkEvans, dbscan, gaussianKde, getisOrdGiStar, normalCdf, quantile } from "../src/lib/stats";
import { aggregateBySegment, severityWeight } from "../src/lib/analytics";
import { computeRisk, DEFAULT_RISK_OPTIONS } from "../src/lib/risk";
import { CITY, generateCity } from "../src/lib/seed/city";
import { generateAccidents } from "../src/lib/seed/generate";
import type { AccidentRecord, SegmentRecord } from "../src/lib/data";

test("local projection round-trips within 0.01 m", () => {
  const proj = makeProjection(52.301, 4.951);
  const xy = project({ lat: 52.315, lng: 4.97 }, proj);
  const back = unproject(xy, proj);
  assert.ok(Math.abs(back.lat - 52.315) < 1e-9);
  assert.ok(Math.abs(back.lng - 4.97) < 1e-9);
});

test("projection scale agrees with haversine within 0.3 % at 8 km", () => {
  const proj = makeProjection(52.301, 4.951);
  const a = { lat: 52.28, lng: 4.92 };
  const b = { lat: 52.33, lng: 5.01 };
  const pa = project(a, proj);
  const pb = project(b, proj);
  const planar = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const geodesic = haversine(a, b);
  assert.ok(Math.abs(planar - geodesic) / geodesic < 0.003, `planar ${planar} vs geodesic ${geodesic}`);
});

test("destination produces expected great-circle distance", () => {
  const from = { lat: 52.301, lng: 4.951 };
  const to = destination(from, 90, 1000);
  assert.ok(Math.abs(haversine(from, to) - 1000) < 0.5);
});

test("point-to-segment distance clamps to segment ends", () => {
  assert.equal(pointToSegment({ x: 0, y: 5 }, { x: -10, y: 0 }, { x: 10, y: 0 }).distance, 5);
  const beyond = pointToSegment({ x: 20, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 });
  assert.equal(beyond.distance, 10);
  assert.equal(beyond.t, 1);
});

test("normal CDF and quantiles behave", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 0.001);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

test("KDE preserves total weighted mass and peaks at cluster centre", () => {
  const points = [
    ...Array.from({ length: 20 }, () => ({ x: 0, y: 0 })),
    ...Array.from({ length: 2 }, () => ({ x: 800, y: 800 })),
  ];
  const lattice = gaussianKde(points, points.map(() => 1), { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }, 50, 120);
  const integral = lattice.values.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(integral - 22) < 0.5, `mass ${integral}`);
  const centreIndex = Math.floor(lattice.rows / 2) * lattice.cols + Math.floor(lattice.cols / 2);
  assert.ok(lattice.values[centreIndex] > lattice.values[centreIndex + 20]);
});

test("DBSCAN separates dense clusters from noise", () => {
  const points = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 5, y: 5 },
    { x: 500, y: 500 },
  ];
  const result = dbscan(points, 30, 3);
  assert.equal(result.clusterCount, 1);
  assert.equal(result.noiseCount, 1);
});

test("Getis-Ord Gi* flags a strong local cluster", () => {
  const clustered = [
    ...Array.from({ length: 40 }, (_, i) => ({ x: (i % 7) * 12, y: Math.floor(i / 7) * 12 })),
    ...Array.from({ length: 20 }, (_, i) => ({ x: 4000 + (i % 5) * 20, y: 4000 + Math.floor(i / 5) * 20 })),
  ];
  const giWeights = clustered.map((_, i) => (i < 45 ? 12 : 1));
  const gi = getisOrdGiStar(clustered, 80, giWeights);
  assert.equal(gi.n, 60);
  assert.equal(gi.results.length, 60);
  const central = gi.results[0];
  assert.ok(central.z > 0, `expected positive z, got ${central.z}`);
  assert.ok(central.classification.startsWith("hot"));
  const maxZ = Math.max(...gi.results.map((r) => r.z));
  assert.ok(maxZ > 1.645, "expected at least one significant hot location");
  assert.ok(gi.results.every((r) => r.p >= 0 && r.p <= 1));
});

test("Clark-Evans R < 1 for a clustered pattern", () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ x: Math.cos(i) * 20, y: Math.sin(i) * 20 }));
  const result = clarkEvans(points, 1_000_000);
  assert.ok(result.r < 1);
});

test("synthetic generator is deterministic and internally consistent", () => {
  const city = generateCity();
  assert.ok(city.segments.length > 300);
  assert.ok(city.intersections.length > 100);
  const a = generateAccidents(city, "mixed", 600, 4242);
  const b = generateAccidents(city, "mixed", 600, 4242);
  assert.equal(a.accidents[0].publicId, b.accidents[0].publicId);
  assert.equal(a.accidents[0].lat, b.accidents[0].lat);
  assert.equal(a.accidents.length, 600);
  assert.ok(a.accidents.some((accident) => accident.status === "reported"));
  assert.ok(a.accidents.some((accident) => accident.duplicateScore !== null), "expected at least one linked duplicate");
  assert.ok(a.environment.length > 0 && a.traffic.length > 0);
  assert.equal(CITY.code, "VNT");
});

test("risk index stays bounded and ranks severity", () => {
  const segments: SegmentRecord[] = [
    { id: "S1", name: "Hot", roadClass: "arterial", lanes: 4, speedLimitKmh: 50, surface: "asphalt", isLit: true, district: "A", lengthM: 400, startLat: 52.3, startLng: 4.95, endLat: 52.301, endLng: 4.95, aadt: 20000, heavyVehiclePct: 5, geometry: { type: "LineString", coordinates: [[4.95, 52.3], [4.95, 52.301]] } },
    { id: "S2", name: "Cold", roadClass: "local", lanes: 2, speedLimitKmh: 30, surface: "asphalt", isLit: true, district: "A", lengthM: 400, startLat: 52.3, startLng: 4.96, endLat: 52.301, endLng: 4.96, aadt: 20000, heavyVehiclePct: 2, geometry: { type: "LineString", coordinates: [[4.96, 52.3], [4.96, 52.301]] } },
  ];
  const base = {
    publicId: "T1", status: "verified", categoryCode: "rear_end", occurredAt: "2025-01-01T08:00:00.000Z", reportedAt: "2025-01-01T09:00:00.000Z", district: "A", casualties: 0, fatalities: 0, emergencyServices: false, description: null, weather: "clear", roadSurface: "dry", lighting: "daylight", hour: 8, dow: 3, month: 1, positionalUncertaintyM: 10, locationMethod: "register_record", duplicateOfId: null, duplicateScore: null, qualityFlags: [], datasetName: null, reporterName: null, vehicles: 2,
  };
  const accidents: AccidentRecord[] = [
    ...Array.from({ length: 8 }, (_, i) => ({ ...base, id: i + 1, publicId: `H${i}`, severityCode: 4, lat: 52.3005, lng: 4.95, roadSegmentId: "S1" })),
    { ...base, id: 20, publicId: "C1", severityCode: 1, lat: 52.3005, lng: 4.96, roadSegmentId: "S2" },
  ];
  assert.equal(aggregateBySegment(accidents, segments).find((s) => s.segmentId === "S1")?.count, 8);
  const risk = computeRisk(aggregateBySegment(accidents, segments), DEFAULT_RISK_OPTIONS);
  assert.equal(risk.segments[0].segmentId, "S1");
  assert.ok(risk.segments.every((segment) => segment.riskIndex >= 0 && segment.riskIndex <= 100));
  assert.equal(severityWeight(4), 12);
  assert.equal(severityWeight(1), 1);
  assert.equal(risk.segments.length, 2);
});
