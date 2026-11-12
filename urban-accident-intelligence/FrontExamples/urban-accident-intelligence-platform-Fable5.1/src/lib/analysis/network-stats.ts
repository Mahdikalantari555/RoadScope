import { RoadNetwork, convexHull, dist, type NetPoint, type XY } from "@/lib/geo/network";

export type KernelName = "gaussian" | "epanechnikov" | "quartic";
export interface EventPoint { id: number; p: NetPoint; xy: XY; weight: number }

export function kernel(name: KernelName, u: number): number {
  if (name === "gaussian") return Math.abs(u) > 3 ? 0 : Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
  if (Math.abs(u) >= 1) return 0;
  if (name === "epanechnikov") return 0.75 * (1 - u * u);
  return (15 / 16) * (1 - u * u) ** 2; // quartic
}
const kernelCutoff = (name: KernelName, h: number) => (name === "gaussian" ? 3 * h : h);

/** Network KDE (equal-split discontinuous, Okabe & Sugihara 2012) over lixel midpoints. Units: events per metre. */
export function networkKDE(net: RoadNetwork, events: EventPoint[], h: number, k: KernelName, onProgress?: (f: number) => void) {
  const dens = new Map<number, number>();
  for (const l of net.lixels.keys()) dens.set(l, 0);
  const cut = kernelCutoff(k, h);
  events.forEach((e, i) => {
    const dm = net.lixelDistancesFrom(e.p, cut);
    for (const [lid, { d, split }] of dm) dens.set(lid, dens.get(lid)! + (e.weight * split * kernel(k, d / h)) / h);
    if (onProgress && i % 50 === 0) onProgress(i / events.length);
  });
  return dens;
}

/** Planar (Euclidean) KDE evaluated at lixel midpoints; converted to per-metre-equivalent by multiplying 2D density by the 1D normalising constant ratio. */
export function planarKDE(net: RoadNetwork, events: EventPoint[], h: number, k: KernelName) {
  const dens = new Map<number, number>();
  const cut = kernelCutoff(k, h);
  // 2D kernel normalisation constants
  const c2 = k === "gaussian" ? 1 / (2 * Math.PI) : k === "epanechnikov" ? 2 / Math.PI : 3 / Math.PI;
  const kern2 = (u: number) => (k === "gaussian" ? (u > 3 ? 0 : Math.exp(-0.5 * u * u)) : u >= 1 ? 0 : k === "epanechnikov" ? 1 - u * u : (1 - u * u) ** 2);
  for (const l of net.lixels.values()) {
    let s = 0;
    for (const e of events) { const d = dist(l.mid, e.xy); if (d <= cut) s += (e.weight * c2 * kern2(d / h)) / (h * h); }
    dens.set(l.id, s);
  }
  // scale planar density (events/m²) onto the network by multiplying by an effective corridor width = total length / area proxy
  let totalLen = 0; for (const s of net.segments.values()) totalLen += s.length;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const n of net.nodes.values()) { minx = Math.min(minx, n.xy[0]); maxx = Math.max(maxx, n.xy[0]); miny = Math.min(miny, n.xy[1]); maxy = Math.max(maxy, n.xy[1]); }
  const area = Math.max(1, (maxx - minx) * (maxy - miny));
  const width = area / totalLen; // metres of area per metre of road
  for (const [id, v] of dens) dens.set(id, v * width);
  return dens;
}

/** Network spatial weights: w_ij = exp(-d²/2δ²) for d_net ≤ δ (includes self, i.e. G_i*). */
export function buildNetworkWeights(net: RoadNetwork, delta: number, mode: "gaussian" | "binary", onProgress?: (f: number) => void) {
  const W = new Map<number, { j: number; w: number }[]>();
  let i = 0; const n = net.lixels.size;
  for (const l of net.lixels.values()) {
    const dm = net.lixelDistancesFrom({ segmentId: l.segmentId, m: l.mStart + l.length / 2 }, delta);
    const row: { j: number; w: number }[] = [];
    for (const [j, { d }] of dm) row.push({ j, w: mode === "binary" ? 1 : Math.exp(-(d * d) / (2 * delta * delta)) });
    if (!dm.has(l.id)) row.push({ j: l.id, w: 1 });
    W.set(l.id, row);
    if (onProgress && ++i % 100 === 0) onProgress(i / n);
  }
  return W;
}

export interface GiResult { id: number; x: number; z: number; p: number; pPerm: number; q: number; cls: string }
/** Getis-Ord G_i* with analytical z, conditional-permutation pseudo-p and Benjamini–Hochberg FDR. */
export function getisOrdGiStar(values: Map<number, number>, W: Map<number, { j: number; w: number }[]>, nPerm: number, seed = 7): { results: GiResult[]; moranI: number; moranZ: number; assumptions: Record<string, unknown> } {
  const ids = [...values.keys()], n = ids.length;
  const xs = ids.map((i) => values.get(i)!);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const S = Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / n - mean * mean);
  const nonzero = xs.filter((x) => x > 0).length;
  const assumptions = { n, nonZeroLixels: nonzero, variancePositive: S > 0, minSampleOk: n >= 30 && nonzero >= 10, permutations: nPerm };
  if (!(S > 0) || n < 30) return { results: [], moranI: NaN, moranZ: NaN, assumptions };
  const idxOf = new Map(ids.map((id, k) => [id, k]));
  let a = seed >>> 0; const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const erfc = (x: number) => { const z = Math.abs(x), t = 1 / (1 + 0.5 * z); const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; };
  const results: GiResult[] = [];
  // Global Moran's I (row-unstandardised, excluding self)
  let num = 0, S0 = 0, S1 = 0;
  const dev = xs.map((x) => x - mean); const m2 = dev.reduce((s, d) => s + d * d, 0);
  for (const id of ids) { const i = idxOf.get(id)!; for (const { j, w } of W.get(id) ?? []) { if (j === id) continue; const jj = idxOf.get(j)!; num += w * dev[i] * dev[jj]; S0 += w; S1 += 2 * w * w; } }
  const moranI = S0 > 0 ? (n / S0) * (num / m2) : NaN;
  const EI = -1 / (n - 1);
  const S2 = (() => { let s = 0; for (const id of ids) { let rs = 0; for (const { j, w } of W.get(id) ?? []) if (j !== id) rs += 2 * w; s += rs * rs; } return s; })();
  const varI = (n * n * S1 - n * S2 + 3 * S0 * S0) / ((n * n - 1) * S0 * S0) - EI * EI;
  const moranZ = varI > 0 ? (moranI - EI) / Math.sqrt(varI) : NaN;

  for (const id of ids) {
    const row = W.get(id) ?? [];
    let sw = 0, sw2 = 0, swx = 0;
    for (const { j, w } of row) { sw += w; sw2 += w * w; swx += w * values.get(j)!; }
    const denom = S * Math.sqrt((n * sw2 - sw * sw) / (n - 1));
    const z = denom > 0 ? (swx - mean * sw) / denom : 0;
    const p = erfc(Math.abs(z) / Math.SQRT2);
    // conditional permutation: hold x_i, permute neighbours' values among all others
    let extreme = 0; const xi = values.get(id)!; const m = row.length - 1;
    if (m > 0 && nPerm > 0) {
      const neigh = row.filter((r) => r.j !== id);
      for (let k = 0; k < nPerm; k++) {
        let s = xi;
        for (const r of neigh) { let pick = Math.floor(u() * (n - 1)); const ii = idxOf.get(id)!; if (pick >= ii) pick++; s += r.w * xs[pick]; }
        const zp = denom > 0 ? (s - mean * sw) / denom : 0;
        if (Math.abs(zp) >= Math.abs(z)) extreme++;
      }
    }
    const pPerm = (extreme + 1) / (nPerm + 1);
    results.push({ id, x: xi, z, p, pPerm, q: 1, cls: "ns" });
  }
  // BH-FDR on analytical p (pseudo-p has a 1/(nPerm+1) floor); permutation pseudo-p acts as a non-parametric guard
  const sorted = [...results].sort((x, y) => x.p - y.p);
  let prev = 1;
  for (let k = sorted.length - 1; k >= 0; k--) { const q = Math.min(prev, (sorted[k].p * n) / (k + 1)); sorted[k].q = q; prev = q; }
  const guard = (r: GiResult) => nPerm === 0 || r.pPerm <= 0.05;
  for (const r of results) r.cls = r.q < 0.01 && guard(r) ? (r.z > 0 ? "hot99" : "cold99") : r.q < 0.05 && guard(r) ? (r.z > 0 ? "hot95" : "cold95") : r.p < 0.05 ? (r.z > 0 ? "hot_uncorrected" : "cold_uncorrected") : "ns";
  return { results, moranI, moranZ, assumptions };
}

/** Network DBSCAN: ε-neighbourhood evaluated via shortest-path network distance. */
export function networkDBSCAN(net: RoadNetwork, events: EventPoint[], eps: number, minPts: number, onProgress?: (f: number) => void) {
  const targets = events.map((e) => ({ key: e.id, p: e.p }));
  const neigh = new Map<number, number[]>();
  events.forEach((e, i) => { const dm = net.pointDistancesTo(e.p, targets, eps); neigh.set(e.id, [...dm.keys()]); if (onProgress && i % 50 === 0) onProgress(i / events.length); });
  const label = new Map<number, number>(); // -1 noise
  let c = 0;
  for (const e of events) {
    if (label.has(e.id)) continue;
    const N = neigh.get(e.id)!;
    if (N.length < minPts) { label.set(e.id, -1); continue; }
    c++; label.set(e.id, c);
    const queue = [...N];
    while (queue.length) {
      const q = queue.pop()!;
      if (label.get(q) === -1) label.set(q, c);
      if (label.has(q)) continue;
      label.set(q, c);
      const Nq = neigh.get(q)!;
      if (Nq.length >= minPts) queue.push(...Nq);
    }
  }
  const byId = new Map(events.map((e) => [e.id, e]));
  const clusters: { cluster: number; size: number; hull: XY[]; segmentIds: number[]; members: number[]; meanPairwiseNet: number }[] = [];
  for (let k = 1; k <= c; k++) {
    const members = [...label.entries()].filter(([, l]) => l === k).map(([id]) => id);
    const pts = members.map((id) => byId.get(id)!.xy);
    const segs = [...new Set(members.map((id) => byId.get(id)!.p.segmentId))];
    clusters.push({ cluster: k, size: members.length, hull: convexHull(pts), segmentIds: segs, members, meanPairwiseNet: 0 });
  }
  return { labels: label, clusters, noise: [...label.values()].filter((l) => l === -1).length };
}

/** Ground-truth benchmark of a predicted lixel layer vs hidden intensity. */
export function benchmark(pred: Map<number, number>, truth: Map<number, number>, lengths: Map<number, number>, topFrac = 0.1) {
  const ids = [...truth.keys()].filter((i) => pred.has(i));
  const n = ids.length;
  const sumP = ids.reduce((a, i) => a + pred.get(i)!, 0) || 1, sumT = ids.reduce((a, i) => a + truth.get(i)!, 0) || 1;
  const p = ids.map((i) => pred.get(i)! / sumP), t = ids.map((i) => truth.get(i)! / sumT);
  const rmse = Math.sqrt(p.reduce((a, v, k) => a + (v - t[k]) ** 2, 0) / n);
  const totalLen = ids.reduce((a, i) => a + lengths.get(i)!, 0);
  const totalMass = ids.reduce((a, i) => a + truth.get(i)! * lengths.get(i)!, 0);
  const hitRate = (order: number[]) => { let len = 0, mass = 0; for (const k of order) { if (len / totalLen >= topFrac) break; len += lengths.get(ids[k])!; mass += truth.get(ids[k])! * lengths.get(ids[k])!; } return { hit: mass / totalMass, areaFrac: len / totalLen }; };
  const byPred = ids.map((_, k) => k).sort((a, b) => p[b] - p[a]);
  const byTruth = ids.map((_, k) => k).sort((a, b) => t[b] - t[a]);
  const hp = hitRate(byPred), ht = hitRate(byTruth);
  const PAI = hp.hit / hp.areaFrac, PAImax = ht.hit / ht.areaFrac;
  // Spearman
  const rank = (arr: number[]) => { const idx = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
  const rp = rank(p), rt = rank(t); const d2 = rp.reduce((a: number, v: number, k: number) => a + (v - rt[k]) ** 2, 0);
  const spearman = 1 - (6 * d2) / (n * (n * n - 1));
  const pear = (() => { const mp = p.reduce((a, b) => a + b, 0) / n, mt = t.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let k = 0; k < n; k++) { sxy += (p[k] - mp) * (t[k] - mt); sxx += (p[k] - mp) ** 2; syy += (t[k] - mt) ** 2; } return sxy / Math.sqrt(sxx * syy); })();
  return { n, rmse, PAI, PAImax, RRI: PAI / PAImax, hitRate: hp.hit, areaFraction: hp.areaFrac, spearman, pearson: pear, topFraction: topFrac };
}
