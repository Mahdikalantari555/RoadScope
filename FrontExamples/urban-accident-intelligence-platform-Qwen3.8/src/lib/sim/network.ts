/**
 * Synthetic topologically-valid urban road network generator.
 *
 * Produces a jittered block lattice with hierarchical corridors (motorway /
 * primary / secondary / tertiary / residential / service), signalised and
 * grade-separated junctions, curvilinear centrelines (real sinuosity for LRS),
 * exposure proxies (AADT with deliberate missingness) and environmental
 * attributes. Output is metric (UTM) throughout.
 */
import { crsForOrigin, toUtm, type ProjectedCrs } from "@/lib/geo/projection";
import { polyLineLengthLocal, type GraphNode, type GraphSegment } from "./networkTypes";
import { Rng } from "@/lib/util/rng";

export interface NetworkGenParams {
  seed: number;
  originLon: number;
  originLat: number;
  gridCols: number;
  gridRows: number;
  blockXM: number;
  blockYM: number;
  jitterSigmaM: number;
  dropProbability: number;
  arterialEvery: number;
  motorwayRow: number;
  missingAadtShare: number;
  curveSigmaM: number;
}

export const DEFAULT_NETWORK_PARAMS: NetworkGenParams = {
  seed: 20260117,
  originLon: 13.4049,
  originLat: 52.5201,
  gridCols: 15,
  gridRows: 13,
  blockXM: 235,
  blockYM: 215,
  jitterSigmaM: 16,
  dropProbability: 0.055,
  arterialEvery: 4,
  motorwayRow: 2,
  missingAadtShare: 0.14,
  curveSigmaM: 9,
};

const CLASS_PROFILE: Record<
  string,
  { ordinal: number; lanes: number[]; speed: [number, number]; aadtMedian: number; aadtSigma: number }
> = {
  motorway: { ordinal: 1, lanes: [4, 6], speed: [100, 120], aadtMedian: 62000, aadtSigma: 0.28 },
  primary: { ordinal: 2, lanes: [2, 4], speed: [60, 70], aadtMedian: 26000, aadtSigma: 0.32 },
  secondary: { ordinal: 3, lanes: [2, 2], speed: [50, 60], aadtMedian: 12500, aadtSigma: 0.35 },
  tertiary: { ordinal: 4, lanes: [2, 2], speed: [50, 50], aadtMedian: 6200, aadtSigma: 0.38 },
  residential: { ordinal: 5, lanes: [2, 2], speed: [30, 50], aadtMedian: 2100, aadtSigma: 0.45 },
  service: { ordinal: 6, lanes: [1, 2], speed: [20, 30], aadtMedian: 620, aadtSigma: 0.55 },
};

const STREETS_A = ["Alder", "Beacon", "Cinder", "Delta", "Ember", "Fenwick", "Garnet", "Halcyon", "Ibis", "Juniper", "Kestrel", "Lumen", "Marlow", "Northgate", "Orchard"];
const STREETS_B = ["Avenue", "Boulevard", "Street", "Lane", "Way", "Promenade", "Row", "Drive"];

export interface GeneratedNetwork {
  nodes: GraphNode[];
  segments: GraphSegment[];
  crs: ProjectedCrs;
  extent: { minX: number; minY: number; maxX: number; maxY: number };
}

export function generateNetwork(params: NetworkGenParams): GeneratedNetwork {
  const rng = new Rng(`network:${params.seed}`);
  const crs = crsForOrigin(params.originLon, params.originLat);
  const origin = toUtm(params.originLon, params.originLat, crs);

  const cols = params.gridCols;
  const rows = params.gridRows;
  const nodeGrid: string[][] = [];
  const nodeById = new Map<string, GraphNode>();

  for (let j = 0; j <= rows; j++) {
    nodeGrid[j] = [];
    for (let i = 0; i <= cols; i++) {
      const id = `N${i}_${j}`;
      const border = i === 0 || j === 0 || i === cols || j === rows;
      const jitter = border ? params.jitterSigmaM * 0.35 : params.jitterSigmaM;
      const x = origin.x + (i - cols / 2) * params.blockXM + (border ? 0 : rng.normal(0, jitter));
      const y = origin.y + (j - rows / 2) * params.blockYM + (border ? 0 : rng.normal(0, jitter));
      const gradeSep = j === params.motorwayRow || j === params.motorwayRow + 1;
      const node: GraphNode = {
        id,
        x,
        y,
        degree: 0,
        control: "none",
        nodeType: border ? "boundary" : gradeSep ? "grade_separator" : "intersection",
        isGradeSeparated: gradeSep && !border,
      };
      nodeGrid[j][i] = id;
      nodeById.set(id, node);
    }
  }

  interface RawEdge {
    a: string;
    b: string;
    horizontal: boolean;
    i: number;
    j: number;
  }
  const edges: RawEdge[] = [];
  const kept = new Set<string>();

  const unionFind = new Map<string, string>();
  const find = (v: string): string => {
    let root = v;
    while (unionFind.get(root) !== root) root = unionFind.get(root) as string;
    let cur = v;
    while (unionFind.get(cur) !== cur) {
      const next = unionFind.get(cur) as string;
      unionFind.set(cur, root);
      cur = next;
    }
    return root;
  };
  const unite = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) unionFind.set(ra, rb);
  };
  for (const id of nodeById.keys()) unionFind.set(id, id);

  const allEdges: RawEdge[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i < cols; i++) allEdges.push({ a: nodeGrid[j][i], b: nodeGrid[j][i + 1], horizontal: true, i, j });
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= cols; i++) allEdges.push({ a: nodeGrid[j][i], b: nodeGrid[j + 1][i], horizontal: false, i, j });
  }

  const isCorridor = (e: RawEdge): boolean => {
    if (e.horizontal && e.j % params.arterialEvery === 0) return true;
    if (!e.horizontal && e.i % params.arterialEvery === 0) return true;
    if (e.horizontal && (e.j === params.motorwayRow || e.j === params.motorwayRow + 1)) return true;
    return false;
  };

  // Keep all corridor edges; thin the local mesh (parks / superblocks), then
  // repair any disconnection so the graph stays a single connected component.
  for (const e of allEdges) {
    if (!isCorridor(e) && rng.next() < params.dropProbability) continue;
    edges.push(e);
    kept.add(`${e.a}|${e.b}`);
    unite(e.a, e.b);
  }
  for (const e of allEdges) {
    if (kept.has(`${e.a}|${e.b}`)) continue;
    if (find(e.a) !== find(e.b)) {
      edges.push(e);
      kept.add(`${e.a}|${e.b}`);
      unite(e.a, e.b);
    }
  }

  const segments: GraphSegment[] = [];
  const degree = new Map<string, number>();
  const incidentClass = new Map<string, number>();

  edges.forEach((e, idx) => {
    const na = nodeById.get(e.a)!;
    const nb = nodeById.get(e.b)!;
    const chord = Math.hypot(nb.x - na.x, nb.y - na.y);
    const corridor = isCorridor(e);
    const distFromCentre = Math.hypot((e.i - cols / 2) * params.blockXM, (e.j - rows / 2) * params.blockYM);
    const motorway = e.horizontal && (e.j === params.motorwayRow || e.j === params.motorwayRow + 1);
    let roadClass: keyof typeof CLASS_PROFILE = "residential";
    if (motorway) roadClass = "motorway";
    else if (corridor) roadClass = distFromCentre < 900 ? "primary" : "secondary";
    else if (distFromCentre < 1500) roadClass = rng.next() < 0.55 ? "tertiary" : "residential";
    else if (rng.next() < 0.12) roadClass = "service";
    else roadClass = rng.next() < 0.35 ? "tertiary" : "residential";

    const prof = CLASS_PROFILE[roadClass];
    const lanes = rng.int(prof.lanes[0], prof.lanes[1]);
    const speed = rng.range(prof.speed[0], prof.speed[1]);
    const aadtRaw = Math.round(prof.aadtMedian * Math.exp(rng.normal(0, prof.aadtSigma)));
    const missing = rng.next() < params.missingAadtShare;
    const aadt = missing ? null : aadtRaw;

    // Curvilinear centreline: mid-vertex offset perpendicular to the chord.
    const curveSigma = roadClass === "motorway" ? params.curveSigmaM * 0.25 : roadClass === "residential" ? params.curveSigmaM * 1.6 : params.curveSigmaM;
    const mx = (na.x + nb.x) / 2;
    const my = (na.y + nb.y) / 2;
    const nx = -(nb.y - na.y) / Math.max(1e-6, chord);
    const ny = (nb.x - na.x) / Math.max(1e-6, chord);
    const off = rng.normal(0, curveSigma);
    const shape: Array<[number, number]> = [
      [na.x, na.y],
      [mx + nx * off, my + ny * off],
      [nb.x, nb.y],
    ];
    const curv = polyLineLengthLocal(shape);
    const sinuosity = curv / Math.max(1e-6, chord);
    const lengthKm = curv / 1000;

    const name = `${STREETS_A[(idx * 7 + e.i * 3 + e.j * 5) % STREETS_A.length]} ${
      roadClass === "motorway" ? "Expressway" : STREETS_B[(idx + e.i + e.j) % STREETS_B.length]
    }`;

    segments.push({
      id: `E${idx}`,
      fromNodeId: e.a,
      toNodeId: e.b,
      x1: na.x,
      y1: na.y,
      x2: nb.x,
      y2: nb.y,
      shape,
      lengthM: chord,
      roadClass,
      classOrdinal: prof.ordinal,
      name,
      lanes,
      speedLimitKph: Math.round(speed),
      aadt,
      sinuosity,
      curvaturePerKm: Math.abs(off) / Math.max(1e-6, lengthKm) / 10,
      lighting: roadClass === "motorway" || distFromCentre < 1800 ? "lit" : rng.next() < 0.45 ? "unlit" : "lit",
      surface: rng.next() < 0.06 ? "cobble" : rng.next() < 0.05 ? "concrete" : "asphalt",
      isBridge: motorway && rng.next() < 0.25,
      sidewalk: roadClass !== "motorway",
      cycleLane: roadClass === "primary" || roadClass === "secondary" ? rng.next() < 0.6 : rng.next() < 0.15,
      vktPerDay: aadt === null ? null : aadt * lengthKm,
    });

    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    incidentClass.set(e.a, Math.min(incidentClass.get(e.a) ?? 99, prof.ordinal));
    incidentClass.set(e.b, Math.min(incidentClass.get(e.b) ?? 99, prof.ordinal));
  });

  const nodes: GraphNode[] = [];
  for (const [id, n] of nodeById) {
    const d = degree.get(id) ?? 0;
    if (d === 0) continue;
    const best = incidentClass.get(id) ?? 6;
    let control: GraphNode["control"] = "none";
    if (d >= 4 && best <= 3) control = rng.next() < 0.08 ? "roundabout" : "signal";
    else if (d >= 4) control = "stop";
    else if (d === 3) control = best <= 2 ? "signal" : "yield";
    if (n.isGradeSeparated && best === 1) control = "interchange";
    nodes.push({ ...n, degree: d, control });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  return { nodes, segments, crs, extent: { minX, minY, maxX, maxY } };
}
