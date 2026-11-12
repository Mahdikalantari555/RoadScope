/** Deterministic PRNG helpers for reproducible synthetic datasets. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Random {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  uniform(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.uniform(min, maxInclusive + 1));
  }

  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }

  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  lognormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((s, item) => s + item.weight, 0);
    let r = this.next() * total;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item.value;
    }
    return items[items.length - 1].value;
  }

  shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** Poisson sample via Knuth for small λ. */
  poisson(lambda: number): number {
    const l = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= this.next();
    } while (p > l && k < 100);
    return k - 1;
  }
}

export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
