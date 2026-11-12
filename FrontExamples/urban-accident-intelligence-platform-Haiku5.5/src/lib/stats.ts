/**
 * Statistical routines used by the spatial analytics. Implemented directly (no black-box
 * dependency) so that every approximation is documented and unit-tested.
 */
import type { Rng } from "./random";

export function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]!;
  return s / values.length;
}

export function stdev(values: ArrayLike<number>): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (let i = 0; i < n; i++) s += (values[i]! - m) ** 2;
  return Math.sqrt(s / (n - 1));
}

/** Linear-interpolated quantile (type 7). Input need not be sorted. */
export function quantile(values: ArrayLike<number>, q: number): number | null {
  if (values.length === 0) return null;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Error function, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Standard normal quantile (Acklam's rational approximation, relative error < 1.15e-9). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError("normInv requires 0 < p < 1");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Chi-square quantile via the Wilson–Hilferty cube-root approximation (adequate for df >= 2). */
export function chi2Quantile(p: number, df: number): number {
  const z = normInv(p);
  const v = df;
  const term = 1 - 2 / (9 * v) + z * Math.sqrt(2 / (9 * v));
  return v * term * term * term;
}

/**
 * Two-sided exact-style (Garwood) confidence interval for a Poisson count, approximated with the
 * Wilson–Hilferty chi-square quantile. Used to express uncertainty of observed incident counts.
 */
export function poissonInterval(k: number, alpha = 0.05): { low: number; high: number } {
  const low = k === 0 ? 0 : 0.5 * chi2Quantile(alpha / 2, 2 * k);
  const high = 0.5 * chi2Quantile(1 - alpha / 2, 2 * k + 2);
  return { low, high };
}

/**
 * Benjamini–Hochberg false discovery rate control. Returns adjusted p-values (q-values, monotone)
 * and a significance flag at level `q`.
 */
export function benjaminiHochberg(pValues: ArrayLike<number>, q = 0.05): { adjusted: Float64Array; significant: Uint8Array } {
  const m = pValues.length;
  const order = Array.from({ length: m }, (_, i) => i).sort((i, j) => pValues[i]! - pValues[j]!);
  const adjusted = new Float64Array(m);
  const significant = new Uint8Array(m);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const idx = order[rank - 1]!;
    const val = Math.min(1, (pValues[idx]! * m) / rank);
    running = Math.min(running, val);
    adjusted[idx] = running;
  }
  for (let i = 0; i < m; i++) significant[i] = adjusted[i]! <= q ? 1 : 0;
  return { adjusted, significant };
}

/** Average ranks with ties (1-based). */
export function rankWithTies(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => values[i]! - values[j]!);
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]!] === values[order[i]!]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!] = avg;
    i = j + 1;
  }
  return ranks;
}

function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? 0 : sxy / denom;
}

/** Spearman rank correlation with a large-sample t-approximation for the two-sided p-value. */
export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): { rho: number | null; p: number | null; n: number } {
  const n = Math.min(x.length, y.length);
  if (n < 4) return { rho: null, p: null, n };
  const rx = rankWithTies(x);
  const ry = rankWithTies(y);
  const rho = pearson(rx, ry);
  if (Math.abs(rho) >= 1) return { rho, p: 0, n };
  const t = rho * Math.sqrt((n - 2) / (1 - rho * rho));
  const p = 2 * (1 - normCdf(Math.abs(t)));
  return { rho, p, n };
}

/** Percentile rank in [0, 1]; ties receive the average rank. */
export function percentileRanks(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 1) return out;
  const ranks = rankWithTies(values);
  for (let i = 0; i < n; i++) out[i] = (ranks[i]! - 1) / (n - 1);
  return out;
}

/** Share of the total held by the top `fraction` of observations (descending). */
export function topShare(values: ArrayLike<number>, fraction: number): number {
  const total = Array.from(values).reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;
  const sorted = Array.from(values).sort((a, b) => b - a);
  const k = Math.max(1, Math.round(sorted.length * fraction));
  return sorted.slice(0, k).reduce((s, v) => s + v, 0) / total;
}

/**
 * Global Moran's I with row-standardised weights supplied as neighbour lists, plus a
 * permutation-based pseudo p-value (two-sided around the expectation).
 */
export function moranI(
  values: ArrayLike<number>,
  neighbors: number[][],
  rng: Rng,
  permutations = 199,
): { I: number | null; expected: number; pSim: number | null; n: number } {
  const n = values.length;
  const expected = -1 / (n - 1);
  if (n < 3) return { I: null, expected, pSim: null, n };
  const m = mean(values);
  const z = Float64Array.from(values, (v) => v - m);
  const denom = z.reduce((s, v) => s + v * v, 0);
  if (denom === 0) return { I: null, expected, pSim: null, n };
  const weights = neighbors.map((nb) => (nb.length ? nb.map(() => 1 / nb.length) : []));
  const computeI = (zz: Float64Array) => {
    let num = 0;
    let W = 0;
    for (let i = 0; i < n; i++) {
      const nb = neighbors[i]!;
      const w = weights[i]!;
      for (let k = 0; k < nb.length; k++) {
        num += w[k]! * zz[i]! * zz[nb[k]!]!;
      }
      W += w.reduce((s, v) => s + v, 0);
    }
    return W === 0 ? 0 : (n / W) * (num / denom);
  };
  const I = computeI(z);
  if (permutations <= 0) return { I, expected, pSim: null, n };
  const perm = Float64Array.from(z);
  let extreme = 0;
  const target = Math.abs(I - expected);
  for (let p = 0; p < permutations; p++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = perm[i]!;
      perm[i] = perm[j]!;
      perm[j] = tmp;
    }
    const Ip = computeI(perm);
    if (Math.abs(Ip - expected) >= target) extreme++;
  }
  return { I, expected, pSim: (extreme + 1) / (permutations + 1), n };
}
