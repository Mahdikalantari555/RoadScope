/**
 * DBSCAN (Ester et al., 1996) on planar coordinates with a grid-accelerated range query.
 * Label −1 denotes noise.
 */
import { SpatialHash } from "../geo";

export interface DbscanResult {
  labels: Int32Array;
  clusters: number;
}

export function dbscan(xs: ArrayLike<number>, ys: ArrayLike<number>, epsM: number, minPts: number): DbscanResult {
  const n = xs.length;
  const labels = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const queued = new Uint8Array(n);
  const hash = new SpatialHash(epsM, xs, ys);
  const buf: number[] = [];
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const seeds = hash.query(xs[i]!, ys[i]!, epsM, buf);
    if (seeds.length < minPts) continue;

    labels[i] = clusterId;
    queued[i] = 1;
    const queue: number[] = [];
    for (const k of seeds) {
      if (!queued[k]) {
        queued[k] = 1;
        queue.push(k);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const j = queue[qi]!;
      if (labels[j] === -1) labels[j] = clusterId;
      if (visited[j]) continue;
      visited[j] = 1;
      const nb = hash.query(xs[j]!, ys[j]!, epsM, buf);
      if (nb.length >= minPts) {
        for (const k of nb) {
          if (!queued[k]) {
            queued[k] = 1;
            queue.push(k);
          }
        }
      }
    }
    clusterId++;
  }
  return { labels, clusters: clusterId };
}
