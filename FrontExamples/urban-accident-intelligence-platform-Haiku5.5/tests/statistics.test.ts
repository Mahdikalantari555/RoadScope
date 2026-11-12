import { describe, expect, it } from "vitest";
import { benjaminiHochberg, moranI, normCdf, normInv, percentileRanks, poissonInterval, spearman } from "@/lib/stats";
import { mulberry32 } from "@/lib/random";

describe("normal distribution", () => {
  it("matches reference values of the standard normal CDF and quantile", () => {
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normInv(0.975)).toBeCloseTo(1.95996, 4);
    expect(normInv(0.01)).toBeCloseTo(-2.32635, 4);
  });
});

describe("multiple-testing control", () => {
  it("applies Benjamini–Hochberg step-up adjustment monotonically", () => {
    const { adjusted, significant } = benjaminiHochberg([0.001, 0.01, 0.03, 0.5], 0.05);
    expect(adjusted[0]).toBeCloseTo(0.004, 9);
    expect(adjusted[1]).toBeCloseTo(0.02, 9);
    expect(adjusted[2]).toBeCloseTo(0.04, 9);
    expect(adjusted[3]).toBeCloseTo(0.5, 9);
    expect([...significant]).toEqual([1, 1, 1, 0]);
  });
});

describe("count uncertainty", () => {
  it("returns a zero lower bound for zero incidents and a symmetric-ish interval otherwise", () => {
    expect(poissonInterval(0).low).toBe(0);
    const ci = poissonInterval(10);
    expect(ci.low).toBeGreaterThan(4);
    expect(ci.low).toBeLessThan(5.5);
    expect(ci.high).toBeGreaterThan(17);
    expect(ci.high).toBeLessThan(20);
  });
});

describe("rank statistics", () => {
  it("reports a perfect Spearman correlation for a monotone relationship", () => {
    const r = spearman([1, 2, 3, 4, 5, 6], [2, 4, 6, 8, 10, 12]);
    expect(r.rho).toBeCloseTo(1, 9);
  });

  it("normalises percentile ranks into [0, 1] with ties sharing a rank", () => {
    const pr = percentileRanks([10, 20, 20, 30]);
    expect(pr[0]).toBe(0);
    expect(pr[1]).toBeCloseTo(pr[2]!, 12);
    expect(pr[3]).toBe(1);
  });
});

describe("spatial autocorrelation", () => {
  it("detects positive autocorrelation for spatially clustered values on a chain", () => {
    const values = [10, 10, 10, 10, 0, 0, 0, 0];
    const neighbors = values.map((_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < values.length));
    const result = moranI(values, neighbors, mulberry32(7), 199);
    expect(result.I).toBeGreaterThan(0.2);
    expect(result.pSim).not.toBeNull();
    expect(result.pSim!).toBeLessThan(0.1);
  });
});
