/**
 * Spatial analysis orchestrator. Every method returns a GeoJSON FeatureCollection
 * plus explicit legend, assumptions and limitations, so that descriptive
 * concentration is never presented as statistical significance.
 */
import { aggregateBySegment, severityWeight, type SegmentAggregate } from "./analytics";
import type { AccidentRecord, SegmentRecord } from "./data";
import { cityProjection, CITY } from "./seed/city";
import { destination, haversine, project, unproject, type LngLat, type XY } from "./geo";
import {
  clarkEvans,
  dbscan,
  gaussianKde,
  getisOrdGiStar,
  mean,
  quantile,
  quantileBreaks,
  stdev,
} from "./stats";

export type AnalysisKind = "kde" | "hotspot" | "dbscan" | "segment" | "environment" | "temporal";

export type AnalysisParams = {
  bandwidthM: number;
  cellSizeM: number;
  weightBy: "count" | "severity" | "casualties";
  epsM: number;
  minPts: number;
  metric: "count" | "severity" | "density" | "ksi";
};

export const DEFAULT_ANALYSIS_PARAMS: AnalysisParams = {
  bandwidthM: 220,
  cellSizeM: 120,
  weightBy: "severity",
  epsM: 140,
  minPts: 5,
  metric: "severity",
};

export type LegendEntry = { label: string; color: string; detail?: string };

export type AnalysisTable = {
  title: string;
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, string | number>[];
  note?: string;
};

export type AnalysisResult = {
  kind: AnalysisKind;
  params: AnalysisParams;
  title: string;
  description: string;
  features: GeoJSON.FeatureCollection;
  legend: LegendEntry[];
  metrics: { label: string; value: string; detail?: string }[];
  assumptions: string[];
  limitations: string[];
  tables: AnalysisTable[];
  extent: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null;
  durationMs: number;
};

export function parseAnalysisParams(input: URLSearchParams | Record<string, string | undefined>): AnalysisParams {
  const get = (key: string): string | undefined =>
    input instanceof URLSearchParams ? input.get(key) ?? undefined : input[key];
  const numberIn = (key: string, fallback: number, min: number, max: number) => {
    const parsed = Number(get(key));
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  return {
    bandwidthM: numberIn("bandwidthM", DEFAULT_ANALYSIS_PARAMS.bandwidthM, 50, 1500),
    cellSizeM: numberIn("cellSizeM", DEFAULT_ANALYSIS_PARAMS.cellSizeM, 40, 800),
    weightBy: (get("weightBy") as AnalysisParams["weightBy"]) ?? DEFAULT_ANALYSIS_PARAMS.weightBy,
    epsM: numberIn("epsM", DEFAULT_ANALYSIS_PARAMS.epsM, 30, 1200),
    minPts: Math.round(numberIn("minPts", DEFAULT_ANALYSIS_PARAMS.minPts, 2, 40)),
    metric: (get("metric") as AnalysisParams["metric"]) ?? DEFAULT_ANALYSIS_PARAMS.metric,
  };
}

const KDE_LEGEND = [
  { label: "Very low", color: "#0e2a3a" },
  { label: "Low", color: "#0e7490" },
  { label: "Moderate", color: "#22d3ee" },
  { label: "High", color: "#fbbf24" },
  { label: "Very high", color: "#f43f5e" },
];

const HOTSPOT_LEGEND: LegendEntry[] = [
  { label: "Hot spot 99 %", color: "#dc2626", detail: "Gi* z ≥ 2.58" },
  { label: "Hot spot 95 %", color: "#f97316", detail: "1.96 ≤ z < 2.58" },
  { label: "Hot spot 90 %", color: "#facc15", detail: "1.65 ≤ z < 1.96" },
  { label: "Not significant", color: "#64748b" },
  { label: "Cold spot 90–99 %", color: "#3b82f6", detail: "z ≤ −1.65" },
];

function extentOf(points: AccidentRecord[], padM = 400) {
  const lat = points.map((p) => p.lat);
  const lng = points.map((p) => p.lng);
  const minLat = Math.min(...lat);
  const maxLat = Math.max(...lat);
  const minLng = Math.min(...lng);
  const maxLng = Math.max(...lng);
  const dLat = padM / 111_132;
  const dLng = padM / 68_000;
  return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLng: minLng - dLng, maxLng: maxLng + dLng };
}

function emptyResult(kind: AnalysisKind, params: AnalysisParams, reason: string, durationMs: number): AnalysisResult {
  return {
    kind,
    params,
    title: "No analysable records",
    description: reason,
    features: { type: "FeatureCollection", features: [] },
    legend: [],
    metrics: [],
    assumptions: [],
    limitations: ["Increase the temporal window or include pending citizen reports to obtain an analysable sample."],
    tables: [],
    extent: null,
    durationMs,
  };
}

type FeatureLike =
  | { geometry: GeoJSON.Geometry; properties: Record<string, unknown> }
  | GeoJSON.Feature;

function toFeatures(features: FeatureLike[]): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  for (const feature of features) {
    if ("type" in feature && (feature as GeoJSON.Feature).type === "Feature") {
      out.push(feature as GeoJSON.Feature);
    } else {
      const shaped = feature as { geometry: GeoJSON.Geometry; properties: Record<string, unknown> };
      out.push({ type: "Feature", geometry: shaped.geometry, properties: shaped.properties });
    }
  }
  return { type: "FeatureCollection", features: out };
}

function kde(points: AccidentRecord[], params: AnalysisParams): AnalysisResult {
  const started = performance.now();
  if (points.length < 5) return emptyResult("kde", params, "KDE requires at least 5 events.", performance.now() - started);
  const xy = points.map((p) => project({ lat: p.lat, lng: p.lng }, cityProjection));
  const weights = points.map((p) =>
    params.weightBy === "count" ? 1 : params.weightBy === "casualties" ? 1 + p.casualties : severityWeight(p.severityCode),
  );
  const extent = extentOf(points, params.bandwidthM * 2.5);
  const corners = [
    project({ lat: extent.minLat, lng: extent.minLng }, cityProjection),
    project({ lat: extent.maxLat, lng: extent.maxLng }, cityProjection),
  ];
  const lattice = gaussianKde(
    xy,
    weights,
    { minX: corners[0].x, minY: corners[0].y, maxX: corners[1].x, maxY: corners[1].y },
    params.cellSizeM,
    params.bandwidthM,
  );
  const max = Math.max(...lattice.values);
  const threshold = max * 0.01;
  const breaks = quantileBreaks(lattice.values.filter((v) => v > 0), 5);
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (let row = 0; row < lattice.rows; row += 1) {
    for (let col = 0; col < lattice.cols; col += 1) {
      const value = lattice.values[row * lattice.cols + col];
      if (value <= threshold) continue;
      const x0 = lattice.minX + (col - 0.5) * lattice.cellSize;
      const y0 = lattice.minY + (row - 0.5) * lattice.cellSize;
      const x1 = x0 + lattice.cellSize;
      const y1 = y0 + lattice.cellSize;
      const ring: LngLat[] = [
        (() => {
          const p = unproject({ x: x0, y: y0 }, cityProjection);
          return [p.lng, p.lat];
        })(),
        (() => {
          const p = unproject({ x: x1, y: y0 }, cityProjection);
          return [p.lng, p.lat];
        })(),
        (() => {
          const p = unproject({ x: x1, y: y1 }, cityProjection);
          return [p.lng, p.lat];
        })(),
        (() => {
          const p = unproject({ x: x0, y: y1 }, cityProjection);
          return [p.lng, p.lat];
        })(),
        (() => {
          const p = unproject({ x: x0, y: y0 }, cityProjection);
          return [p.lng, p.lat];
        })(),
      ];
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          value: Math.round(value * 1000) / 1000,
          densityPerKm2: Math.round((value / (params.cellSizeM ** 2)) * 1e6 * 100) / 100,
          phase: Math.round((value / max) * 100),
        },
      });
    }
  }
  const areaM2 = Math.abs((corners[1].x - corners[0].x) * (corners[1].y - corners[0].y));
  const ce = clarkEvans(xy, areaM2);
  return {
    kind: "kde",
    params,
    title: "Gaussian kernel density surface",
    description:
      "Severity-weighted kernel density of accident points on a regular lattice. Cell values integrate to the number of events, so the surface shows where events are concentrated, not how likely a future event is.",
    features: toFeatures(features),
    legend: KDE_LEGEND,
    metrics: [
      { label: "Events in window", value: String(points.length) },
      { label: "Bandwidth", value: `${params.bandwidthM} m`, detail: `cell ${params.cellSizeM} m` },
      { label: "Peak weighted density", value: `${((max / params.cellSizeM ** 2) * 1e6).toFixed(1)} w-events/km²` },
      { label: "Non-empty cells", value: String(features.length) },
      { label: "Clark–Evans R", value: ce.r.toFixed(3), detail: ce.r < 1 ? "clustered vs CSR" : "dispersed vs CSR" },
      { label: "Weighting", value: params.weightBy },
    ],
    assumptions: [
      "Kernel density is a descriptive smoother: the bandwidth controls how much local detail is preserved.",
      "The isotropic Gaussian kernel ignores road geometry and barriers; density can spill across rivers or closed areas.",
      "Clark–Evans R < 1 indicates clustering relative to complete spatial randomness within the padded bounding box.",
      "Severity weighting changes the surface magnitude; it does not convert density into an occurrence probability.",
    ],
    limitations: [
      "Citizen reports are an opportunistic sample: reporting propensity varies by location, time and severity.",
      "Edge effects are reduced but not eliminated by the padded extent.",
    ],
    tables: [
      {
        title: "Cell classification thresholds",
        columns: [
          { key: "class", label: "Class" },
          { key: "above", label: "Value above", align: "right" },
        ],
        rows: breaks.map((b, i) => ({
          class: `Q${i + 1}`,
          above: b.toFixed(2),
        })),
        note: "Quantile breaks are computed on non-empty cells of this run only.",
      },
    ],
    extent,
    durationMs: performance.now() - started,
  };
}

function hotspots(points: AccidentRecord[], params: AnalysisParams): AnalysisResult {
  const started = performance.now();
  if (points.length < 30)
    return emptyResult("hotspot", params, "Getis-Ord Gi* requires at least 30 events for the normal approximation.", performance.now() - started);
  const xy = points.map((p) => project({ lat: p.lat, lng: p.lng }, cityProjection));
  const weights = points.map((p) => severityWeight(p.severityCode));
  const gi = getisOrdGiStar(xy, params.bandwidthM, weights);
  const colors: Record<string, string> = {
    hot_99: "#dc2626",
    hot_95: "#f97316",
    hot_90: "#facc15",
    cold_99: "#1d4ed8",
    cold_95: "#3b82f6",
    cold_90: "#93c5fd",
    not_significant: "#64748b",
    isolated: "#cbd5e1",
  };
  const features = points.map((point, i) => {
    const result = gi.results[i];
    return {
      geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] as [number, number] },
      properties: {
        publicId: point.publicId,
        severity: point.severityCode,
        z: Math.round(result.z * 100) / 100,
        p: Math.round(result.p * 1000) / 1000,
        gi: Math.round(result.gi * 10) / 10,
        neighbours: result.neighbours,
        classification: result.classification,
        color: colors[result.classification] ?? "#64748b",
      },
    };
  });
  const sample = gi.results.filter((r) => r.classification !== "isolated");
  const sorted = [...sample].sort((a, b) => b.z - a.z).slice(0, 12);
  const meanZ = mean(sample.map((r) => r.z));
  const sdZ = stdev(sample.map((r) => r.z));
  return {
    kind: "hotspot",
    params,
    title: "Getis-Ord Gi* local hot-spot screen",
    description:
      "A location-specific statistic comparing the local severity-weighted sum with the global expectation under spatial randomness. Significant positive z values identify clusters of high values, not causal hot spots.",
    features: toFeatures(features),
    legend: HOTSPOT_LEGEND,
    metrics: [
      { label: "Events tested", value: String(points.length) },
      { label: "Distance band", value: `${params.bandwidthM} m` },
      { label: "Hot locations", value: String(gi.hotCount) },
      { label: "Cold locations", value: String(gi.coldCount) },
      { label: "Mean z", value: meanZ.toFixed(2), detail: `sd ${sdZ.toFixed(2)}` },
    ],
    assumptions: gi.assumptions,
    limitations: [
      "Gi* assumes a stationary null model and independent observations; repeat reports of the same event inflate local sums (duplicates are excluded where possible).",
      "Multiple testing: at α = 0.05 roughly 5 % of locations are expected to be flagged by chance. Use FDR-adjusted thresholds for confirmatory claims.",
      "Significance depends strongly on the distance band; results are not portable across bandwidths.",
    ],
    tables: [
      {
        title: "Strongest hot locations",
        columns: [
          { key: "id", label: "Accident" },
          { key: "z", label: "Gi* z", align: "right" },
          { key: "p", label: "p (two-tailed)", align: "right" },
          { key: "neighbours", label: "Neighbours", align: "right" },
        ],
        rows: sorted.map((r) => ({
          id: points[r.index].publicId,
          z: r.z.toFixed(2),
          p: r.p.toFixed(3),
          neighbours: r.neighbours,
        })),
        note: "Sorted by z. Values are location-specific screens, not cluster-level p-values.",
      },
    ],
    extent: extentOf(points, 700),
    durationMs: performance.now() - started,
  };
}

function convexHull(points: XY[]): XY[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: XY[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function cluster(points: AccidentRecord[], params: AnalysisParams): AnalysisResult {
  const started = performance.now();
  if (points.length < 10)
    return emptyResult("dbscan", params, "DBSCAN requires at least 10 events.", performance.now() - started);
  const xy = points.map((p) => project({ lat: p.lat, lng: p.lng }, cityProjection));
  const result = dbscan(xy, params.epsM, params.minPts);
  const palette = ["#22d3ee", "#a78bfa", "#f97316", "#34d399", "#f472b6", "#facc15", "#60a5fa", "#fb7185"];
  const clusterFeatures: GeoJSON.Feature[] = [];
  result.clusters
    .sort((a, b) => b.size - a.size)
    .forEach((c, index) => {
      const members = xy.filter((_, i) => result.labels[i] === c.clusterId);
      const hull = convexHull(members);
      const ring: [number, number][] = hull.map((p) => {
        const ll = unproject(p, cityProjection);
        return [ll.lng, ll.lat];
      });
      if (ring.length >= 3) ring.push(ring[0]);
      const radii = members.map((p) => Math.hypot(p.x - c.centroid.x, p.y - c.centroid.y));
      const centroid = unproject(c.centroid, cityProjection);
      const memberIndexes = Array.from(result.labels)
        .map((label, i) => (label === c.clusterId ? i : -1))
        .filter((i) => i >= 0);
      const meanSeverity =
        memberIndexes.length > 0 ? mean(memberIndexes.map((i) => severityWeight(points[i].severityCode))) : 0;
      clusterFeatures.push({
        type: "Feature",
        geometry:
          ring.length >= 4
            ? { type: "Polygon", coordinates: [ring] }
            : {
                type: "Point",
                coordinates: [centroid.lng, centroid.lat],
              },
        properties: {
          clusterId: index + 1,
          size: c.size,
          color: palette[index % palette.length],
          meanRadiusM: Math.round(mean(radii)),
          meanSeverity: Math.round(meanSeverity * 10) / 10,
          centroid: [Math.round(centroid.lng * 1e6) / 1e6, Math.round(centroid.lat * 1e6) / 1e6],
        },
      });
    });
  const noiseFeatures = points
    .filter((_, i) => result.labels[i] === 0)
    .map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] as [number, number] },
      properties: { publicId: p.publicId, noise: true, color: "#475569" },
    }));
  const largest = result.clusters.reduce((best, c) => (c.size > best.size ? c : best), { clusterId: 0, size: 0, centroid: { x: 0, y: 0 } });
  return {
    kind: "dbscan",
    params,
    title: "DBSCAN density-based clustering",
    description:
      "Clusters are contiguous groups of at least minPts events within eps metres. Noise events do not belong to any cluster — an explicit way to separate diffuse background reporting from dense concentrations.",
    features: toFeatures([...clusterFeatures, ...noiseFeatures]),
    legend: [
      { label: "Cluster hull", color: "#22d3ee", detail: "≥ minPts within eps" },
      { label: "Noise", color: "#475569", detail: "unclustered" },
    ],
    metrics: [
      { label: "Clusters", value: String(result.clusterCount) },
      { label: "Clustered events", value: String(points.length - result.noiseCount) },
      { label: "Noise share", value: `${((result.noiseCount / points.length) * 100).toFixed(1)} %` },
      { label: "Largest cluster", value: String(largest.size) },
      { label: "eps / minPts", value: `${params.epsM} m / ${params.minPts}` },
    ],
    assumptions: [
      "DBSCAN finds arbitrarily shaped clusters and labels sparse observations as noise; it does not estimate cluster significance.",
      "Results are sensitive to eps and minPts; both are exposed as parameters and should be reported with any result.",
      "Metric distances use the local projection; events separated by barriers such as the river are still clustered if they are close in space.",
    ],
    limitations: [
      "Cluster membership is descriptive. A cluster is not automatically a validated hot spot or a causal concentration.",
      "Unequal exposure (traffic volume, population) is not modelled here; segment aggregation and the risk workspace address exposure.",
    ],
    tables: [
      {
        title: "Cluster inventory",
        columns: [
          { key: "cluster", label: "Cluster" },
          { key: "size", label: "Events", align: "right" },
          { key: "radius", label: "Mean radius (m)", align: "right" },
          { key: "lng", label: "Centroid lon", align: "right" },
          { key: "lat", label: "Centroid lat", align: "right" },
        ],
        rows: result.clusters
          .sort((a, b) => b.size - a.size)
          .slice(0, 15)
          .map((c, i) => {
            const members = xy.filter((_, j) => result.labels[j] === c.clusterId);
            const radii = members.map((p) => Math.hypot(p.x - c.centroid.x, p.y - c.centroid.y));
            const centroid = unproject(c.centroid, cityProjection);
            return {
              cluster: `C${i + 1}`,
              size: c.size,
              radius: Math.round(mean(radii)),
              lng: centroid.lng.toFixed(5),
              lat: centroid.lat.toFixed(5),
            };
          }),
        note: "Top 15 clusters by event count.",
      },
    ],
    extent: extentOf(points, 700),
    durationMs: performance.now() - started,
  };
}

export function segmentAnalysis(points: AccidentRecord[], segments: SegmentRecord[], params: AnalysisParams): AnalysisResult {
  const started = performance.now();
  const aggregates = aggregateBySegment(points, segments);
  const withEvents = aggregates.filter((a) => a.count > 0);
  if (withEvents.length === 0)
    return emptyResult("segment", params, "No events could be assigned to a road segment in this window.", performance.now() - started);
  const valueOf = (a: SegmentAggregate) =>
    params.metric === "count" ? a.count : params.metric === "density" ? a.densityPerKm : params.metric === "ksi" ? a.ksi : a.severityWeighted;
  const sorted = [...withEvents].sort((a, b) => valueOf(b) - valueOf(a));
  const max = valueOf(sorted[0]);
  const features = sorted.map((a) => ({
    geometry: { type: "LineString" as const, coordinates: a.geometry.coordinates },
    properties: {
      segmentId: a.segmentId,
      name: a.name,
      roadClass: a.roadClass,
      district: a.district,
      value: Math.round(valueOf(a) * 10) / 10,
      count: a.count,
      ksi: a.ksi,
      severityWeighted: a.severityWeighted,
      densityPerKm: Math.round(a.densityPerKm * 10) / 10,
      aadt: a.aadt,
      phase: max > 0 ? Math.round((valueOf(a) / max) * 100) : 0,
    },
  }));
  return {
    kind: "segment",
    params,
    title: "Road-segment accident aggregation",
    description:
      `Nearest-road-segment assignment (70 m tolerance) followed by ${params.metric === "density" ? "length-normalised density" : params.metric === "severity" ? "severity-weighted counts" : params.metric === "ksi" ? "killed-or-seriously-injured counts" : "raw counts"} per segment.`,
    features: toFeatures(features),
    legend: [
      { label: "Low", color: "#0e7490" },
      { label: "Moderate", color: "#22d3ee" },
      { label: "High", color: "#fbbf24" },
      { label: "Very high", color: "#f43f5e" },
    ],
    metrics: [
      { label: "Segments with events", value: `${withEvents.length} / ${aggregates.length}` },
      { label: "Metric", value: params.metric },
      { label: "Maximum", value: String(Math.round(max * 10) / 10) },
      { label: "Network length", value: `${(aggregates.reduce((s, a) => s + a.lengthM, 0) / 1000).toFixed(1)} km` },
      { label: "Mean per segment", value: (points.length / withEvents.length).toFixed(2) },
    ],
    assumptions: [
      "Accidents without a segment within 70 m are retained in the statistics but not plotted in this layer.",
      "Segment boundaries are synthetic and equal-length halves of street blocks; real segment definitions (junctions to junctions) would change counts.",
      "Counts are not exposure-normalised here — use the risk workspace for AADT-aware indicators.",
    ],
    limitations: [
      "Long segments accumulate more events by construction; compare density or rate views before ranking.",
      "Small counts are unstable: a single severe event can dominate the ranking.",
    ],
    tables: [
      {
        title: "Top road segments",
        columns: [
          { key: "segment", label: "Segment" },
          { key: "name", label: "Name" },
          { key: "count", label: "Events", align: "right" },
          { key: "ksi", label: "KSI", align: "right" },
          { key: "density", label: "Per km", align: "right" },
        ],
        rows: sorted.slice(0, 15).map((a, i) => ({
          segment: `#${i + 1} ${a.segmentId}`,
          name: a.name,
          count: a.count,
          ksi: a.ksi,
          density: a.densityPerKm.toFixed(1),
        })),
      },
    ],
    extent: extentOf(points, 500),
    durationMs: performance.now() - started,
  };
}

function temporal(points: AccidentRecord[], params: AnalysisParams): AnalysisResult {
  const started = performance.now();
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  points.forEach((p) => {
    cells[p.dow][p.hour] += 1;
  });
  const features: GeoJSON.Feature[] = [];
  points.forEach((p) => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { publicId: p.publicId, hour: p.hour, dow: p.dow, severity: p.severityCode },
    });
  });
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const peakHour = points.length
    ? Array.from({ length: 24 }, (_, h) => ({ h, n: points.filter((p) => p.hour === h).length })).sort((a, b) => b.n - a.n)[0]
    : { h: 0, n: 0 };
  return {
    kind: "temporal",
    params,
    title: "Temporal aggregation",
    description: "Accident frequency by hour-of-day and day-of-week for the current filter selection. Use it to confirm whether spatial concentrations are also temporally persistent.",
    features: toFeatures(features),
    legend: [],
    metrics: [
      { label: "Events", value: String(points.length) },
      { label: "Peak hour (UTC)", value: `${String(peakHour.h).padStart(2, "0")}:00`, detail: `${peakHour.n} events` },
      { label: "Night share", value: `${points.length ? ((points.filter((p) => p.hour < 6 || p.hour >= 22).length / points.length) * 100).toFixed(1) : 0} %` },
      { label: "Weekend share", value: `${points.length ? ((points.filter((p) => p.dow === 0 || p.dow === 6).length / points.length) * 100).toFixed(1) : 0} %` },
    ],
    assumptions: [
      "Times are UTC; the synthetic study area uses UTC to avoid timezone ambiguity.",
      "Hour-of-day and day-of-week are derived at generation/ingestion time and stored explicitly for indexed aggregation.",
    ],
    limitations: ["Aggregation is sensitive to the selected date range; incomplete final months distort seasonal readings."],
    tables: [
      {
        title: "Hour × day-of-week matrix",
        columns: [
          { key: "dow", label: "Day" },
          ...Array.from({ length: 24 }, (_, h) => ({ key: `h${h}`, label: String(h).padStart(2, "0"), align: "right" as const })),
        ],
        rows: cells.map((row, d) => {
          const record: Record<string, string | number> = { dow: dayNames[d] };
          row.forEach((value, h) => {
            record[`h${h}`] = value;
          });
          return record;
        }),
      },
    ],
    extent: extentOf(points, 500),
    durationMs: performance.now() - started,
  };
}

function environment(
  points: AccidentRecord[],
  observations: { condition: string; roadSurface: string; lighting: string; district: string; observedAt: string; precipitationMm: number }[],
  params: AnalysisParams,
): AnalysisResult {
  const started = performance.now();
  const observedTotal = observations.length;
  const wetObs = observations.filter((o) => o.condition.includes("rain") || o.condition === "fog").length;
  const wetShare = observedTotal ? wetObs / observedTotal : 0;
  const known = points.filter((p) => p.weather !== null);
  const wet = known.filter((p) => p.roadSurface !== "dry");
  const dry = known.filter((p) => p.roadSurface === "dry");
  const wetKsi = wet.filter((p) => p.severityCode >= 3).length;
  const dryKsi = dry.filter((p) => p.severityCode >= 3).length;
  const perCondition = new Map<string, { count: number; ksi: number; exposure: number }>();
  known.forEach((p) => {
    const key = p.weather ?? "unknown";
    const entry = perCondition.get(key) ?? { count: 0, ksi: 0, exposure: 0 };
    entry.count += 1;
    if (p.severityCode >= 3) entry.ksi += 1;
    perCondition.set(key, entry);
  });
  const features = known.map((p) => ({
    geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] as [number, number] },
    properties: {
      publicId: p.publicId,
      weather: p.weather,
      surface: p.roadSurface,
      lighting: p.lighting,
      color: p.roadSurface === "dry" ? "#22d3ee" : p.roadSurface === "wet" ? "#3b82f6" : "#6366f1",
    },
  }));
  return {
    kind: "environment",
    params,
    title: "Accidents vs environmental observations",
    description:
      "Descriptive comparison of accident occurrence against the observed weather/surface sample. It quantifies co-occurrence and reporting completeness — not an attributable risk.",
    features: toFeatures(features),
    legend: [
      { label: "Dry surface", color: "#22d3ee" },
      { label: "Wet surface", color: "#3b82f6" },
      { label: "Standing water", color: "#6366f1" },
      { label: "Missing context", color: "#475569" },
    ],
    metrics: [
      { label: "Weather observed share", value: `${points.length ? ((known.length / points.length) * 100).toFixed(1) : 0} %` },
      { label: "Wet/damp accident share", value: `${known.length ? ((wet.length / known.length) * 100).toFixed(1) : 0} %` },
      { label: "Wet observation share", value: `${(wetShare * 100).toFixed(1)} %`, detail: `${observedTotal} environment samples` },
      { label: "KSI rate — wet", value: `${wet.length ? ((wetKsi / wet.length) * 100).toFixed(1) : 0} %` },
      { label: "KSI rate — dry", value: `${dry.length ? ((dryKsi / dry.length) * 100).toFixed(1) : 0} %` },
    ],
    assumptions: [
      "Environmental context is joined by time-of-incident sampling, with deliberate missingness (synthetic) to reflect real coverage gaps.",
      "Accident share under wet conditions is compared with the share of wet observations in the same period; this is a crude exposure proxy.",
      "No control is made for traffic volume, so wet-condition counts cannot be read as wet-weather risk.",
    ],
    limitations: [
      "Observations are point samples in districts, not a continuous weather surface.",
      "Citizen reports of weather may be inaccurate or recalled incorrectly.",
    ],
    tables: [
      {
        title: "Accidents by reported condition",
        columns: [
          { key: "condition", label: "Condition" },
          { key: "count", label: "Events", align: "right" },
          { key: "ksi", label: "KSI", align: "right" },
          { key: "ksiRate", label: "KSI rate", align: "right" },
        ],
        rows: Array.from(perCondition.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .map(([condition, v]) => ({
            condition,
            count: v.count,
            ksi: v.ksi,
            ksiRate: `${((v.ksi / Math.max(1, v.count)) * 100).toFixed(1)} %`,
          })),
      },
    ],
    extent: extentOf(points, 500),
    durationMs: performance.now() - started,
  };
}

export function runAnalysis(
  kind: AnalysisKind,
  points: AccidentRecord[],
  segments: SegmentRecord[],
  params: AnalysisParams,
  observations: { condition: string; roadSurface: string; lighting: string; district: string; observedAt: string; precipitationMm: number }[],
): AnalysisResult {
  switch (kind) {
    case "kde":
      return kde(points, params);
    case "hotspot":
      return hotspots(points, params);
    case "dbscan":
      return cluster(points, params);
    case "segment":
      return segmentAnalysis(points, segments, params);
    case "temporal":
      return temporal(points, params);
    case "environment":
      return environment(points, observations, params);
    default:
      return emptyResult(kind, params, "Unsupported analysis kind.", 0);
  }
}

export const CITY_REFERENCE = {
  name: CITY.name,
  center: CITY.center,
  halfWidthM: CITY.halfWidthM,
  halfHeightM: CITY.halfHeightM,
};

export function nearestSegmentDistance(lat: number, lng: number, segments: SegmentRecord[]): { segmentId: string; distanceM: number } | null {
  if (segments.length === 0) return null;
  const p = project({ lat, lng }, cityProjection);
  let best: { segmentId: string; distanceM: number } | null = null;
  for (const segment of segments) {
    const a = project({ lat: segment.startLat, lng: segment.startLng }, cityProjection);
    const b = project({ lat: segment.endLat, lng: segment.endLng }, cityProjection);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const distance = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (!best || distance < best.distanceM) best = { segmentId: segment.id, distanceM: distance };
  }
  return best;
}

export function coordinateUncertaintyNote(points: AccidentRecord[]): string {
  const median = quantile(points.map((p) => p.positionalUncertaintyM), 0.5);
  return `Median positional uncertainty in this selection is ${median.toFixed(1)} m; ${(
    (points.filter((p) => p.positionalUncertaintyM > 30).length / Math.max(1, points.length)) *
    100
  ).toFixed(1)} % of events exceed 30 m.`;
}

export function bearingTest(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const d = destination({ lat: lat1, lng: lng1 }, 45, 100);
  return haversine(d, { lat: lat2, lng: lng2 });
}
