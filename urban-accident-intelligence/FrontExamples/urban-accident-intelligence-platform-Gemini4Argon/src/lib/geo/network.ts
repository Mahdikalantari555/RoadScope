import {
  metricToGeo,
  computePolylineLengthM,
  computeSinuosity,
  slicePolylineByM,
  interpolateAlongPolylineM,
  euclideanDistanceM,
} from "./crs";

export interface RoadNodeDef {
  nodeCode: string;
  name: string;
  xM: number;
  yM: number;
  lon: number;
  lat: number;
  degree: number;
  isSignalized: boolean;
  elevationM: number;
}

export interface RoadSegmentDef {
  segmentCode: string;
  name: string;
  roadClass: "motorway" | "arterial" | "collector" | "local";
  fromNodeCode: string;
  toNodeCode: string;
  isDirected: boolean;
  isOverpass: boolean;
  lengthM: number;
  speedLimitKmh: number;
  laneCount: number;
  sinuosity: number;
  aadt: number;
  spfAlpha: number;
  spfBeta: number;
  spfOverdispersionPhi: number;
  coordsMetric: [number, number][];
  coordsGeo: [number, number][];
  bboxMinX: number;
  bboxMinY: number;
  bboxMaxX: number;
  bboxMaxY: number;
}

export interface LixelDef {
  lixelCode: string;
  segmentCode: string;
  lixelIndex: number;
  mStartM: number;
  mEndM: number;
  lengthM: number;
  centerXM: number;
  centerYM: number;
  centerLon: number;
  centerLat: number;
  distToNearestJunctionM: number;
  coordsMetric: [number, number][];
  coordsGeo: [number, number][];
}

/**
 * Generates the canonical urban topological road network in EPSG:32618 (Metric UTM 18N).
 * Includes:
 * - 5x4 urban grid of Arterial & Collector corridors
 * - Diagonal Broadway-style multimodal arterial cutting across junctions
 * - Elevated I-278 Urban Expressway Overpass crossing local/collector streets WITHOUT
 *   planar intersection nodes (connected only at ramp junctions N01, N10, N20) to
 *   rigorously demonstrate Network vs. Planar distortion & overpass map-matching!
 * - Parallel waterfront collector & local streets
 */
export function buildCanonicalRoadNetwork(): {
  nodes: RoadNodeDef[];
  segments: RoadSegmentDef[];
} {
  // Base 5 cols x 4 rows grid + 4 overpass/ramp nodes = 24 topological nodes
  const colsX = [583400, 583950, 584500, 585050, 585600];
  const rowsY = [4511400, 4511950, 4512500, 4513050];

  const rawNodes: Omit<RoadNodeDef, "lon" | "lat" | "degree">[] = [];

  const aveNames = ["Westside Ave", "7th Corridor", "Central Pkwy", "Lexington Art.", "East River Dr"];
  const stNames = ["South Dock St", "Mercer Blvd", "Midtown Cross", "North Gate Ave"];

  for (let r = 0; r < rowsY.length; r++) {
    for (let c = 0; c < colsX.length; c++) {
      const idx = r * colsX.length + c + 1;
      const code = `N${String(idx).padStart(2, "0")}`;
      // Slight realistic urban survey perturbation for non-trivial geometry
      const jitterX = ((r * 7 + c * 13) % 5 - 2) * 12;
      const jitterY = ((r * 11 + c * 5) % 5 - 2) * 12;
      const xM = colsX[c] + jitterX;
      const yM = rowsY[r] + jitterY;
      const isArterialJunc = c === 1 || c === 2 || r === 1 || r === 2;
      rawNodes.push({
        nodeCode: code,
        name: `${aveNames[c]} & ${stNames[r]}`,
        xM,
        yM,
        isSignalized: isArterialJunc,
        elevationM: 10 + r * 2.5 + c * 1.2,
      });
    }
  }

  // Add 4 special nodes: Overpass Interchange Ramps & Parallel Slip Corridor
  rawNodes.push(
    {
      nodeCode: "N21",
      name: "West Viaduct Ramp Interchange",
      xM: 583400,
      yM: 4512210,
      isSignalized: true,
      elevationM: 24.5,
    },
    {
      nodeCode: "N22",
      name: "Central Elevated Deck Pier (Grade-Separated)",
      xM: 584500,
      yM: 4512240,
      isSignalized: false,
      elevationM: 28.0,
    },
    {
      nodeCode: "N23",
      name: "East Viaduct Terminal Ramp",
      xM: 585600,
      yM: 4512210,
      isSignalized: true,
      elevationM: 24.0,
    },
    {
      nodeCode: "N24",
      name: "Parallel Service Alley Hub",
      xM: 584500,
      yM: 4512020,
      isSignalized: false,
      elevationM: 12.0,
    }
  );

  const nodeMap = new Map<string, RoadNodeDef>();
  const degreeCount = new Map<string, number>();

  for (const rn of rawNodes) {
    const [lon, lat] = metricToGeo(rn.xM, rn.yM);
    nodeMap.set(rn.nodeCode, {
      ...rn,
      lon,
      lat,
      degree: 0,
    });
    degreeCount.set(rn.nodeCode, 0);
  }

  interface EdgeSpec {
    from: string;
    to: string;
    name: string;
    roadClass: "motorway" | "arterial" | "collector" | "local";
    isOverpass?: boolean;
    midOffset?: [number, number];
  }

  const edgeSpecs: EdgeSpec[] = [];

  // Horizontal East-West edges across the 4 rows
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const fromIdx = r * 5 + c + 1;
      const toIdx = r * 5 + c + 2;
      const from = `N${String(fromIdx).padStart(2, "0")}`;
      const to = `N${String(toIdx).padStart(2, "0")}`;
      const roadClass =
        r === 1 || r === 2
          ? "arterial"
          : r === 0
          ? "collector"
          : "local";
      const curveOffset: [number, number] | undefined =
        r === 2 ? [0, (c % 2 === 0 ? 1 : -1) * 22] : undefined;
      edgeSpecs.push({
        from,
        to,
        name: `${stNames[r]} Sec-${c + 1}`,
        roadClass,
        midOffset: curveOffset,
      });
    }
  }

  // Vertical North-South edges across the 5 columns
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 3; r++) {
      const fromIdx = r * 5 + c + 1;
      const toIdx = (r + 1) * 5 + c + 1;
      const from = `N${String(fromIdx).padStart(2, "0")}`;
      const to = `N${String(toIdx).padStart(2, "0")}`;
      const roadClass =
        c === 2
          ? "arterial"
          : c === 1 || c === 3
          ? "collector"
          : "local";
      const curveOffset: [number, number] | undefined =
        c === 4 ? [26, 0] : undefined;
      edgeSpecs.push({
        from,
        to,
        name: `${aveNames[c]} Seg-${r + 1}`,
        roadClass,
        midOffset: curveOffset,
      });
    }
  }

  // Diagonal Broadway Multimodal Arterial cutting across major junctions
  edgeSpecs.push(
    {
      from: "N01",
      to: "N07",
      name: "Grand Diagonal Way SW",
      roadClass: "arterial",
      midOffset: [-18, 15],
    },
    {
      from: "N07",
      to: "N13",
      name: "Grand Diagonal Way Central",
      roadClass: "arterial",
      midOffset: [16, -14],
    },
    {
      from: "N13",
      to: "N19",
      name: "Grand Diagonal Way NE",
      roadClass: "arterial",
      midOffset: [-15, 18],
    },
    {
      from: "N05",
      to: "N09",
      name: "Tech Hub Connector",
      roadClass: "collector",
    }
  );

  // Elevated Grade-Separated Motorway Overpass (N21 -> N22 -> N23)
  // Crosses over N07-N12 and N09-N14 in 2D without connecting to them topologically!
  // Connected to surface grid ONLY via West & East Ramp nodes (N06-N21, N21-N11, N10-N23, N23-N15)
  edgeSpecs.push(
    {
      from: "N21",
      to: "N22",
      name: "I-278 Elevated Viaduct West Span (Overpass)",
      roadClass: "motorway",
      isOverpass: true,
      midOffset: [0, 28],
    },
    {
      from: "N22",
      to: "N23",
      name: "I-278 Elevated Viaduct East Span (Overpass)",
      roadClass: "motorway",
      isOverpass: true,
      midOffset: [0, -25],
    },
    {
      from: "N06",
      to: "N21",
      name: "West Viaduct Access Ramp S",
      roadClass: "collector",
    },
    {
      from: "N21",
      to: "N11",
      name: "West Viaduct Access Ramp N",
      roadClass: "collector",
    },
    {
      from: "N10",
      to: "N23",
      name: "East Viaduct Exit Ramp S",
      roadClass: "collector",
    },
    {
      from: "N23",
      to: "N15",
      name: "East Viaduct Exit Ramp N",
      roadClass: "collector",
    }
  );

  // Parallel close-proximity local service road near Mercer Blvd (N07 -> N24 -> N09)
  // Only ~65m north of N07-N08-N09, creating classic Euclidean KDE bleed across parallel roads!
  edgeSpecs.push(
    {
      from: "N07",
      to: "N24",
      name: "Mercer Parallel Slip Lane W",
      roadClass: "local",
      midOffset: [0, 12],
    },
    {
      from: "N24",
      to: "N09",
      name: "Mercer Parallel Slip Lane E",
      roadClass: "local",
      midOffset: [0, 12],
    }
  );

  const classDefaults: Record<
    RoadSegmentDef["roadClass"],
    {
      speed: number;
      lanes: number;
      aadt: number;
      spfAlpha: number;
      spfBeta: number;
      phi: number;
    }
  > = {
    motorway: {
      speed: 90,
      lanes: 6,
      aadt: 48500,
      spfAlpha: -7.95,
      spfBeta: 0.96,
      phi: 0.28,
    },
    arterial: {
      speed: 60,
      lanes: 4,
      aadt: 24500,
      spfAlpha: -7.65,
      spfBeta: 0.94,
      phi: 0.36,
    },
    collector: {
      speed: 45,
      lanes: 2,
      aadt: 11200,
      spfAlpha: -7.45,
      spfBeta: 0.90,
      phi: 0.42,
    },
    local: {
      speed: 30,
      lanes: 2,
      aadt: 3800,
      spfAlpha: -7.30,
      spfBeta: 0.85,
      phi: 0.52,
    },
  };

  const segments: RoadSegmentDef[] = [];

  edgeSpecs.forEach((spec, idx) => {
    const nFrom = nodeMap.get(spec.from)!;
    const nTo = nodeMap.get(spec.to)!;

    degreeCount.set(spec.from, (degreeCount.get(spec.from) ?? 0) + 1);
    degreeCount.set(spec.to, (degreeCount.get(spec.to) ?? 0) + 1);

    const coordsMetric: [number, number][] = [[nFrom.xM, nFrom.yM]];
    if (spec.midOffset) {
      const midX = Number(((nFrom.xM + nTo.xM) / 2 + spec.midOffset[0]).toFixed(2));
      const midY = Number(((nFrom.yM + nTo.yM) / 2 + spec.midOffset[1]).toFixed(2));
      coordsMetric.push([midX, midY]);
    }
    coordsMetric.push([nTo.xM, nTo.yM]);

    const coordsGeo = coordsMetric.map(([x, y]) => metricToGeo(x, y));
    const lengthM = computePolylineLengthM(coordsMetric);
    const sinuosity = computeSinuosity(coordsMetric);

    const xs = coordsMetric.map((c) => c[0]);
    const ys = coordsMetric.map((c) => c[1]);
    const def = classDefaults[spec.roadClass];
    // Deterministic segment-level AADT variation
    const aadtJitter = Math.round(def.aadt * (0.88 + ((idx * 17) % 25) * 0.01));

    segments.push({
      segmentCode: `E${String(idx + 1).padStart(2, "0")}`,
      name: spec.name,
      roadClass: spec.roadClass,
      fromNodeCode: spec.from,
      toNodeCode: spec.to,
      isDirected: false,
      isOverpass: Boolean(spec.isOverpass),
      lengthM,
      speedLimitKmh: def.speed,
      laneCount: def.lanes,
      sinuosity,
      aadt: aadtJitter,
      spfAlpha: def.spfAlpha,
      spfBeta: def.spfBeta,
      spfOverdispersionPhi: def.phi,
      coordsMetric,
      coordsGeo,
      bboxMinX: Math.min(...xs),
      bboxMinY: Math.min(...ys),
      bboxMaxX: Math.max(...xs),
      bboxMaxY: Math.max(...ys),
    });
  });

  const nodes: RoadNodeDef[] = [];
  for (const [code, node] of nodeMap.entries()) {
    nodes.push({
      ...node,
      degree: degreeCount.get(code) ?? 2,
    });
  }

  return { nodes, segments };
}

/**
 * Dynamically segments every road edge into uniform linear spatial units (lixels)
 * of configurable target length (e.g., 10m, 25m, 50m, 100m) using Linear Referencing (LRS).
 */
export function generateLixelsForNetwork(
  segments: RoadSegmentDef[],
  lixelSizeM = 50
): LixelDef[] {
  const safeResolution = Math.max(10, Math.min(200, lixelSizeM));
  const lixels: LixelDef[] = [];

  for (const seg of segments) {
    const numLixels = Math.max(1, Math.ceil(seg.lengthM / safeResolution));
    const stepM = seg.lengthM / numLixels;

    for (let i = 0; i < numLixels; i++) {
      const mStartM = Number((i * stepM).toFixed(2));
      const mEndM = Number(Math.min(seg.lengthM, (i + 1) * stepM).toFixed(2));
      const lengthM = Number((mEndM - mStartM).toFixed(2));
      const mMid = (mStartM + mEndM) / 2;

      const [centerXM, centerYM] = interpolateAlongPolylineM(seg.coordsMetric, mMid);
      const [centerLon, centerLat] = metricToGeo(centerXM, centerYM);

      const coordsMetric = slicePolylineByM(seg.coordsMetric, mStartM, mEndM);
      const coordsGeo = coordsMetric.map(([x, y]) => metricToGeo(x, y));

      // Shortest distance along this segment to either topological endpoint node
      const distToNearestJunctionM = Number(
        Math.min(mMid, seg.lengthM - mMid).toFixed(2)
      );

      lixels.push({
        lixelCode: `${seg.segmentCode}_L${String(i + 1).padStart(3, "0")}`,
        segmentCode: seg.segmentCode,
        lixelIndex: i,
        mStartM,
        mEndM,
        lengthM,
        centerXM,
        centerYM,
        centerLon,
        centerLat,
        distToNearestJunctionM,
        coordsMetric,
        coordsGeo,
      });
    }
  }

  return lixels;
}

/**
 * Topological Graph Shortest-Path Engine
 * Precomputes all-pairs shortest path distances between road nodes AND
 * accumulated node-degree split factors for Okabe-Sugihara Equal-Split NKDE.
 */
export interface NetworkShortestPathMatrix {
  nodeCodes: string[];
  nodeIndex: Map<string, number>;
  distMatrix: number[][];
  splitDegreeMatrix: number[][]; // Product of (deg(v) - 1) along shortest path
}

export function buildAllPairsShortestPaths(
  nodes: { nodeCode: string; degree: number }[],
  segments: {
    segmentCode: string;
    fromNodeCode: string;
    toNodeCode: string;
    lengthM: number;
  }[]
): NetworkShortestPathMatrix {
  const n = nodes.length;
  const nodeCodes = nodes.map((nd) => nd.nodeCode);
  const nodeIndex = new Map<string, number>();
  const degrees = new Array<number>(n).fill(2);

  nodes.forEach((nd, i) => {
    nodeIndex.set(nd.nodeCode, i);
    degrees[i] = Math.max(1, nd.degree);
  });

  const distMatrix: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(Infinity)
  );
  const nextNode: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(-1)
  );

  for (let i = 0; i < n; i++) {
    distMatrix[i][i] = 0;
    nextNode[i][i] = i;
  }

  for (const seg of segments) {
    const u = nodeIndex.get(seg.fromNodeCode);
    const v = nodeIndex.get(seg.toNodeCode);
    if (u !== undefined && v !== undefined) {
      if (seg.lengthM < distMatrix[u][v]) {
        distMatrix[u][v] = seg.lengthM;
        distMatrix[v][u] = seg.lengthM;
        nextNode[u][v] = v;
        nextNode[v][u] = u;
      }
    }
  }

  // Floyd-Warshall over the 24-node topological graph (instantaneous O(V^3))
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (distMatrix[i][k] + distMatrix[k][j] < distMatrix[i][j]) {
          distMatrix[i][j] = Number((distMatrix[i][k] + distMatrix[k][j]).toFixed(2));
          nextNode[i][j] = nextNode[i][k];
        }
      }
    }
  }

  // Compute Okabe-Sugihara equal-split branching product along shortest paths
  const splitDegreeMatrix: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(1)
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || nextNode[i][j] === -1) {
        splitDegreeMatrix[i][j] = 1;
        continue;
      }
      let prod = Math.max(1, degrees[i] - 1);
      let curr = nextNode[i][j];
      let guard = 0;
      while (curr !== -1 && curr !== j && guard < n + 2) {
        prod *= Math.max(1, degrees[curr] - 1);
        curr = nextNode[curr][j];
        guard++;
      }
      splitDegreeMatrix[i][j] = Math.min(prod, 64);
    }
  }

  return {
    nodeCodes,
    nodeIndex,
    distMatrix,
    splitDegreeMatrix,
  };
}

/**
 * Computes exact Shortest-Path Network Distance d_net(A, B) between two linear-referenced
 * locations on the road graph:
 * Location A: (segmentA, offset m_A)
 * Location B: (segmentB, offset m_B)
 */
export function computeNetworkDistanceBetweenLRS(
  segA: {
    segmentCode: string;
    fromNodeCode: string;
    toNodeCode: string;
    lengthM: number;
  },
  mA: number,
  segB: {
    segmentCode: string;
    fromNodeCode: string;
    toNodeCode: string;
    lengthM: number;
  },
  mB: number,
  spMatrix: NetworkShortestPathMatrix
): { distanceM: number; splitFactor: number } {
  if (segA.segmentCode === segB.segmentCode) {
    return {
      distanceM: Number(Math.abs(mA - mB).toFixed(2)),
      splitFactor: 1,
    };
  }

  const uA = spMatrix.nodeIndex.get(segA.fromNodeCode) ?? 0;
  const vA = spMatrix.nodeIndex.get(segA.toNodeCode) ?? 0;
  const uB = spMatrix.nodeIndex.get(segB.fromNodeCode) ?? 0;
  const vB = spMatrix.nodeIndex.get(segB.toNodeCode) ?? 0;

  const dToUA = mA;
  const dToVA = Math.max(0, segA.lengthM - mA);
  const dToUB = mB;
  const dToVB = Math.max(0, segB.lengthM - mB);

  const candidates = [
    {
      d: dToUA + spMatrix.distMatrix[uA][uB] + dToUB,
      split: spMatrix.splitDegreeMatrix[uA][uB],
    },
    {
      d: dToUA + spMatrix.distMatrix[uA][vB] + dToVB,
      split: spMatrix.splitDegreeMatrix[uA][vB],
    },
    {
      d: dToVA + spMatrix.distMatrix[vA][uB] + dToUB,
      split: spMatrix.splitDegreeMatrix[vA][uB],
    },
    {
      d: dToVA + spMatrix.distMatrix[vA][vB] + dToVB,
      split: spMatrix.splitDegreeMatrix[vA][vB],
    },
  ];

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].d < best.d) {
      best = candidates[i];
    }
  }

  return {
    distanceM: Number(best.d.toFixed(2)),
    splitFactor: Math.max(1, best.split),
  };
}

export function computePlanarVsNetworkDistortionRatio(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  networkDistM: number
): number {
  const euc = euclideanDistanceM(x1, y1, x2, y2);
  if (euc <= 1.0) return 1.0;
  return Number((networkDistM / euc).toFixed(3));
}
