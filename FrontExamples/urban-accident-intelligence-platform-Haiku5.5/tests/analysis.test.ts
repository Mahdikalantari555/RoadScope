import { describe, expect, it } from "vitest";
import { kernelDensity } from "@/lib/analysis/kde";
import { assessGiStarAssumptions, giStar } from "@/lib/analysis/gistar";
import { dbscan } from "@/lib/analysis/dbscan";
import { computeRiskScores, DEFAULT_WEIGHTS, type RiskInput } from "@/lib/analysis/risk";
import { nearestSegment, buildSegmentGeoms } from "@/lib/analysis/snapping";

describe("kernel density estimation", () => {
  it("conserves the number of events under a quartic kernel fully inside the grid", () => {
    const events = [
      { x: 0, y: 0, weight: 1 },
      { x: 40, y: -30, weight: 1 },
      { x: -100, y: 50, weight: 1 },
      { x: 20, y: 80, weight: 1 },
      { x: 0, y: -120, weight: 1 },
    ];
    const cs = 10;
    const grid = kernelDensity(events, {
      bandwidthM: 300,
      cellSizeM: cs,
      kernel: "quartic",
      bounds: { minX: -800, minY: -800, maxX: 800, maxY: 800 },
    });
    const mass = Array.from(grid.values).reduce((s, v) => s + v, 0) * ((cs * cs) / 1e6);
    expect(mass).toBeCloseTo(events.length, 1);
  });

  it("respects the evaluation mask and yields zero density outside it", () => {
    const grid = kernelDensity([{ x: 0, y: 0, weight: 1 }], {
      bandwidthM: 100,
      cellSizeM: 20,
      kernel: "gaussian",
      bounds: { minX: -300, minY: -300, maxX: 300, maxY: 300 },
      cellMask: (x) => x > 0,
    });
    const idxWest = Math.floor(grid.cols / 2) - 2;
    const row = Math.floor(grid.rows / 2);
    expect(grid.values[row * grid.cols + idxWest]).toBe(0);
  });
});

describe("Getis-Ord Gi*", () => {
  const side = 20;
  const xs: number[] = [];
  const ys: number[] = [];
  const counts: number[] = [];
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      xs.push(c * 100);
      ys.push(r * 100);
      const centre = Math.abs(r - 10) <= 1 && Math.abs(c - 10) <= 1;
      counts.push(centre ? 20 : 1);
    }
  }

  it("returns z = 0 when every cell has the same count (no variance)", () => {
    const flat = counts.map(() => 3);
    const res = giStar(flat, xs, ys, 150);
    expect(Math.max(...Array.from(res.z).map(Math.abs))).toBe(0);
  });

  it("flags a concentrated block of high counts as a significant hotspot", () => {
    const res = giStar(counts, xs, ys, 150, 0.05);
    const centre = 10 * side + 10;
    expect(res.z[centre]).toBeGreaterThan(5);
    expect(res.classes[centre]!.startsWith("hot")).toBe(true);
    expect(res.classes[0]).toBe("ns");
  });

  it("reports failed assumptions for tiny samples", () => {
    const check = assessGiStarAssumptions({ cells: 10, events: 12, nonZeroShare: 0.5, variance: 1, isolateShare: 0 });
    expect(check.passed).toBe(false);
    expect(check.checks.find((c) => c.id === "cells")?.passed).toBe(false);
  });
});

describe("DBSCAN", () => {
  it("separates two dense groups and labels isolated points as noise", () => {
    const xs = [0, 5, 3, 2, 4, 1, 1000, 1005, 1003, 1002, 1004, 1001, 5000];
    const ys = [0, 2, 4, 1, 3, 5, 1000, 1002, 1004, 1001, 1003, 1005, 5000];
    const { labels, clusters } = dbscan(xs, ys, 20, 4);
    expect(clusters).toBe(2);
    expect(labels[12]).toBe(-1);
    expect(new Set(labels.slice(0, 6)).size).toBe(1);
    expect(labels[0]).not.toBe(labels[6]);
  });
});

describe("risk index", () => {
  const base = (id: number, count: number, exposure: number | null): RiskInput => ({
    segmentId: id,
    name: `S${id}`,
    roadClass: "collector",
    count,
    lengthM: 500,
    severityWeightSum: count * 3,
    exposureRate: exposure,
    lighting: 0.5,
    speedLimitKmh: 50,
  });

  it("ranks segments with more incidents higher and bounds scores to 0–100", () => {
    const rows = computeRiskScores([base(1, 0, 1), base(2, 5, 2), base(3, 20, 4)], DEFAULT_WEIGHTS, "percentile");
    const byId = new Map(rows.map((r) => [r.segmentId, r]));
    expect(byId.get(3)!.rank).toBe(1);
    expect(byId.get(1)!.rank).toBe(3);
    for (const r of rows) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("reduces coverage when the exposure indicator is unavailable", () => {
    const full = computeRiskScores([base(1, 2, 1), base(2, 9, 3)], DEFAULT_WEIGHTS, "percentile");
    const partial = computeRiskScores([base(1, 2, null), base(2, 9, null)], DEFAULT_WEIGHTS, "percentile");
    expect(full[0]!.coverage).toBeCloseTo(1, 9);
    expect(partial[0]!.coverage).toBeLessThan(1);
  });

  it("assigns the nearest road segment by point-to-polyline distance", () => {
    const geoms = buildSegmentGeoms([
      { id: 1, utm: [[0, 0], [100, 0]] },
      { id: 2, utm: [[0, 50], [100, 50]] },
    ]);
    expect(nearestSegment(20, 10, geoms)?.segmentId).toBe(1);
    expect(nearestSegment(20, 45, geoms)?.segmentId).toBe(2);
  });
});
