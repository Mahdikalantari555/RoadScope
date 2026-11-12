/**
 * Getis–Ord Gi* local statistic with distance-band weights (binary, focal cell included).
 *
 *   Gi*(i) = (Σⱼ wᵢⱼ xⱼ − x̄ Wᵢ) / (S · sqrt((n Σⱼ wᵢⱼ² − Wᵢ²) / (n − 1)))
 *
 * with x̄ and S the global mean and standard deviation. z-scores are converted to two-sided
 * normal p-values and controlled for multiple testing with Benjamini–Hochberg FDR.
 */
import { SpatialHash } from "../geo";
import { benjaminiHochberg, mean, normCdf } from "../stats";

export type GiClass = "hot99" | "hot95" | "hot90" | "ns" | "cold90" | "cold95" | "cold99";

export interface GiStarResult {
  z: Float64Array;
  p: Float64Array;
  pAdj: Float64Array;
  neighbors: Int32Array;
  classes: GiClass[];
}

export function giStar(values: ArrayLike<number>, xs: ArrayLike<number>, ys: ArrayLike<number>, distanceM: number, alpha = 0.05): GiStarResult {
  const n = values.length;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i]!;
    sumSq += values[i]! * values[i]!;
  }
  const xbar = n ? sum / n : 0;
  const s = Math.sqrt(Math.max(0, sumSq / Math.max(1, n) - xbar * xbar));
  const hash = new SpatialHash(distanceM, xs, ys);
  const buf: number[] = [];
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const neighbors = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const nb = hash.query(xs[i]!, ys[i]!, distanceM, buf);
    const W = nb.length;
    let sx = 0;
    for (const j of nb) sx += values[j]!;
    neighbors[i] = W;
    const numerator = sx - xbar * W;
    const inner = (n * W - W * W) / Math.max(1, n - 1);
    const denom = s * Math.sqrt(Math.max(0, inner));
    z[i] = denom > 0 ? numerator / denom : 0;
    p[i] = 2 * (1 - normCdf(Math.abs(z[i]!)));
  }

  const { adjusted } = benjaminiHochberg(p, 0.05);
  const minTier = Math.round((1 - alpha) * 100);
  const classes: GiClass[] = [];
  for (let i = 0; i < n; i++) {
    const q = adjusted[i]!;
    const tier = q <= 0.01 ? 99 : q <= 0.05 ? 95 : q <= 0.1 ? 90 : 0;
    if (tier === 0 || tier < minTier) classes.push("ns");
    else classes.push(`${z[i]! >= 0 ? "hot" : "cold"}${tier}` as GiClass);
  }
  return { z, p, pAdj: adjusted, neighbors, classes };
}

export interface AssumptionCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** Checks the conditions under which the randomisation-based Gi* approximation is reported. */
export function assessGiStarAssumptions(input: {
  cells: number;
  events: number;
  nonZeroShare: number;
  variance: number;
  isolateShare: number;
}): { checks: AssumptionCheck[]; passed: boolean } {
  const checks: AssumptionCheck[] = [
    { id: "cells", label: "At least 30 fishnet cells", passed: input.cells >= 30, detail: `${input.cells} cells evaluated` },
    { id: "events", label: "At least 30 incidents in scope", passed: input.events >= 30, detail: `${input.events} incidents inside the analysis mask` },
    { id: "variation", label: "Cell counts vary", passed: input.variance > 0, detail: `variance of counts = ${input.variance.toFixed(3)}` },
    {
      id: "occupancy",
      label: "At least 5% of cells contain incidents",
      passed: input.nonZeroShare >= 0.05,
      detail: `${(input.nonZeroShare * 100).toFixed(1)}% of cells non-zero`,
    },
    {
      id: "neighbourhoods",
      label: "Isolated cells (no neighbours) ≤ 5%",
      passed: input.isolateShare <= 0.05,
      detail: `${(input.isolateShare * 100).toFixed(1)}% of cells without neighbours`,
    },
  ];
  return { checks, passed: checks.every((c) => c.passed) };
}

export function countVariance(counts: ArrayLike<number>): number {
  const m = mean(counts);
  let s = 0;
  for (let i = 0; i < counts.length; i++) s += (counts[i]! - m) ** 2;
  return counts.length ? s / counts.length : 0;
}
