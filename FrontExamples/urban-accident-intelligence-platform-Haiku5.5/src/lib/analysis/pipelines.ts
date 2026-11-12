/**
 * Pure analysis pipelines: accident points + network context → GeoJSON + tables + methodology.
 * No database access here, so every method is unit-testable and reusable from jobs or scripts.
 */
import type { AccidentPoint, AnalysisType, GeoFeature, Position, SegmentRow } from "../domain";
import { CATEGORY_META, type CategoryCode } from "../domain";
import { ANALYSIS_DEFS } from "../catalog";
import type { AnalysisResultView, Methodology, TableCell } from "../api-types";
import { convexHull, ringArea, utmToLonLat } from "../geo";
import { mulberry32 } from "../random";
import { moranI, quantile, spearman } from "../stats";
import { kernelDensity } from "./kde";
import { assessGiStarAssumptions, countVariance, giStar, type GiClass } from "./gistar";
import { dbscan } from "./dbscan";
import { buildSegmentGeoms, distanceToNetwork, nearestSegment, type SegmentGeom } from "./snapping";
import { computeRiskScores, type RiskIndicator, type RiskInput, type RiskRow } from "./risk";

export interface NetworkContext {
  segments: SegmentRow[];
  /** Average annual daily traffic per segment id (synthetic traffic observations). */
  traffic: Map<number, number>;
  /** Hour start (epoch ms, UTC) → mean station precipitation (mm/h). */
  weatherHourly: Map<number, number>;
}

export interface PipelineInput {
  points: AccidentPoint[];
  network: NetworkContext;
  /** Length of the observation window in years (used for annualised exposure rates). */
  observationYears: number;
}

export type ProgressFn = (progress: number, message: string) => void;
export type Params = Record<string, number | string>;

const MASK_M = 250;
const CELL_LIMIT = 250_000;
const HOUR_MS = 3_600_000;

const num = (p: Params, key: string): number => Number(p[key]);
const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

function methodology(type: AnalysisType, assumptions: Methodology["assumptions"] = []): Methodology {
  const def = ANALYSIS_DEFS[type];
  return { title: def.label, represents: def.represents, method: def.method, assumptions, limitations: def.limitations };
}

function networkBounds(segments: SegmentRow[], pad: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    for (const [x, y] of s.utm) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function maskFn(geoms: SegmentGeom[], maxM: number) {
  return (x: number, y: number) => distanceToNetwork(x, y, geoms) <= maxM;
}

function cellRing(x0: number, y0: number, cs: number): Position[] {
  const corners: [number, number][] = [
    [x0, y0],
    [x0 + cs, y0],
    [x0 + cs, y0 + cs],
    [x0, y0 + cs],
    [x0, y0],
  ];
  return corners.map(([x, y]) => utmToLonLat(x, y) as Position);
}

function gridOrThrow(bounds: { minX: number; minY: number; maxX: number; maxY: number }, cs: number) {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cs);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / cs);
  if (cols * rows > CELL_LIMIT) throw new Error(`Grid of ${cols}×${rows} cells exceeds the ${CELL_LIMIT.toLocaleString()} cell limit. Increase the cell size.`);
  return { cols, rows };
}

function centerLonLat(x: number, y: number): Position {
  return utmToLonLat(x, y) as Position;
}

function runKde(input: PipelineInput, params: Params, progress: ProgressFn): AnalysisResultView {
  const h = num(params, "bandwidthM");
  const cs = num(params, "cellSizeM");
  const kernel = params.kernel === "gaussian" ? "gaussian" : "quartic";
  const geoms = buildSegmentGeoms(input.network.segments);
  const bounds = networkBounds(input.network.segments, h + MASK_M);
  const { cols, rows } = gridOrThrow(bounds, cs);
  progress(0.2, "Estimating kernel density surface");
  const grid = kernelDensity(
    input.points.map((p) => ({ x: p.x, y: p.y, weight: 1 })),
    { bandwidthM: h, cellSizeM: cs, kernel, bounds, cellMask: maskFn(geoms, MASK_M) },
  );
  progress(0.8, "Vectorising grid cells");

  const cellArea = (cs * cs) / 1e6;
  let max = 0;
  let mass = 0;
  let nonZero = 0;
  for (let i = 0; i < grid.values.length; i++) {
    if (!grid.evaluated[i]) continue;
    const v = grid.values[i]!;
    mass += v * cellArea;
    if (v > max) max = v;
    if (v > 0) nonZero++;
  }

  const features: GeoFeature[] = [];
  const cells: { value: number; lon: number; lat: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const v = grid.values[idx]!;
      if (!grid.evaluated[idx] || v <= 0) continue;
      const x0 = bounds.minX + c * cs;
      const y0 = bounds.minY + r * cs;
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [cellRing(x0, y0, cs)] },
        properties: { value: round(v, 3), share: round(max > 0 ? v / max : 0, 4) },
      });
      cells.push({ value: v, lon: centerLonLat(x0 + cs / 2, y0 + cs / 2)[0], lat: centerLonLat(x0 + cs / 2, y0 + cs / 2)[1] });
    }
  }
  cells.sort((a, b) => b.value - a.value);
  const table = cells.slice(0, 15).map((cell, i) => ({
    rank: i + 1,
    lon: round(cell.lon, 5),
    lat: round(cell.lat, 5),
    density: round(cell.value, 3),
  }));
  const share = input.points.length ? mass / input.points.length : null;

  return {
    kind: "kde",
    featureCollection: { type: "FeatureCollection", features },
    summary: {
      events: input.points.length,
      bandwidthM: h,
      cellSizeM: cs,
      kernel,
      cellsEvaluated: grid.evaluated.reduce((s, v) => s + v, 0),
      cellsNonZero: nonZero,
      maxDensityPerKm2: round(max, 3),
      eventsInsideMask: round(mass, 1),
      massShareInMask: share === null ? null : round(share, 3),
    },
    table,
    methodology: methodology("kde"),
    notes: [
      "Density is shown only within 250 m of the road network.",
      "Values are per km² of recorded incidents; they are not normalised by traffic exposure.",
      share !== null && share < 0.9
        ? `${round((1 - share) * 100, 0)}% of kernel mass falls outside the mask or grid, which is expected near the network edge.`
        : "Kernel mass is almost fully contained in the analysed grid.",
    ],
  };
}

function runGiStar(input: PipelineInput, params: Params, progress: ProgressFn): AnalysisResultView {
  const distance = num(params, "neighborhoodM");
  const cs = num(params, "cellSizeM");
  const alpha = Number(params.alpha ?? 0.05);
  const geoms = buildSegmentGeoms(input.network.segments);
  const bounds = networkBounds(input.network.segments, MASK_M);
  const { cols, rows } = gridOrThrow(bounds, cs);
  const inMask = maskFn(geoms, MASK_M);

  progress(0.2, "Building fishnet and counting incidents");
  const cellList = new Int32Array(cols * rows).fill(-1);
  const xs: number[] = [];
  const ys: number[] = [];
  const cellRC: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = bounds.minX + (c + 0.5) * cs;
      const cy = bounds.minY + (r + 0.5) * cs;
      if (!inMask(cx, cy)) continue;
      cellList[r * cols + c] = xs.length;
      xs.push(cx);
      ys.push(cy);
      cellRC.push([r, c]);
    }
  }
  const counts = new Float64Array(xs.length);
  for (const p of input.points) {
    const c = Math.floor((p.x - bounds.minX) / cs);
    const r = Math.floor((p.y - bounds.minY) / cs);
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
    const li = cellList[r * cols + c]!;
    if (li >= 0) counts[li] = counts[li]! + 1;
  }

  progress(0.6, "Computing Gi* z-scores and FDR-adjusted p-values");
  const n = xs.length;
  const total = counts.reduce((s, v) => s + v, 0);
  const nonZero = counts.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
  const gs = giStar(counts, xs, ys, distance, alpha);
  const isolates = gs.neighbors.reduce((s, v) => s + (v <= 1 ? 1 : 0), 0);
  const assumptions = assessGiStarAssumptions({
    cells: n,
    events: total,
    nonZeroShare: n ? nonZero / n : 0,
    variance: countVariance(counts),
    isolateShare: n ? isolates / n : 1,
  });
  const evaluated = assumptions.passed;

  const features: GeoFeature[] = [];
  const hotRows: { lon: number; lat: number; count: number; z: number; pAdj: number; cls: string }[] = [];
  const classTally: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const [r, c] = cellRC[i]!;
    const x0 = bounds.minX + c * cs;
    const y0 = bounds.minY + r * cs;
    const cls: GiClass | "not_evaluated" = evaluated ? gs.classes[i]! : "not_evaluated";
    classTally[cls] = (classTally[cls] ?? 0) + 1;
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [cellRing(x0, y0, cs)] },
      properties: {
        count: counts[i],
        z: evaluated ? round(gs.z[i]!, 3) : null,
        pAdj: evaluated ? round(gs.pAdj[i]!, 4) : null,
        class: cls,
        neighbors: gs.neighbors[i],
      },
    });
    if (evaluated && cls.startsWith("hot")) {
      const [lon, lat] = centerLonLat(xs[i]!, ys[i]!);
      hotRows.push({ lon, lat, count: counts[i]!, z: gs.z[i]!, pAdj: gs.pAdj[i]!, cls });
    }
  }
  hotRows.sort((a, b) => b.z - a.z);
  const table = hotRows.slice(0, 15).map((row, i) => ({
    rank: i + 1,
    lon: round(row.lon, 5),
    lat: round(row.lat, 5),
    count: row.count,
    z: round(row.z, 2),
    pAdjusted: round(row.pAdj, 4),
    class: row.cls,
  }));

  return {
    kind: "gistar",
    featureCollection: { type: "FeatureCollection", features },
    summary: {
      cellsEvaluated: n,
      events: total,
      eventsOutsideMask: input.points.length - total,
      assumptionsPassed: evaluated,
      distanceBandM: distance,
      cellSizeM: cs,
      hot99: classTally.hot99 ?? 0,
      hot95: classTally.hot95 ?? 0,
      hot90: classTally.hot90 ?? 0,
      cold95: (classTally.cold95 ?? 0) + (classTally.cold99 ?? 0) + (classTally.cold90 ?? 0),
    },
    table,
    methodology: methodology("gistar", assumptions.checks),
    notes: evaluated
      ? [
          "Hot/cold classes use Benjamini–Hochberg FDR-adjusted p-values across all fishnet cells.",
          "Boundary cells have truncated neighbourhoods (edge effect); interpret edge classes with caution.",
          "Counts are not exposure-normalised. Significant hotspots indicate unusual concentration of recorded incidents.",
        ]
      : ["Gi* was not computed because at least one statistical assumption is not met. Counts are shown descriptively only."],
  };
}

function runDbscanPipeline(input: PipelineInput, params: Params, progress: ProgressFn): AnalysisResultView {
  const eps = num(params, "epsM");
  const minPts = num(params, "minPts");
  progress(0.3, "Clustering incidents");
  const xs = input.points.map((p) => p.x);
  const ys = input.points.map((p) => p.y);
  const { labels, clusters } = dbscan(xs, ys, eps, minPts);

  const groups = new Map<number, number[]>();
  labels.forEach((label, i) => {
    if (label < 0) return;
    const g = groups.get(label);
    if (g) g.push(i);
    else groups.set(label, [i]);
  });

  progress(0.8, "Computing convex hulls");
  const features: GeoFeature[] = [];
  const rows: { id: number; size: number; sev: number; dominant: CategoryCode; lon: number; lat: number; area: number }[] = [];
  for (const [label, members] of groups) {
    const coords: Position[] = members.map((i) => [input.points[i]!.x, input.points[i]!.y]);
    let hull = convexHull(coords);
    if (hull.length < 3) {
      const xsM = coords.map((c) => c[0]);
      const ysM = coords.map((c) => c[1]);
      const pad = 15;
      const minX = Math.min(...xsM) - pad;
      const maxX = Math.max(...xsM) + pad;
      const minY = Math.min(...ysM) - pad;
      const maxY = Math.max(...ysM) + pad;
      hull = [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
      ];
    }
    const utmRing = [...hull, hull[0]!];
    const lonLatRing = utmRing.map(([x, y]) => centerLonLat(x, y));
    const sev = members.reduce((s, i) => s + input.points[i]!.severityWeight, 0);
    const tally: Partial<Record<CategoryCode, number>> = {};
    for (const i of members) {
      const code = input.points[i]!.categoryCode;
      tally[code] = (tally[code] ?? 0) + 1;
    }
    const dominant = (Object.entries(tally).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "rear_end") as CategoryCode;
    const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const [clon, clat] = centerLonLat(cx, cy);
    const area = ringArea(utmRing);
    rows.push({ id: label + 1, size: members.length, sev: sev / members.length, dominant, lon: clon, lat: clat, area });
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [lonLatRing] },
      properties: {
        clusterId: label + 1,
        size: members.length,
        severityIndex: round(sev / members.length, 2),
        dominantCategory: CATEGORY_META[dominant].label,
        areaM2: Math.round(area),
        memberIds: members.map((i) => input.points[i]!.id),
      },
    });
  }
  rows.sort((a, b) => b.size - a.size);
  const clustered = rows.reduce((s, r) => s + r.size, 0);
  const noise = labels.reduce((s, l) => s + (l < 0 ? 1 : 0), 0);

  return {
    kind: "dbscan",
    featureCollection: { type: "FeatureCollection", features },
    summary: {
      clusters,
      clusteredEvents: clustered,
      noiseEvents: noise,
      noiseShare: input.points.length ? round(noise / input.points.length, 3) : null,
      epsM: eps,
      minPts,
      largestCluster: rows[0]?.size ?? 0,
    },
    table: rows.slice(0, 20).map((r) => ({
      cluster: r.id,
      size: r.size,
      severityIndex: round(r.sev, 2),
      dominantCategory: CATEGORY_META[r.dominant].label,
      lon: round(r.lon, 5),
      lat: round(r.lat, 5),
      areaM2: Math.round(r.area),
    })),
    methodology: methodology("dbscan"),
    notes: [
      "Clusters are density-based groupings; they are not statistical tests of hotspot significance.",
      `Parameters: ε = ${eps} m, minPts = ${minPts}. Re-run with other values to test sensitivity.`,
    ],
  };
}

function segmentIndexMap(segments: SegmentRow[]) {
  return new Map(segments.map((s, i) => [s.id, i] as const));
}

function aggregateSegments(input: PipelineInput) {
  const segments = input.network.segments;
  const geoms = buildSegmentGeoms(segments);
  const idxById = segmentIndexMap(segments);
  const count = new Float64Array(segments.length);
  const sev = new Float64Array(segments.length);
  let assigned = 0;
  let snapSum = 0;
  let snapN = 0;
  for (const p of input.points) {
    let si = p.segmentId !== null ? idxById.get(p.segmentId) : undefined;
    if (si === undefined) {
      const hit = nearestSegment(p.x, p.y, geoms);
      si = hit ? idxById.get(hit.segmentId) : undefined;
    }
    if (si === undefined) continue;
    count[si]! += 1;
    sev[si]! += p.severityWeight;
    assigned++;
    if (p.snapDistanceM !== null) {
      snapSum += p.snapDistanceM;
      snapN++;
    }
  }
  const nodeToSegs = new Map<number, number[]>();
  segments.forEach((s, i) => {
    for (const node of [s.startNodeId, s.endNodeId]) {
      const list = nodeToSegs.get(node);
      if (list) list.push(i);
      else nodeToSegs.set(node, [i]);
    }
  });
  const neighbors: number[][] = segments.map((s, i) => {
    const set = new Set<number>();
    for (const node of [s.startNodeId, s.endNodeId]) {
      for (const j of nodeToSegs.get(node) ?? []) if (j !== i) set.add(j);
    }
    return [...set];
  });
  return { geoms, idxById, count, sev, assigned, meanSnapM: snapN ? snapSum / snapN : null, neighbors };
}

function runSegmentAggregation(input: PipelineInput, params: Params, progress: ProgressFn): AnalysisResultView {
  progress(0.25, "Assigning incidents to nearest segments");
  const agg = aggregateSegments(input);
  const segments = input.network.segments;
  progress(0.6, "Computing segment rates and Moran's I");
  const perKm = segments.map((s, i) => agg.count[i]! / (s.lengthM / 1000));
  const perms = Math.max(0, Math.round(num(params, "moranPermutations")));
  const moran = moranI(perKm, agg.neighbors, mulberry32(42), perms);

  const features: GeoFeature[] = [];
  const rows: { name: string; cls: string; count: number; sevKm: number; perKm: number; exposure: number | null; aadt: number | null }[] = [];
  segments.forEach((s, i) => {
    const km = s.lengthM / 1000;
    const aadt = input.network.traffic.get(s.id) ?? null;
    const count = agg.count[i]!;
    const exposure = aadt !== null && input.observationYears > 0 ? (count / input.observationYears) / ((aadt * km * 365) / 1e6) : null;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: s.lonLat },
      properties: {
        segmentId: s.id,
        name: s.name,
        roadClass: s.roadClass,
        count,
        severity: round(agg.sev[i]!, 1),
        perKm: round(perKm[i]!, 3),
        severityPerKm: round(agg.sev[i]! / km, 3),
        exposureRate: exposure === null ? null : round(exposure, 2),
        aadt,
        lengthM: Math.round(s.lengthM),
        value: round(perKm[i]!, 3),
      },
    });
    rows.push({ name: s.name, cls: s.roadClass, count, sevKm: agg.sev[i]! / km, perKm: perKm[i]!, exposure, aadt });
  });
  rows.sort((a, b) => b.sevKm - a.sevKm || b.count - a.count);

  return {
    kind: "segment_aggregation",
    featureCollection: { type: "FeatureCollection", features },
    summary: {
      segments: segments.length,
      segmentsWithIncidents: agg.count.reduce((s, v) => s + (v > 0 ? 1 : 0), 0),
      assignedEvents: agg.assigned,
      unassignedEvents: input.points.length - agg.assigned,
      meanSnapDistanceM: agg.meanSnapM === null ? null : round(agg.meanSnapM, 1),
      networkKm: round(segments.reduce((s, x) => s + x.lengthM, 0) / 1000, 2),
      moranI: moran.I === null ? null : round(moran.I, 4),
      moranExpected: round(moran.expected, 4),
      moranPseudoP: moran.pSim === null ? null : round(moran.pSim, 4),
    },
    table: rows.slice(0, 25).map((r, i) => ({
      rank: i + 1,
      segment: r.name,
      roadClass: r.cls,
      count: r.count,
      perKm: round(r.perKm, 2),
      severityPerKm: round(r.sevKm, 2),
      exposureRate: r.exposure === null ? null : round(r.exposure, 2),
      aadt: r.aadt,
    })),
    methodology: methodology("segment_aggregation"),
    notes: [
      "Global Moran's I measures spatial autocorrelation of per-kilometre rates across connected segments.",
      "A pseudo p-value from permutations is reported; no multiple-testing correction is applied across segments.",
    ],
  };
}

function runSpatialComparison(input: PipelineInput, params: Params, progress: ProgressFn): AnalysisResultView {
  const threshold = num(params, "wetThresholdMm");
  progress(0.3, "Aggregating segment densities");
  const agg = aggregateSegments(input);
  const segments = input.network.segments;
  const perKm = segments.map((s, i) => agg.count[i]! / (s.lengthM / 1000));

  progress(0.6, "Correlating with environmental covariates");
  const lighting = segments.map((s) => s.lightingScore);
  const speed = segments.map((s) => s.speedLimitKmh);
  const aadtPairs = segments
    .map((s, i) => ({ d: perKm[i]!, a: input.network.traffic.get(s.id) }))
    .filter((e): e is { d: number; a: number } => e.a !== undefined);
  const corr = [
    { variable: "Lighting score", ...spearman(perKm, lighting) },
    { variable: "Speed limit", ...spearman(perKm, speed) },
    { variable: "Traffic volume (AADT)", ...spearman(aadtPairs.map((e) => e.d), aadtPairs.map((e) => e.a)) },
  ];

  const q1 = quantile(lighting, 0.25) ?? 0;
  const q2 = quantile(lighting, 0.5) ?? 0;
  const q3 = quantile(lighting, 0.75) ?? 0;
  const bins = [
    { label: "Darkest quartile", test: (v: number) => v <= q1 },
    { label: "Lower-middle", test: (v: number) => v > q1 && v <= q2 },
    { label: "Upper-middle", test: (v: number) => v > q2 && v <= q3 },
    { label: "Brightest quartile", test: (v: number) => v > q3 },
  ];
  const strata = bins.map((b) => {
    const idx = lighting.map((v, i) => (b.test(v) ? i : -1)).filter((i) => i >= 0);
    const km = idx.reduce((s, i) => s + segments[i]!.lengthM / 1000, 0);
    const events = idx.reduce((s, i) => s + agg.count[i]!, 0);
    return { label: b.label, segments: idx.length, incidentsPerKm: km > 0 ? events / km : null };
  });

  // Wet vs dry hours: incident rate per hour, normalised by weather hours in the observation window.
  let minT = Infinity;
  let maxT = -Infinity;
  for (const p of input.points) {
    minT = Math.min(minT, p.tMs);
    maxT = Math.max(maxT, p.tMs);
  }
  let wetHours = 0;
  let dryHours = 0;
  for (const [hourStart, precip] of input.network.weatherHourly) {
    if (hourStart < Math.floor(minT / HOUR_MS) * HOUR_MS || hourStart > maxT) continue;
    if (precip >= threshold) wetHours++;
    else dryHours++;
  }
  let accWet = 0;
  let accDry = 0;
  for (const p of input.points) {
    const key = Math.floor(p.tMs / HOUR_MS) * HOUR_MS;
    const precip = input.network.weatherHourly.get(key);
    if (precip === undefined) continue;
    if (precip >= threshold) accWet++;
    else accDry++;
  }
  const rateWet = wetHours > 0 ? accWet / wetHours : null;
  const rateDry = dryHours > 0 ? accDry / dryHours : null;
  const rr = rateWet !== null && rateDry !== null && rateDry > 0 ? rateWet / rateDry : null;
  const logSe = accWet > 0 && accDry > 0 ? Math.sqrt(1 / accWet + 1 / accDry) : null;
  const rrLow = rr !== null && logSe !== null ? rr * Math.exp(-1.96 * logSe) : null;
  const rrHigh = rr !== null && logSe !== null ? rr * Math.exp(1.96 * logSe) : null;

  const features: GeoFeature[] = segments.map((s, i) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: s.lonLat },
    properties: {
      segmentId: s.id,
      name: s.name,
      perKm: round(perKm[i]!, 3),
      lighting: s.lightingScore,
      speedLimitKmh: s.speedLimitKmh,
      value: round(perKm[i]!, 3),
    },
  }));

  const table: Record<string, TableCell>[] = [
    ...corr.map((c) => ({
      section: "Correlation (Spearman)",
      label: c.variable,
      value: c.rho === null ? null : round(c.rho, 3),
      pValue: c.p === null ? null : round(c.p, 4),
      n: c.n,
    })),
    ...strata.map((s) => ({
      section: "Lighting strata",
      label: s.label,
      value: s.incidentsPerKm === null ? null : round(s.incidentsPerKm, 2),
      pValue: null,
      n: s.segments,
    })),
  ];

  return {
    kind: "spatial_comparison",
    featureCollection: { type: "FeatureCollection", features },
    summary: {
      wetThresholdMm: threshold,
      wetHours,
      dryHours,
      accidentsWetHours: accWet,
      accidentsDryHours: accDry,
      wetRateRatio: rr === null ? null : round(rr, 3),
      wetRRLow95: rrLow === null ? null : round(rrLow, 3),
      wetRRHigh95: rrHigh === null ? null : round(rrHigh, 3),
      rhoLighting: corr[0]?.rho === null || corr[0]?.rho === undefined ? null : round(corr[0].rho, 3),
      rhoSpeed: corr[1]?.rho === null || corr[1]?.rho === undefined ? null : round(corr[1].rho, 3),
      rhoAadt: corr[2]?.rho === null || corr[2]?.rho === undefined ? null : round(corr[2].rho, 3),
    },
    table,
    methodology: methodology("spatial_comparison"),
    notes: [
      "Correlations describe association across segments and do not establish causation.",
      "Wet-hour rate ratio compares incidents per weather hour; it ignores differences in traffic volume by hour.",
    ],
  };
}

function runRisk(input: PipelineInput, params: Params, progress: ProgressFn): AnalysisResultView {
  progress(0.3, "Assembling segment indicators");
  const agg = aggregateSegments(input);
  const segments = input.network.segments;
  const inputs: RiskInput[] = segments.map((s, i) => {
    const km = s.lengthM / 1000;
    const aadt = input.network.traffic.get(s.id) ?? null;
    const count = agg.count[i]!;
    const exposureRate = aadt !== null && input.observationYears > 0 ? (count / input.observationYears) / ((aadt * km * 365) / 1e6) : null;
    return {
      segmentId: s.id,
      name: s.name,
      roadClass: s.roadClass,
      count,
      lengthM: s.lengthM,
      severityWeightSum: agg.sev[i]!,
      exposureRate,
      lighting: s.lightingScore,
      speedLimitKmh: s.speedLimitKmh,
    };
  });
  const weights = {
    count: num(params, "wCount"),
    density: num(params, "wDensity"),
    severity: num(params, "wSeverity"),
    exposure: num(params, "wExposure"),
    darkness: num(params, "wDarkness"),
    speed: num(params, "wSpeed"),
  } as Record<RiskIndicator, number>;
  const normalization = params.normalization === "minmax" ? "minmax" : "percentile";
  progress(0.7, "Scoring segments");
  const rows = computeRiskScores(inputs, weights, normalization);
  const geomById = new Map(segments.map((s) => [s.id, s] as const));

  const features: GeoFeature[] = rows.map((r) => {
    const s = geomById.get(r.segmentId)!;
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: s.lonLat },
      properties: riskProperties(r),
    };
  });
  const ranked = [...rows].sort((a, b) => a.rank - b.rank);
  const exposureMissing = rows.filter((r) => r.exposureRate === null).length;
  const scores = rows.map((r) => r.score);
  const cov = rows.map((r) => r.coverage);
  const meanOf = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

  return {
    kind: "risk",
    featureCollection: { type: "FeatureCollection", features },
    summary: {
      segments: rows.length,
      meanScore: meanOf(scores) === null ? null : round(meanOf(scores)!, 1),
      topScore: scores.length ? round(Math.max(...scores), 1) : null,
      meanCoveragePct: meanOf(cov) === null ? null : round(meanOf(cov)! * 100, 1),
      highUncertaintySegments: rows.filter((r) => r.uncertainty === "high").length,
      normalization,
      scale: "Relative index 0–100 (not a probability)",
    },
    table: ranked.slice(0, 25).map((r) => ({
      rank: r.rank,
      segment: r.name,
      roadClass: r.roadClass,
      score: r.score,
      count: r.count,
      ci95: `${r.ciLow}–${r.ciHigh}`,
      perKm: round(r.perKm, 2),
      coveragePct: round(r.coverage * 100, 0),
      uncertainty: r.uncertainty,
    })),
    methodology: methodology("risk"),
    notes: [
      "Scores are relative rankings within this network and filter scope; they are not comparable across different filters or networks.",
      exposureMissing > 0
        ? `Exposure indicator unavailable for ${exposureMissing} segment(s); their coverage is reduced accordingly.`
        : "Exposure indicator available for all segments via traffic observations.",
      "No independent validation has been performed. Confidence intervals describe counting uncertainty only.",
    ],
  };
}

function riskProperties(r: RiskRow) {
  return {
    segmentId: r.segmentId,
    name: r.name,
    roadClass: r.roadClass,
    score: r.score,
    rank: r.rank,
    count: r.count,
    ciLow: r.ciLow,
    ciHigh: r.ciHigh,
    uncertainty: r.uncertainty,
    coverage: round(r.coverage, 3),
    perKm: round(r.perKm, 3),
    severityPerKm: round(r.severityPerKm, 3),
    exposureRate: r.exposureRate === null ? null : round(r.exposureRate, 2),
    value: r.score,
  };
}

export function runAnalysis(type: AnalysisType, input: PipelineInput, params: Params, progress: ProgressFn): AnalysisResultView {
  progress(0.1, "Preparing inputs");
  if (input.points.length === 0) {
    progress(0.9, "No matching incidents");
    return {
      kind: type,
      featureCollection: null,
      summary: { events: 0 },
      table: [],
      methodology: methodology(type),
      notes: ["No incidents match the selected filters. Widen the time range, categories, or dataset selection."],
    };
  }
  switch (type) {
    case "kde":
      return runKde(input, params, progress);
    case "gistar":
      return runGiStar(input, params, progress);
    case "dbscan":
      return runDbscanPipeline(input, params, progress);
    case "segment_aggregation":
      return runSegmentAggregation(input, params, progress);
    case "spatial_comparison":
      return runSpatialComparison(input, params, progress);
    case "risk":
      return runRisk(input, params, progress);
    default:
      throw new Error(`Unknown analysis type: ${String(type)}`);
  }
}


