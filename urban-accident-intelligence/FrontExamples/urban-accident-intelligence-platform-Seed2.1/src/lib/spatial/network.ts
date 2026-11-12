// Network graph data structure and shortest-path algorithms for
// network-constrained spatial analysis.
//
// The graph stores edges as bi-directional by default (undirected), with
// one-way support for future routing. Edge weights are metric lengths.

import { metricDistance, type MetricPoint } from "./crs";

export interface GraphNode {
  id: number;
  x: number;
  y: number;
  incidentEdges: number[];
}

export interface GraphEdge {
  id: number;
  from: number;
  to: number;
  lengthM: number;
  // polyline points including endpoints for projection
  polyline: MetricPoint[];
  // reference to database segment/lixel
  dbSegmentId?: number;
  dbLixelId?: number;
  roadClass?: string;
  hierarchyLevel?: number;
}

export class RoadNetworkGraph {
  nodes = new Map<number, GraphNode>();
  edges: GraphEdge[] = [];
  // adjacency: nodeId -> Array of {neighbor, edgeId, weight}
  adj = new Map<number, Array<{ neighbor: number; edgeId: number; weight: number }>>();

  addNode(id: number, x: number, y: number): GraphNode {
    if (this.nodes.has(id)) return this.nodes.get(id)!;
    const n: GraphNode = { id, x, y, incidentEdges: [] };
    this.nodes.set(id, n);
    this.adj.set(id, []);
    return n;
  }

  addEdge(
    id: number,
    from: number,
    to: number,
    polyline: MetricPoint[],
    opts: {
      dbSegmentId?: number;
      dbLixelId?: number;
      roadClass?: string;
      hierarchyLevel?: number;
      oneway?: boolean;
    } = {}
  ): GraphEdge {
    // ensure endpoints exist
    if (!this.nodes.has(from)) {
      const p0 = polyline[0];
      this.addNode(from, p0.x, p0.y);
    }
    if (!this.nodes.has(to)) {
      const pn = polyline[polyline.length - 1];
      this.addNode(to, pn.x, pn.y);
    }
    let length = 0;
    for (let i = 0; i < polyline.length - 1; i++) {
      length += metricDistance(
        polyline[i].x, polyline[i].y,
        polyline[i + 1].x, polyline[i + 1].y
      );
    }
    const edge: GraphEdge = {
      id,
      from,
      to,
      lengthM: length,
      polyline,
      dbSegmentId: opts.dbSegmentId,
      dbLixelId: opts.dbLixelId,
      roadClass: opts.roadClass,
      hierarchyLevel: opts.hierarchyLevel,
    };
    this.edges.push(edge);
    this.nodes.get(from)!.incidentEdges.push(id);
    this.nodes.get(to)!.incidentEdges.push(id);
    this.adj.get(from)!.push({ neighbor: to, edgeId: id, weight: length });
    if (!opts.oneway) {
      this.adj.get(to)!.push({ neighbor: from, edgeId: id, weight: length });
    }
    return edge;
  }

  /**
   * Single-source shortest path from a node using Dijkstra.
   * Returns map of nodeId -> distance in meters.
   */
  dijkstraFromNode(sourceId: number, maxDistanceM = Infinity): Map<number, number> {
    const dist = new Map<number, number>();
    dist.set(sourceId, 0);
    const visited = new Set<number>();
    // Simple priority queue via sorted array; sufficient for ~few thousand nodes
    const pq: Array<{ id: number; d: number }> = [{ id: sourceId, d: 0 }];
    while (pq.length) {
      // extract min
      pq.sort((a, b) => a.d - b.d);
      const current = pq.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      if (current.d > maxDistanceM) break;
      const neighbors = this.adj.get(current.id)!;
      for (const n of neighbors) {
        const newD = current.d + n.weight;
        if (newD > maxDistanceM) continue;
        const existing = dist.get(n.neighbor);
        if (existing === undefined || newD < existing) {
          dist.set(n.neighbor, newD);
          pq.push({ id: n.neighbor, d: newD });
        }
      }
    }
    return dist;
  }

  /**
   * Project a query point to the closest edge, returning edge id,
   * projected point, distance from query to edge, and m-offset along edge.
   */
  snapToEdge(query: MetricPoint): {
    edgeId: number;
    point: MetricPoint;
    distance: number;
    offsetM: number;
    edgeFrom: number;
    edgeTo: number;
    edgeLength: number;
  } {
    let best: ReturnType<RoadNetworkGraph["snapToEdge"]> | null = null;
    for (const edge of this.edges) {
      const snap = closestOnPolyline(edge.polyline, query);
      if (!best || snap.distance < best.distance) {
        best = {
          edgeId: edge.id,
          point: snap.point,
          distance: snap.distance,
          offsetM: snap.offsetM,
          edgeFrom: edge.from,
          edgeTo: edge.to,
          edgeLength: edge.lengthM,
        };
      }
    }
    return best!;
  }
}

function closestOnPolyline(
  poly: MetricPoint[],
  q: MetricPoint
): { point: MetricPoint; distance: number; offsetM: number } {
  let bestD = Infinity;
  let bestP: MetricPoint = poly[0];
  let bestOffset = 0;
  let cum = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen2 = dx * dx + dy * dy;
    let t = 0;
    if (segLen2 > 0) {
      t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / segLen2;
      t = Math.max(0, Math.min(1, t));
    }
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const segLen = Math.sqrt(segLen2);
    const d = metricDistance(px, py, q.x, q.y);
    if (d < bestD) {
      bestD = d;
      bestP = { x: px, y: py };
      bestOffset = cum + t * segLen;
    }
    cum += segLen;
  }
  return { point: bestP, distance: bestD, offsetM: bestOffset };
}

/**
 * Compute shortest-path network distance between two on-edge points.
 *
 * The on-network distance is:
 *   d = min(
 *     offsetA + d_node(fromA, fromB) + offsetB,
 *     offsetA + d_node(fromA, toB) + (lenB - offsetB),
 *     (lenA - offsetA) + d_node(toA, fromB) + offsetB,
 *     (lenA - offsetA) + d_node(toA, toB) + (lenB - offsetB)
 *   )
 *
 * For simplicity we use the endpoint combination producing the minimum,
 * running Dijkstra from each endpoint of A. For production use, this would
 * be optimized with pre-computed node-distance matrices.
 */
export function networkDistanceBetweenEdgePoints(
  graph: RoadNetworkGraph,
  a: { edgeId: number; offsetM: number },
  b: { edgeId: number; offsetM: number }
): number {
  if (a.edgeId === b.edgeId) {
    return Math.abs(a.offsetM - b.offsetM);
  }
  const eA = graph.edges.find(e => e.id === a.edgeId)!;
  const eB = graph.edges.find(e => e.id === b.edgeId)!;

  // run Dijkstra from both endpoints of A
  const dFromA = graph.dijkstraFromNode(eA.from);
  const dToA = graph.dijkstraFromNode(eA.to);

  const candidates = [
    (dFromA.get(eB.from) ?? Infinity) + a.offsetM + b.offsetM,
    (dFromA.get(eB.to) ?? Infinity) + a.offsetM + (eB.lengthM - b.offsetM),
    (dToA.get(eB.from) ?? Infinity) + (eA.lengthM - a.offsetM) + b.offsetM,
    (dToA.get(eB.to) ?? Infinity) + (eA.lengthM - a.offsetM) + (eB.lengthM - b.offsetM),
  ];
  return Math.min(...candidates);
}
