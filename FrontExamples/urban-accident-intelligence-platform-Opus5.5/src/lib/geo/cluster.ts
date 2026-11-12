/** Density-based clustering (DBSCAN; Ester et al. 1996) and point-pattern diagnostics. */
import { PointGrid, convexHull, dist, type XY } from "./geometry";
import { twoSidedP } from "./stats";

export interface DbscanResult {
  labels: number[]; // -1 = noise, 0..k-1 cluster id
  clusterCount: number;
  noiseCount: number;
  coreCount: number;
}

export function dbscan(points: XY[], eps: number, minPts: number): DbscanResult {
  const n = points.length;
  const grid = new PointGrid(points, Math.max(eps, 1));
  const labels = new Array<number>(n).fill(-2); // -2 = unvisited
  let cluster = 0;
  let core = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    const nb = grid.within(points[i], eps);
    if (nb.length < minPts) {
      labels[i] = -1;
      continue;
    }
    core++;
    labels[i] = cluster;
    const queue = nb.filter((j) => j !== i);
    while (queue.length) {
      const j = queue.pop() as number;
      if (labels[j] === -1) labels[j] = cluster; // border point
      if (labels[j] !== -2) continue;
      labels[j] = cluster;
      const nb2 = grid.within(points[j], eps);
      if (nb2.length >= minPts) {
        core++;
        for (const k of nb2) if (labels[k] === -2 || labels[k] === -1) queue.push(k);
      }
    }
    cluster++;
  }
  const noise = labels.filter((l) => l === -1).length;
  return { labels, clusterCount: cluster, noiseCount: noise, coreCount: core };
}

/** Sorted k-distance curve (heuristic for selecting eps; Ester et al. 1996). */
export function kDistanceCurve(points: XY[], k: number, sample = 600): number[] {
  if (points.length <= k) return [];
  const grid = new PointGrid(points, 100);
  const step = Math.max(1, Math.floor(points.length / sample));
  const out: number[] = [];
  for (let i = 0; i < points.length; i += step) {
    let r = 100;
    let d: number[] = [];
    while (r < 20000) {
      d = grid
        .within(points[i], r)
        .filter((j) => j !== i)
        .map((j) => dist(points[i], points[j]))
        .sort((a, b) => a - b);
      if (d.length >= k) break;
      r *= 2;
    }
    if (d.length >= k) out.push(d[k - 1]);
  }
  return out.sort((a, b) => b - a);
}

export function clusterHull(points: XY[]): XY[] {
  return convexHull(points);
}

/** Clark–Evans nearest-neighbour index against planar CSR (no edge correction). */
export function clarkEvans(points: XY[], area: number) {
  const n = points.length;
  if (n < 3 || area <= 0) return null;
  const grid = new PointGrid(points, 100);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += grid.nearestDistance(i);
  const observed = sum / n;
  const density = n / area;
  const expected = 0.5 / Math.sqrt(density);
  const se = 0.26136 / Math.sqrt(n * density);
  const z = (observed - expected) / se;
  return { R: observed / expected, observed, expected, z, p: twoSidedP(z), n, areaKm2: area / 1e6 };
}
