// Stochastic Network Generator & Inhomogeneous Point Process Simulator
//
// Generates a realistic synthetic urban road network (a perturbed grid
// mimicking a planned city with some irregularity), subdivides edges into
// uniform lixels, and simulates accident realizations from a known
// spatiotemporal intensity function λ(edge, m, t).
//
// Scenarios:
//  - uniform: constant intensity across all edges
//  - intersection_clustered: intensity peaks near intersections (hot nodes)
//  - rush_hour: adds diurnal temporal wave
//  - complex_urban: combines hierarchy, intersections, sinuosity, temporal effects

import {
  CITY_HEIGHT_M,
  CITY_WIDTH_M,
  lonLatToMetric,
  metricToLonLat,
  lineToGeoJsonMetric,
  lineToGeoJsonGeo,
  locateAlongLine,
  lineLength,
  type MetricLineString,
  type MetricPoint,
} from "@/lib/spatial/crs";
import { RoadNetworkGraph } from "@/lib/spatial/network";

export type Scenario = "uniform" | "intersection_clustered" | "rush_hour" | "complex_urban";

export interface SimulationParams {
  seed: number;
  scenario: Scenario;
  lixelResolutionM: number;
  // total expected crashes over simulation period (1 year)
  expectedCrashesPerYear: number;
  // VGI noise parameters
  vgiPositionalNoiseSigmaM: number;
  vgiReportingLagLambdaMin: number; // exponential distribution parameter
  vgiDuplicateRate: number; // probability of multi-witness burst per severe crash
  vgiFalseAlarmRate: number; // fraction of raw reports that are noise
}

export const DEFAULT_PARAMS: SimulationParams = {
  seed: 42,
  scenario: "complex_urban",
  lixelResolutionM: 50,
  expectedCrashesPerYear: 800,
  vgiPositionalNoiseSigmaM: 18,
  vgiReportingLagLambdaMin: 8,
  vgiDuplicateRate: 0.35,
  vgiFalseAlarmRate: 0.08,
};

// Seeded PRNG (mulberry32)
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return function rand() {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = ReturnType<typeof makeRng>;

function normalRandom(rng: Rng): number {
  // Box-Muller
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface GeneratedNode {
  nodeId: string;
  x: number;
  y: number;
  longitude: number;
  latitude: number;
  degree: number;
  isIntersection: boolean;
  signalized: boolean;
}

export interface GeneratedSegment {
  segmentId: string;
  fromNodeId: string;
  toNodeId: string;
  polyline: MetricLineString;
  lengthMeters: number;
  roadClass: string;
  hierarchyLevel: number;
  speedLimit: number;
  laneCount: number;
  aadt: number; // veh/day
  sinuosity: number;
  lighting: boolean;
  pedestrianFacility: boolean;
  oneway: boolean;
}

export interface GeneratedLixel {
  lixelId: string;
  parentSegmentId: string;
  mStart: number;
  mEnd: number;
  lengthMeters: number;
  resolution: number;
  polyline: MetricLineString;
  midpointX: number;
  midpointY: number;
  midpointLon: number;
  midpointLat: number;
  roadClass: string;
  aadt: number;
  groundTruthLambda: number; // events per year per meter
}

export interface GeneratedAccident {
  incidentTime: Date;
  reportTime: Date;
  reportingLagMinutes: number;
  trueX: number;
  trueY: number;
  trueLon: number;
  trueLat: number;
  trueSegmentId: string;
  trueOffsetM: number;
  rawX: number;
  rawY: number;
  rawLon: number;
  rawLat: number;
  rawPositionalUncertaintyM: number;
  severityCode: string;
  categoryCode: string;
  vehicleCount: number;
  pedestrianCount: number;
  cyclistCount: number;
  fatalities: number;
  injuries: number;
  emergencyResponse: boolean;
  weather: string;
  lightingCondition: string;
  roadSurface: string;
  witnessCount: number;
  isFalseAlarm: boolean;
  groundTruthIntensity: number;
}

export interface GeneratedData {
  params: SimulationParams;
  nodes: GeneratedNode[];
  segments: GeneratedSegment[];
  lixels: GeneratedLixel[];
  accidents: GeneratedAccident[]; // synthetic ground-truth + VGI noise
  totalNetworkLengthM: number;
  scenarioName: string;
}

// Hierarchical road class definitions
const ROAD_CLASSES = [
  { code: "primary", hierarchy: 1, speed: 65, lanes: 4, aadtBase: 22000 },
  { code: "secondary", hierarchy: 2, speed: 55, lanes: 2, aadtBase: 12000 },
  { code: "tertiary", hierarchy: 3, speed: 45, lanes: 2, aadtBase: 6500 },
  { code: "residential", hierarchy: 4, speed: 30, lanes: 2, aadtBase: 1800 },
];

const WEATHERS = ["clear", "clear", "clear", "clear", "rain", "rain", "fog", "snow"];
const LIGHTING = ["daylight", "daylight", "daylight", "dusk", "dark_lit", "dark_unlit"];
const SURFACES = ["dry", "dry", "dry", "wet", "wet", "ice"];

interface GridIntersection {
  i: number;
  j: number;
  x: number;
  y: number;
  id: string;
  isArterialH: boolean;
  isArterialV: boolean;
}

export function generateNetwork(
  params: SimulationParams
): { nodes: GeneratedNode[]; segments: GeneratedSegment[]; graph: RoadNetworkGraph; totalLength: number } {
  const rng = makeRng(params.seed);

  // Build a 12x12 perturbed grid within the city bounding box
  const N_H = 12;
  const N_V = 12;
  const spacingX = CITY_WIDTH_M / (N_H - 1);
  const spacingY = CITY_HEIGHT_M / (N_V - 1);

  // Arterial corridors every 4th grid line
  const ARTERIAL_STEP = 4;

  const intersections: GridIntersection[] = [];
  const grid: GridIntersection[][] = [];

  for (let j = 0; j < N_V; j++) {
    grid[j] = [];
    for (let i = 0; i < N_H; i++) {
      const isArterialH = j % ARTERIAL_STEP === 0;
      const isArterialV = i % ARTERIAL_STEP === 0;
      // Perturb interior intersections for realism
      const jitterX = (i === 0 || i === N_H - 1) ? 0 : (rng() - 0.5) * spacingX * 0.25;
      const jitterY = (j === 0 || j === N_V - 1) ? 0 : (rng() - 0.5) * spacingY * 0.25;
      const x = i * spacingX + jitterX;
      const y = j * spacingY + jitterY;
      const id = `n_${j}_${i}`;
      const node: GridIntersection = { i, j, x, y, id, isArterialH, isArterialV };
      intersections.push(node);
      grid[j][i] = node;
    }
  }

  const nodesOut: GeneratedNode[] = [];
  const segmentsOut: GeneratedSegment[] = [];
  const graph = new RoadNetworkGraph();

  // Assign a sequential integer id for the graph
  const nodeIntId = new Map<string, number>();
  let nextNodeInt = 1;
  let nextSegInt = 1;

  // First pass: register all nodes
  for (const n of intersections) {
    const { lon, lat } = metricToLonLat(n.x, n.y);
    nodeIntId.set(n.id, nextNodeInt);
    graph.addNode(nextNodeInt, n.x, n.y);
    const isSignalized = (n.isArterialH || n.isArterialV) && rng() < 0.7;
    nodesOut.push({
      nodeId: n.id,
      x: n.x,
      y: n.y,
      longitude: lon,
      latitude: lat,
      degree: 0,
      isIntersection: true,
      signalized: isSignalized,
    });
    nextNodeInt++;
  }

  // Second pass: build horizontal and vertical edges with intermediate points
  for (let j = 0; j < N_V; j++) {
    for (let i = 0; i < N_H - 1; i++) {
      const a = grid[j][i];
      const b = grid[j][i + 1];
      const { polyline, roadClass, hierarchyLevel, speedLimit, laneCount, aadt, oneway, lighting, pedFacility } =
        buildEdge(a, b, "horizontal", rng, params.seed + j * 100 + i);
      const segLen = lineLength(polyline);
      const sinuosity = segLen / Math.hypot(b.x - a.x, b.y - a.y);
      const id = `seg_h_${j}_${i}`;
      segmentsOut.push({
        segmentId: id,
        fromNodeId: a.id,
        toNodeId: b.id,
        polyline,
        lengthMeters: segLen,
        roadClass,
        hierarchyLevel,
        speedLimit,
        laneCount,
        aadt,
        sinuosity,
        lighting,
        pedestrianFacility: pedFacility,
        oneway,
      });
      graph.addEdge(nextSegInt, nodeIntId.get(a.id)!, nodeIntId.get(b.id)!, polyline, {
        dbSegmentId: nextSegInt,
        roadClass,
        hierarchyLevel,
        oneway,
      });
      nextSegInt++;
    }
  }
  for (let j = 0; j < N_V - 1; j++) {
    for (let i = 0; i < N_H; i++) {
      const a = grid[j][i];
      const b = grid[j + 1][i];
      const { polyline, roadClass, hierarchyLevel, speedLimit, laneCount, aadt, oneway, lighting, pedFacility } =
        buildEdge(a, b, "vertical", rng, params.seed + 10000 + j * 100 + i);
      const segLen = lineLength(polyline);
      const sinuosity = segLen / Math.hypot(b.x - a.x, b.y - a.y);
      const id = `seg_v_${j}_${i}`;
      segmentsOut.push({
        segmentId: id,
        fromNodeId: a.id,
        toNodeId: b.id,
        polyline,
        lengthMeters: segLen,
        roadClass,
        hierarchyLevel,
        speedLimit,
        laneCount,
        aadt,
        sinuosity,
        lighting,
        pedestrianFacility: pedFacility,
        oneway,
      });
      graph.addEdge(nextSegInt, nodeIntId.get(a.id)!, nodeIntId.get(b.id)!, polyline, {
        dbSegmentId: nextSegInt,
        roadClass,
        hierarchyLevel,
        oneway,
      });
      nextSegInt++;
    }
  }

  // Compute node degrees
  const degreeMap = new Map<string, number>();
  for (const s of segmentsOut) {
    degreeMap.set(s.fromNodeId, (degreeMap.get(s.fromNodeId) ?? 0) + 1);
    degreeMap.set(s.toNodeId, (degreeMap.get(s.toNodeId) ?? 0) + 1);
  }
  for (const n of nodesOut) {
    n.degree = degreeMap.get(n.nodeId) ?? 0;
  }

  const totalLength = segmentsOut.reduce((sum, s) => sum + s.lengthMeters, 0);
  return { nodes: nodesOut, segments: segmentsOut, graph, totalLength };
}

function buildEdge(
  a: GridIntersection,
  b: GridIntersection,
  orient: "horizontal" | "vertical",
  rng: Rng,
  seed: number
) {
  const localRng = makeRng(seed);
  // Determine road class based on arterial status
  let clsIdx = 3;
  if (orient === "horizontal") {
    if (a.isArterialH) clsIdx = localRng() < 0.6 ? 0 : 1;
    else if (localRng() < 0.35) clsIdx = 2;
    else clsIdx = 3;
  } else {
    if (a.isArterialV) clsIdx = localRng() < 0.6 ? 0 : 1;
    else if (localRng() < 0.35) clsIdx = 2;
    else clsIdx = 3;
  }
  const cls = ROAD_CLASSES[clsIdx];

  // Add 1-2 intermediate curvature points for non-motorway edges
  const polyline: MetricLineString = [{ x: a.x, y: a.y }];
  const numInt = clsIdx <= 1 ? 0 : clsIdx === 2 ? (localRng() < 0.5 ? 1 : 0) : localRng() < 0.4 ? 2 : 1;
  for (let k = 1; k <= numInt; k++) {
    const f = k / (numInt + 1);
    const bx = a.x + (b.x - a.x) * f;
    const by = a.y + (b.y - a.y) * f;
    const dx = orient === "horizontal" ? 0 : (localRng() - 0.5) * 25;
    const dy = orient === "vertical" ? 0 : (localRng() - 0.5) * 25;
    polyline.push({ x: bx + dx, y: by + dy });
  }
  polyline.push({ x: b.x, y: b.y });

  // AADT with small jitter
  const aadtJitter = 0.8 + localRng() * 0.4;
  return {
    polyline,
    roadClass: cls.code,
    hierarchyLevel: cls.hierarchy,
    speedLimit: cls.speed,
    laneCount: cls.lanes,
    aadt: Math.round(cls.aadtBase * aadtJitter),
    oneway: clsIdx === 0 && localRng() < 0.2,
    lighting: localRng() < 0.85,
    pedFacility: localRng() < 0.4,
  };
}

// ─── Lixel segmentation ────────────────────────────────────────────────────

export function segmentIntoLixels(
  segments: GeneratedSegment[],
  resolutionM: number
): GeneratedLixel[] {
  const lixels: GeneratedLixel[] = [];
  for (const seg of segments) {
    let m = 0;
    let idx = 0;
    while (m < seg.lengthMeters) {
      const mEnd = Math.min(m + resolutionM, seg.lengthMeters);
      const start = locateAlongLine(seg.polyline, m).point;
      const end = locateAlongLine(seg.polyline, mEnd).point;
      const mid = locateAlongLine(seg.polyline, (m + mEnd) / 2).point;
      const midGeo = metricToLonLat(mid.x, mid.y);
      // Polyline for lixel: just start + end (straight sub-segment)
      // For smoother rendering add intermediate points from original.
      const lixelPoly: MetricLineString = [start];
      // Walk original polyline for vertices between m and mEnd
      let cum = 0;
      for (let pi = 0; pi < seg.polyline.length - 1; pi++) {
        const p0 = seg.polyline[pi];
        const p1 = seg.polyline[pi + 1];
        const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (cum + segLen > m && cum < mEnd) {
          // there is overlap
          if (cum > m) lixelPoly.push(p0);
          if (cum + segLen < mEnd) lixelPoly.push(p1);
        }
        cum += segLen;
      }
      lixelPoly.push(end);
      lixels.push({
        lixelId: `${seg.segmentId}_l${idx}`,
        parentSegmentId: seg.segmentId,
        mStart: m,
        mEnd,
        lengthMeters: mEnd - m,
        resolution: resolutionM,
        polyline: lixelPoly,
        midpointX: mid.x,
        midpointY: mid.y,
        midpointLon: midGeo.lon,
        midpointLat: midGeo.lat,
        roadClass: seg.roadClass,
        aadt: seg.aadt,
        groundTruthLambda: 0,
      });
      m = mEnd;
      idx++;
    }
  }
  return lixels;
}

// ─── Ground truth intensity λ(m, t) ────────────────────────────────────────

export function computeGroundTruthIntensity(
  seg: GeneratedSegment,
  offsetM: number,
  lixelMidFraction: number,
  scenario: Scenario,
  rng: Rng
): number {
  // Returns baseline intensity in events per meter per year.
  // Multiplicative components:
  let lambda = 1.0; // base

  // hierarchy factor (higher hierarchies have more crashes but also higher AADT)
  const hierarchyFactor: Record<string, number> = {
    primary: 2.2,
    secondary: 1.6,
    tertiary: 1.1,
    residential: 0.7,
  };
  lambda *= hierarchyFactor[seg.roadClass] ?? 1.0;

  // proximity to endpoints (intersections): peak within 60m of nodes
  const distToStart = offsetM;
  const distToEnd = seg.lengthMeters - offsetM;
  const minDistNode = Math.min(distToStart, distToEnd);
  let intersectionFactor = 1.0;
  if (scenario !== "uniform") {
    // Gaussian-like peak near intersections
    const sigma = 60;
    intersectionFactor = 1.0 + 2.5 * Math.exp(-(minDistNode * minDistNode) / (2 * sigma * sigma));
  }
  lambda *= intersectionFactor;

  if (scenario === "complex_urban") {
    // sinuosity: curves add risk
    lambda *= 0.7 + 0.6 * seg.sinuosity;
    // lighting
    if (!seg.lighting) lambda *= 1.3;
    // pedestrian facility presence (indicator of pedestrian activity)
    if (seg.pedestrianFacility) lambda *= 1.15;
    // mild spatial noise field
    lambda *= 0.8 + rng() * 0.4;
  }

  if (scenario === "intersection_clustered") {
    lambda *= 0.3; // lower base, amplified by intersection factor
  }

  return lambda;
}

// ─── Temporal intensity (hour of week) ─────────────────────────────────────

export function temporalMultiplier(
  date: Date,
  scenario: Scenario
): number {
  const hr = date.getHours();
  const dow = date.getDay();
  const isWeekend = dow === 0 || dow === 6;
  if (scenario === "uniform") return 1.0;
  if (scenario === "rush_hour" || scenario === "complex_urban") {
    // morning peak 7-9, evening peak 16-19
    let m = 1.0;
    if (hr >= 7 && hr <= 9) m = isWeekend ? 1.2 : 2.0;
    else if (hr >= 16 && hr <= 19) m = isWeekend ? 1.4 : 2.3;
    else if (hr >= 11 && hr <= 13) m = 1.3;
    else if (hr >= 22 || hr <= 5) m = 0.5;
    else m = 0.85;
    // weekend evening uptick
    if (isWeekend && hr >= 20 && hr <= 23) m *= 1.3;
    return m;
  }
  return 1.0;
}

// ─── Simulate accident realizations ────────────────────────────────────────

export function simulateAccidents(
  params: SimulationParams,
  segments: GeneratedSegment[],
  lixels: GeneratedLixel[]
): GeneratedAccident[] {
  const rng = makeRng(params.seed + 999);
  const accidents: GeneratedAccident[] = [];

  // First pass: compute per-lixel integrated baseline intensity for thinning
  const lixelBaseline = new Map<string, number>();
  let totalBaseline = 0;
  for (const lix of lixels) {
    const seg = segments.find(s => s.segmentId === lix.parentSegmentId)!;
    const midFrac = (lix.mStart + lix.mEnd) / 2 / seg.lengthMeters;
    const lam = computeGroundTruthIntensity(
      seg,
      (lix.mStart + lix.mEnd) / 2,
      midFrac,
      params.scenario,
      makeRng(params.seed + lixels.indexOf(lix))
    );
    const integratedLam = lam * lix.lengthMeters;
    lixelBaseline.set(lix.lixelId, integratedLam);
    lix.groundTruthLambda = lam;
    totalBaseline += integratedLam;
  }

  // Scale to expected annual crash count
  const scaleFactor = params.expectedCrashesPerYear / totalBaseline;

  // Simulate over one year starting 2024-01-01 UTC
  const yearStart = new Date("2024-01-01T00:00:00Z").getTime();
  const yearEnd = new Date("2025-01-01T00:00:00Z").getTime();
  const yearMs = yearEnd - yearStart;

  // Poisson thinning over lixels
  for (const lix of lixels) {
    const baseRate = (lixelBaseline.get(lix.lixelId) ?? 0) * scaleFactor;
    // expected count for this lixel over the year
    const expectedCount = baseRate;
    // Poisson draw (normal approximation for small rates)
    let count = 0;
    const p = Math.exp(-expectedCount);
    let s = p;
    const u = rng();
    while (u > s) {
      count++;
      s += Math.exp(-expectedCount + count * Math.log(expectedCount) - logFactorial(count));
    }
    for (let k = 0; k < count; k++) {
      // Random time in year, then apply temporal thinning
      let tAttempt = yearStart + rng() * yearMs;
      let date = new Date(tAttempt);
      const tempMult = temporalMultiplier(date, params.scenario);
      if (rng() >= tempMult / 2.5) {
        // Rejection sample: try once more with a rush hour-biased time
        const bias = rng();
        // Choose peak hour block
        const peakHrs = [7.5, 8, 17, 18, 12];
        const hr = peakHrs[Math.floor(bias * peakHrs.length)];
        const jitterDay = Math.floor(rng() * 365);
        date = new Date(yearStart + jitterDay * 86400000 + hr * 3600000 + (rng() - 0.5) * 3600000);
      }
      // Random offset within lixel
      const localOffset = lix.mStart + rng() * lix.lengthMeters;
      const seg = segments.find(s => s.segmentId === lix.parentSegmentId)!;
      const truePt = locateAlongLine(seg.polyline, localOffset).point;
      const trueGeo = metricToLonLat(truePt.x, truePt.y);

      // Severity draw (influenced by speed limit)
      const sevDraw = rng();
      let severityCode: string;
      let fatalities = 0, injuries = 0;
      const speedFactor = seg.speedLimit / 65;
      if (sevDraw < 0.02 * speedFactor) { severityCode = "fatal"; fatalities = 1; injuries = Math.floor(rng() * 2); }
      else if (sevDraw < 0.15 * speedFactor) { severityCode = "severe"; injuries = 1 + Math.floor(rng() * 3); }
      else if (sevDraw < 0.45) { severityCode = "injury"; injuries = Math.floor(rng() * 2); }
      else { severityCode = "pdo"; }

      const isPed = rng() < (seg.pedestrianFacility ? 0.12 : 0.04);
      const isCyc = rng() < 0.05;
      const emergency = rng() < (severityCode === "fatal" || severityCode === "severe" ? 0.95 : 0.4);

      // Weather/lighting
      const weather = WEATHERS[Math.floor(rng() * WEATHERS.length)];
      let lighting: string;
      const hr = date.getHours();
      if (hr >= 6 && hr < 18) lighting = "daylight";
      else if (hr >= 18 && hr < 20) lighting = "dusk";
      else lighting = seg.lighting ? "dark_lit" : "dark_unlit";
      const roadSurface = weather === "rain" ? (rng() < 0.6 ? "wet" : "dry")
        : weather === "snow" ? (rng() < 0.7 ? "snow" : "ice")
        : weather === "fog" ? (rng() < 0.3 ? "wet" : "dry")
        : (rng() < 0.1 ? "wet" : "dry");

      // VGI positional noise
      const noiseSigma = params.vgiPositionalNoiseSigmaM;
      let rawX = truePt.x + normalRandom(rng) * noiseSigma;
      let rawY = truePt.y + normalRandom(rng) * noiseSigma;
      const rawGeo = metricToLonLat(rawX, rawY);

      // Reporting lag: exponential
      const lagMin = -Math.log(1 - rng()) * params.vgiReportingLagLambdaMin;
      const reportTime = new Date(date.getTime() + lagMin * 60000);

      const intensityVal = computeGroundTruthIntensity(
        seg, localOffset, localOffset / seg.lengthMeters, params.scenario, rng
      );

      // Base (ground-truth) accident as canonical
      accidents.push({
        incidentTime: date,
        reportTime,
        reportingLagMinutes: lagMin,
        trueX: truePt.x, trueY: truePt.y,
        trueLon: trueGeo.lon, trueLat: trueGeo.lat,
        trueSegmentId: seg.segmentId,
        trueOffsetM: localOffset,
        rawX, rawY,
        rawLon: rawGeo.lon, rawLat: rawGeo.lat,
        rawPositionalUncertaintyM: noiseSigma * 1.6,
        severityCode,
        categoryCode: isPed ? "pedestrian" : isCyc ? "cyclist" : "vehicle",
        vehicleCount: isPed || isCyc ? 1 : 1 + Math.floor(rng() * 2),
        pedestrianCount: isPed ? 1 : 0,
        cyclistCount: isCyc ? 1 : 0,
        fatalities, injuries,
        emergencyResponse: emergency,
        weather,
        lightingCondition: lighting,
        roadSurface,
        witnessCount: 1,
        isFalseAlarm: false,
        groundTruthIntensity: intensityVal,
      });

      // Multi-witness duplicates for severe crashes
      if ((severityCode === "fatal" || severityCode === "severe") && rng() < params.vgiDuplicateRate) {
        const numDuplicates = 1 + Math.floor(rng() * 3);
        for (let w = 0; w < numDuplicates; w++) {
          const witX = truePt.x + normalRandom(rng) * noiseSigma * 0.8;
          const witY = truePt.y + normalRandom(rng) * noiseSigma * 0.8;
          const witGeo = metricToLonLat(witX, witY);
          const witLag = lagMin + (rng() - 0.3) * 15;
          accidents.push({
            incidentTime: new Date(date.getTime() + (rng() - 0.5) * 300000),
            reportTime: new Date(date.getTime() + Math.max(1, witLag) * 60000),
            reportingLagMinutes: Math.max(1, witLag),
            trueX: truePt.x, trueY: truePt.y,
            trueLon: trueGeo.lon, trueLat: trueGeo.lat,
            trueSegmentId: seg.segmentId,
            trueOffsetM: localOffset,
            rawX: witX, rawY: witY,
            rawLon: witGeo.lon, rawLat: witGeo.lat,
            rawPositionalUncertaintyM: noiseSigma * 1.6,
            severityCode: rng() < 0.7 ? severityCode : (rng() < 0.5 ? "injury" : severityCode),
            categoryCode: isPed ? "pedestrian" : isCyc ? "cyclist" : "vehicle",
            vehicleCount: 1, pedestrianCount: isPed ? 1 : 0, cyclistCount: isCyc ? 1 : 0,
            fatalities, injuries,
            emergencyResponse: emergency,
            weather, lightingCondition: lighting, roadSurface,
            witnessCount: 0,
            isFalseAlarm: false,
            groundTruthIntensity: intensityVal,
          });
        }
      }
    }
  }

  // Inject false alarms
  const nFalse = Math.floor(accidents.length * params.vgiFalseAlarmRate);
  for (let i = 0; i < nFalse; i++) {
    const x = rng() * CITY_WIDTH_M;
    const y = rng() * CITY_HEIGHT_M;
    const geo = metricToLonLat(x, y);
    const incidentTime = new Date(yearStart + rng() * yearMs);
    const lag = -Math.log(1 - rng()) * params.vgiReportingLagLambdaMin;
    accidents.push({
      incidentTime,
      reportTime: new Date(incidentTime.getTime() + lag * 60000),
      reportingLagMinutes: lag,
      trueX: x, trueY: y,
      trueLon: geo.lon, trueLat: geo.lat,
      trueSegmentId: "",
      trueOffsetM: 0,
      rawX: x + normalRandom(rng) * 40,
      rawY: y + normalRandom(rng) * 40,
      rawLon: geo.lon,
      rawLat: geo.lat,
      rawPositionalUncertaintyM: 50,
      severityCode: "pdo",
      categoryCode: "vehicle",
      vehicleCount: 1, pedestrianCount: 0, cyclistCount: 0,
      fatalities: 0, injuries: 0,
      emergencyResponse: false,
      weather: "clear", lightingCondition: "daylight", roadSurface: "dry",
      witnessCount: 1,
      isFalseAlarm: true,
      groundTruthIntensity: 0,
    });
  }

  return accidents;
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

export function generateSyntheticDataset(params: SimulationParams): GeneratedData {
  const { nodes, segments, totalLength } = generateNetwork(params);
  const lixels = segmentIntoLixels(segments, params.lixelResolutionM);
  const accidents = simulateAccidents(params, segments, lixels);
  return {
    params,
    nodes,
    segments,
    lixels,
    accidents,
    totalNetworkLengthM: totalLength,
    scenarioName: params.scenario,
  };
}
