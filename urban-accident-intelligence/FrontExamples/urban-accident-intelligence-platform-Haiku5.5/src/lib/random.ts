/**
 * Deterministic pseudo-random utilities. Every synthetic dataset is reproducible from its seed.
 */

export type Rng = () => number;

/** Mulberry32: small, fast, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uniform(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng();
}

export function normal(rng: Rng, mu = 0, sigma = 1): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function logNormal(rng: Rng, median: number, sigma: number): number {
  return median * Math.exp(sigma * normal(rng));
}

export function exponential(rng: Rng, mean: number): number {
  return -mean * Math.log(Math.max(rng(), 1e-12));
}

/** Cumulative distribution for weighted sampling. */
export function cumulative(weights: ArrayLike<number>): Float64Array {
  const out = new Float64Array(weights.length);
  let s = 0;
  for (let i = 0; i < weights.length; i++) {
    s += Math.max(0, weights[i]!);
    out[i] = s;
  }
  return out;
}

export function sampleCumulative(rng: Rng, cum: Float64Array): number {
  const total = cum[cum.length - 1] ?? 0;
  const target = rng() * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cum[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function weightedIndex(rng: Rng, weights: ArrayLike<number>): number {
  return sampleCumulative(rng, cumulative(weights));
}

export function randomCode(rng: Rng, length: number, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}
