/** Statistical primitives (no external dependencies, deterministic). */

/** Standard normal CDF — Abramowitz & Stegun 26.2.17 (|ε| < 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/** Two-sided p-value for a z-score. */
export function twoSidedP(z: number): number {
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

/** Inverse standard normal CDF — Acklam's rational approximation (rel. error < 1.15e-9). */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Chi-square quantile — Wilson–Hilferty approximation. */
export function chiSquareInv(p: number, k: number): number {
  if (k <= 0) return 0;
  const z = normalInv(p);
  const h = 2 / (9 * k);
  return Math.max(0, k * Math.pow(1 - h + z * Math.sqrt(h), 3));
}

/** Upper-tail chi-square probability P(X ≥ x) — Wilson–Hilferty. */
export function chiSquareSf(x: number, k: number): number {
  if (x <= 0) return 1;
  const h = 2 / (9 * k);
  const z = (Math.pow(x / k, 1 / 3) - (1 - h)) / Math.sqrt(h);
  return 1 - normalCdf(z);
}

/** Exact (Garwood) Poisson confidence interval for an observed count. */
export function poissonCI(n: number, level = 0.95): [number, number] {
  const alpha = 1 - level;
  const lower = n === 0 ? 0 : chiSquareInv(alpha / 2, 2 * n) / 2;
  const upper = chiSquareInv(1 - alpha / 2, 2 * n + 2) / 2;
  return [lower, upper];
}

/** Rate ratio of two Poisson rates with log-normal (Wald) 95% CI. */
export function rateRatio(n1: number, e1: number, n0: number, e0: number, level = 0.95) {
  const z = normalInv(1 - (1 - level) / 2);
  if (n1 === 0 || n0 === 0 || e1 === 0 || e0 === 0) return { rr: NaN, lower: NaN, upper: NaN, p: NaN };
  const rr = n1 / e1 / (n0 / e0);
  const se = Math.sqrt(1 / n1 + 1 / n0);
  const zz = Math.log(rr) / se;
  return { rr, lower: rr * Math.exp(-z * se), upper: rr * Math.exp(z * se), p: twoSidedP(zz) };
}

/** Benjamini–Hochberg FDR adjusted p-values (q-values), order preserved. */
export function benjaminiHochberg(p: number[]): number[] {
  const n = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(n);
  let min = 1;
  for (let r = n - 1; r >= 0; r--) {
    const [v, i] = order[r];
    min = Math.min(min, (v * n) / (r + 1));
    q[i] = min;
  }
  return q;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

export function variance(xs: number[], sample = true): number {
  const m = mean(xs);
  const s = xs.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return s / (xs.length - (sample ? 1 : 0));
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Gini coefficient of non-negative values (spatial concentration measure). */
export function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const s = v.reduce((a, b) => a + b, 0);
  if (n === 0 || s === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
  return (2 * cum) / (n * s) - (n + 1) / n;
}

/** Seeded PRNG — mulberry32. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function poissonSample(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian(rng)));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}
