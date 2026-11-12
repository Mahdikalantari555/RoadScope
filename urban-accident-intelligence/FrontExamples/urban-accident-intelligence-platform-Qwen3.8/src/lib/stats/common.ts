/** Descriptive statistics, correlation, binning and distribution helpers. */

export function mean(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return v.length ? s / v.length : 0;
}

export function variance(v: ArrayLike<number>, sample = true): number {
  const n = v.length;
  if (n < 2) return 0;
  const m = mean(v);
  let s = 0;
  for (let i = 0; i < n; i++) s += (v[i] - m) ** 2;
  return s / (sample ? n - 1 : n);
}

export function std(v: ArrayLike<number>, sample = true): number {
  return Math.sqrt(variance(v, sample));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(v.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].x === idx[i].x) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k].i] = avg;
    i = j + 1;
  }
  return out;
}

export function spearman(a: number[], b: number[]): number {
  return pearson(ranks(a), ranks(b));
}

export function rmse(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; s += (a[i] - b[i]) ** 2, i++);
  return Math.sqrt(s / n);
}

export function mae(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

export function r2(observed: number[], predicted: number[]): number {
  const m = mean(observed);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < observed.length; i++) {
    ssRes += (observed[i] - predicted[i]) ** 2;
    ssTot += (observed[i] - m) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

export function standardize(v: number[]): number[] {
  const min = Math.min(...v);
  const max = Math.max(...v);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return v.map(() => 0);
  return v.map((x) => (x - min) / (max - min));
}

export function zScore(v: number[]): number[] {
  const m = mean(v);
  const s = std(v);
  if (s === 0) return v.map(() => 0);
  return v.map((x) => (x - m) / s);
}

/** Benjamini–Hochberg step-up FDR control. */
export function bhFdr(pValues: number[], alpha = 0.05): { qValues: number[]; rejected: boolean[]; kStar: number } {
  const n = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const qValues = new Array<number>(n).fill(1);
  const rejected = new Array<boolean>(n).fill(false);
  let prev = 1;
  let kStar = 0;
  for (let k = n; k >= 1; k--) {
    const q = Math.min(prev, (order[k - 1].p * n) / k);
    prev = q;
    qValues[order[k - 1].i] = q;
  }
  for (let k = 1; k <= n; k++) {
    if (order[k - 1].p <= (k / n) * alpha) kStar = k;
  }
  for (let k = 1; k <= kStar; k++) rejected[order[k - 1].i] = true;
  return { qValues, rejected, kStar };
}

export interface TimeBin {
  key: string;
  startMs: number;
  endMs: number;
  label: string;
}

export type BinUnit = "hour" | "day" | "week" | "month";

export function buildTimeBins(startMs: number, endMs: number, unit: BinUnit): TimeBin[] {
  const size = unit === "hour" ? 3600e3 : unit === "day" ? 86400e3 : unit === "week" ? 7 * 86400e3 : 30 * 86400e3;
  const out: TimeBin[] = [];
  const first = Math.floor(startMs / size) * size;
  for (let t = first; t < endMs && out.length < 2000; t += size) {
    const d = new Date(t);
    out.push({
      key: d.toISOString().slice(0, unit === "hour" ? 13 : 10),
      startMs: t,
      endMs: t + size,
      label:
        unit === "hour"
          ? d.toISOString().slice(5, 13).replace("T", " ") + "h"
          : unit === "week"
            ? `W${isoWeek(d)}`
            : unit === "month"
              ? d.toISOString().slice(0, 7)
              : d.toISOString().slice(0, 10),
    });
  }
  return out;
}

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** 7 × 24 diurnal matrix (rows = day of week starting Monday). */
export function diurnalMatrix(timestamps: number[], weights: number[]): number[][] {
  const m: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (let i = 0; i < timestamps.length; i++) {
    const d = new Date(timestamps[i]);
    const dow = (d.getUTCDay() + 6) % 7;
    m[dow][d.getUTCHours()] += weights[i] ?? 1;
  }
  return m;
}

export function gini(v: number[]): number {
  const sorted = v.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * sorted[i];
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return (2 * cum) / (n * total) - (n + 1) / n;
}

export function round(v: number, digits = 4): number {
  if (!Number.isFinite(v)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
