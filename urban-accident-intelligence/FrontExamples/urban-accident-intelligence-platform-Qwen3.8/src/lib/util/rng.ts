/**
 * Reproducible stochastic engine.
 * xoshiro128** PRNG (32-bit state, ES2017-safe) + standard distribution
 * samplers. All simulator and permutation-test randomness flows through an
 * explicitly seeded instance so that any dataset, p-value or synthetic
 * realisation can be regenerated bit-for-bit.
 */

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Rng {
  private s: number[];

  constructor(seed: number | string) {
    const seedFn = xmur3(typeof seed === "string" ? seed : `seed:${seed}`);
    this.s = [seedFn() || 1, seedFn() || 2, seedFn() || 3, seedFn() || 4].map((v) => v >>> 0);
    for (let i = 0; i < 24; i++) this.nextUint32();
  }

  private nextUint32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform [0,1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 0.9999999));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Standard normal, Marsaglia polar method. */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    return mean + sd * u * mul;
  }

  /** Poisson: Knuth for small λ, Atkinson switched algorithm for large λ. */
  poisson(lambda: number): number {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.next();
      } while (p > L);
      return k - 1;
    }
    const c = 0.767 - 3.36 / lambda;
    const beta = Math.PI / Math.sqrt(3 * lambda);
    const alpha = beta * lambda;
    const k = Math.log(c) - lambda - Math.log(beta);
    for (let iter = 0; iter < 1000; iter++) {
      const u = this.next();
      if (u <= 0 || u >= 1) continue;
      const x = (alpha - Math.log((1 - u) / u)) / beta;
      const n = Math.floor(x + 0.5);
      if (n < 0) continue;
      const y = alpha - beta * x;
      const z = 1 + Math.exp(y);
      const lhs = y + Math.log(u / (z * z));
      const rhs = k + n * Math.log(lambda) - logFactorial(n);
      if (lhs <= rhs) return n;
    }
    return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
  }

  exponential(mean = 1): number {
    return -mean * Math.log(1 - this.next());
  }

  gamma(shape: number, scale = 1): number {
    if (shape < 1) {
      return this.gamma(shape + 1, scale) * Math.pow(this.next(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x = 0;
      let v = 0;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }

  beta(a: number, b: number): number {
    const x = this.gamma(a, 1);
    const y = this.gamma(b, 1);
    return x + y === 0 ? 0.5 : x / (x + y);
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}

const LOG_FACT_CACHE: number[] = [0, 0];
export function logFactorial(n: number): number {
  if (n < LOG_FACT_CACHE.length) return LOG_FACT_CACHE[n];
  for (let i = LOG_FACT_CACHE.length; i <= n; i++) {
    LOG_FACT_CACHE[i] = LOG_FACT_CACHE[i - 1] + Math.log(i);
  }
  return LOG_FACT_CACHE[n];
}

/** Wilson–Hilferty gamma quantile approximation (documented as approximate). */
export function gammaQuantile(p: number, shape: number, scale = 1): number {
  const z = normalQuantile(p);
  const t = 1 - 1 / (9 * shape) + z / (3 * Math.sqrt(shape));
  return Math.max(0, shape * scale * t * t * t);
}

/** Acklam's inverse normal CDF. */
export function normalQuantile(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    const num = ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5];
    const den = (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1;
    return num / den;
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    const num = ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5];
    const den = (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1;
    return -num / den;
  }
  const q = p - 0.5;
  const r = q * q;
  const numA = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q;
  const denB = ((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1;
  return numA / denB;
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17, |ε| < 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  return z >= 0 ? 1 - pdf * poly : pdf * poly;
}
