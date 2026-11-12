/**
 * Network DBSCAN (N-DBSCAN).
 *
 * The ε-neighbourhood is evaluated strictly by shortest-path traversal on the
 * lixel-centre graph, so clusters cannot "jump" across a river, a motorway
 * verge or between two parallel carriageways that are Euclidean-close but
 * topologically distant. For every cluster we emit:
 *   • the member set (with severity weights),
 *   • a convex hull (Andrew monotone chain) in the metric CRS,
 *   • the topological subgraph (parent edges spanned),
 *   • network span vs. planar span — a direct measure of topological distortion.
 */
import type { RoadGraph } from "@/lib/geo/graph";
import { round } from "@/lib/stats/common";

export interface ClusterPoint {
  id: string;
  lixelIndex: number;
  x: number;
  y: number;
  weight: number;
  severityCode: string;
  occurredAt: number;
}

export interface NDbScanParams {
  epsilonM: number;
  minPoints: number;
  weighted?: boolean;
}

export interface MicroCluster {
  clusterId: number;
  memberIds: string[];
  size: number;
  weight: number;
  centroidX: number;
  centroidY: number;
  hull: Array<[number, number]>;
  segments: string[];
  lixels: string[];
  networkSpanM: number;
  planarSpanM: number;
  spanRatio: number;
  meanSeverityRank: number;
  dominantSeverity: string;
  firstOccurrence: number;
  lastOccurrence: number;
}

export interface NDbScanResult {
  labels: number[];
  clusters: MicroCluster[];
  noiseCount: number;
  noiseIds: string[];
  coreCount: number;
  params: NDbScanParams;
  runtimeMs: number;
}

export function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function nDbScan(graph: RoadGraph, points: ClusterPoint[], params: NDbScanParams): NDbScanResult {
  const t0 = Date.now();
  const { epsilonM, minPoints } = params;
  const n = points.length;
  const labels = new Array<number>(n).fill(-2); // -2 unvisited, -1 noise
  const byLixel = new Map<number, number[]>();
  points.forEach((p, i) => {
    if (p.lixelIndex < 0) return;
    const arr = byLixel.get(p.lixelIndex);
    if (arr) arr.push(i);
    else byLixel.set(p.lixelIndex, [i]);
  });

  const neighbourhood = (i: number): number[] => {
    const p = points[i];
    if (p.lixelIndex < 0) return [i];
    const out = new Set<number>([i]);
    for (const t of graph.spread(p.lixelIndex, epsilonM, false)) {
      for (const j of byLixel.get(t.lixelIndex) ?? []) out.add(j);
    }
    return Array.from(out);
  };

  let clusterId = -1;
  let coreCount = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    const nb = neighbourhood(i);
    if (nb.length < minPoints) {
      labels[i] = -1;
      continue;
    }
    coreCount++;
    clusterId++;
    labels[i] = clusterId;
    const queue = nb.slice();
    while (queue.length > 0) {
      const j = queue.shift() as number;
      if (labels[j] === -1) labels[j] = clusterId;
      if (labels[j] !== -2) continue;
      labels[j] = clusterId;
      const nb2 = neighbourhood(j);
      if (nb2.length >= minPoints) {
        for (const k of nb2) if (!queue.includes(k)) queue.push(k);
      }
    }
  }

  const clusters: MicroCluster[] = [];
  const noiseIds: string[] = [];
  for (let c = 0; c <= clusterId; c++) {
    const members = labels.map((l, i) => (l === c ? i : -1)).filter((i) => i >= 0);
    const pts = members.map((i) => points[i]);
    const coords = pts.map((p) => [p.x, p.y] as [number, number]);
    let cx = 0;
    let cy = 0;
    let wsum = 0;
    for (const p of pts) {
      cx += p.x * p.weight;
      cy += p.y * p.weight;
      wsum += p.weight;
    }
    const lixelSet = new Set(pts.map((p) => p.lixelIndex));
    const segmentSet = new Set<string>();
    for (const li of lixelSet) {
      const l = graph.lixels[li];
      if (l) segmentSet.add(l.segmentId);
    }
    let netSpan = 0;
    let planarSpan = 0;
    const sample = members.slice(0, 24);
    for (let a = 0; a < sample.length; a++) {
      for (let b = a + 1; b < sample.length; b++) {
        const d = graph.networkDistance(points[sample[a]].lixelIndex, points[sample[b]].lixelIndex, epsilonM * 4);
        if (Number.isFinite(d) && d > netSpan) netSpan = d;
        const pe = Math.hypot(points[sample[a]].x - points[sample[b]].x, points[sample[a]].y - points[sample[b]].y);
        if (pe > planarSpan) planarSpan = pe;
      }
    }
    const sevCount = new Map<string, number>();
    for (const p of pts) sevCount.set(p.severityCode, (sevCount.get(p.severityCode) ?? 0) + 1);
    const dominant = Array.from(sevCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
    clusters.push({
      clusterId: c,
      memberIds: pts.map((p) => p.id),
      size: pts.length,
      weight: round(wsum, 3),
      centroidX: wsum === 0 ? 0 : cx / wsum,
      centroidY: wsum === 0 ? 0 : cy / wsum,
      hull: convexHull(coords),
      segments: Array.from(segmentSet),
      lixels: Array.from(lixelSet).map((li) => graph.lixels[li]?.id ?? ""),
      networkSpanM: round(netSpan, 2),
      planarSpanM: round(planarSpan, 2),
      spanRatio: round(planarSpan === 0 ? 1 : netSpan / planarSpan, 4),
      meanSeverityRank: round(pts.reduce((s, p) => s + p.weight, 0) / Math.max(1, pts.length), 3),
      dominantSeverity: dominant,
      firstOccurrence: Math.min(...pts.map((p) => p.occurredAt)),
      lastOccurrence: Math.max(...pts.map((p) => p.occurredAt)),
    });
  }
  for (let i = 0; i < n; i++) if (labels[i] === -1) noiseIds.push(points[i].id);

  return {
    labels,
    clusters: clusters.sort((a, b) => b.size - a.size),
    noiseCount: noiseIds.length,
    noiseIds,
    coreCount,
    params,
    runtimeMs: Date.now() - t0,
  };
}
