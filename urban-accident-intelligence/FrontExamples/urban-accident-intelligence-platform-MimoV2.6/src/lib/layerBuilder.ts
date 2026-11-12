/**
 * Layer builder — turns geospatial engine output into styled GeoJSON plus
 * legend and method text for the console. Keeps analysis production out of UI.
 */

import {
  aggregateBySegment,
  dbscan,
  giStar,
  kernelDensity,
  mean,
  normalise,
  quantile,
} from "./geo";
import { SEVERITIES } from "./constants";
import type {
  Accident,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GridCell,
  Position,
  RoadSegment,
  SegmentRisk,
  RiskFactor,
} from "./types";
import type { MapLayerPayload, LegendStop } from "./appState";

const SEQUENTIAL = ["#12212b", "#1c4a52", "#2c7f78", "#4fd1c5", "#9df0e6"];
const DIVERGING = ["#4fd1c5", "#2c7f78", "#2a343c", "#b9722a", "#f2a03d", "#ffd9a0"];
const AMBER_RAMP = ["#1a1410", "#4a2f14", "#8a5217", "#b9722a", "#f2a03d", "#ffd9a0"];

function rampStops(min: number, max: number, colours: string[], unit: string, fmt: (v: number) => string): LegendStop[] {
  const span = max - min || 1;
  return colours.map((c, i) => {
    const v = min + (span * i) / (colours.length - 1);
    return { value: v, colour: c, label: fmt(v) };
  });
}

function colourAt(value: number, stops: LegendStop[]): string {
  if (!stops.length) return "transparent";
  if (value <= stops[0].value) return stops[0].colour;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (value >= a.value && value <= b.value) {
      const t = b.value === a.value ? 0 : (value - a.value) / (b.value - a.value);
      return lerpHex(a.colour, b.colour, t);
    }
  }
  return stops[stops.length - 1].colour;
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const r = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${r.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

type StyledCell = GridCell & { fill: string; opacity?: number; stroke?: string };

function gridPolygons(
  cells: StyledCell[],
  cellSizeM: number,
  minLon: number,
  minLat: number,
  extra: (c: GridCell) => Record<string, unknown>,
): GeoJsonFeatureCollection {
  const halfLon = cellSizeM / 2 / 111320 / Math.cos((minLat * Math.PI) / 180);
  const halfLat = cellSizeM / 2 / 110540;
  return {
    type: "FeatureCollection",
    features: cells.map((c): GeoJsonFeature => {
      const ring: Position[] = [
        [c.lon - halfLon, c.lat - halfLat],
        [c.lon + halfLon, c.lat - halfLat],
        [c.lon + halfLon, c.lat + halfLat],
        [c.lon - halfLon, c.lat + halfLat],
        [c.lon - halfLon, c.lat - halfLat],
      ];
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          fill: c.fill,
          opacity: c.opacity ?? 0.55,
          stroke: c.stroke ?? "rgba(255,255,255,0.045)",
          value: c.value,
          ...extra(c),
        },
      };
    }),
  };
}

export interface LayerParams {
  bandwidthM: number;
  cellSizeM: number;
  epsM: number;
  minPts: number;
  bandM: number;
  weighting: "uniform" | "severity";
  fdr: boolean;
}

export const DEFAULT_LAYER_PARAMS: LayerParams = {
  bandwidthM: 320,
  cellSizeM: 160,
  epsM: 260,
  minPts: 8,
  bandM: 400,
  weighting: "severity",
  fdr: true,
};

function toPoints(accidents: Accident[]) {
  return accidents.map((a) => ({ id: a.id, lon: a.lon, lat: a.lat, weight: a.severityWeight }));
}

// ---------------------------------------------------------------------------
// Risk engine — transparent, interpretable, configurable weighted scoring.
// ---------------------------------------------------------------------------

export const DEFAULT_RISK_FACTORS: RiskFactor[] = [
  { key: "frequency", label: "Accident frequency", weight: 0.3, unit: "events", description: "Number of reports snapped to the segment in the analysis window." },
  { key: "density", label: "Segment accident density", weight: 0.18, unit: "events/km", description: "Frequency normalised by segment length." },
  { key: "severity", label: "Severity-weighted index", weight: 0.22, unit: "index", description: "Sum of severity weights (fatal 10 · serious 5 · slight 2 · damage 1)." },
  { key: "exposure", label: "Traffic exposure", weight: 0.12, unit: "veh/h", description: "Synthetic modelled traffic volume. Used as an exposure proxy, not an observed count." },
  { key: "speed", label: "Design speed", weight: 0.08, unit: "km/h", description: "Posted speed limit — higher speed is associated with more severe outcomes." },
  { key: "lighting", label: "Lighting deficiency", weight: 0.05, unit: "class", description: "Segments without full lighting receive a higher value." },
  { key: "junction", label: "Junction exposure", weight: 0.05, unit: "bool", description: "Segments with junction control at one or both ends." },
];

export type { RiskFactor, SegmentRisk };

export interface RiskParams {
  factors: RiskFactor[];
  includeExposure: boolean;
  minCoverage: number;
}

export function computeRisk(
  accidents: Accident[],
  segments: RoadSegment[],
  traffic: Map<number, { aadt: number | null; coverageRatio: number; volume: number }>,
  params: RiskParams,
): {
  segments: SegmentRisk[];
  factors: RiskFactor[];
  statistics: Record<string, number>;
  coverage: {
    segmentCoverageRatio: number;
    trafficCoverageRatio: number;
    positionalAccuracyMedian: number;
    verifiedRatio: number;
    temporalSpanDays: number;
    caveats: string[];
  };
} {
  const agg = aggregateBySegment(accidents, segments);
  const freq = segments.map((s) => agg.get(s.id)?.count ?? 0);
  const dens = segments.map((s) => agg.get(s.id)?.densityPerKm ?? 0);
  const sev = segments.map((s) => agg.get(s.id)?.severityWeighted ?? 0);
  const expo = segments.map((s) => traffic.get(s.id)?.volume ?? 0);
  const speed = segments.map((s) => s.speedLimitKph);
  const light = segments.map((s) => (s.lighting === "full" ? 0 : s.lighting === "partial" ? 0.5 : 1));
  const junction = segments.map((s) => (s.hasJunctionControl ? 1 : 0));

  const n = {
    frequency: normalise(freq),
    density: normalise(dens),
    severity: normalise(sev),
    exposure: normalise(expo),
    speed: normalise(speed),
    lighting: light,
    junction: junction,
  };

  const activeFactors = params.factors.filter((f) => params.includeExposure || f.key !== "exposure");
  const totalWeight = activeFactors.reduce((a, f) => a + f.weight, 0) || 1;

  const results: SegmentRisk[] = segments.map((s, i) => {
    const factors: Record<string, number> = {
      frequency: n.frequency[i],
      density: n.density[i],
      severity: n.severity[i],
      exposure: n.exposure[i],
      speed: n.speed[i],
      lighting: n.lighting[i],
      junction: n.junction[i],
    };
    let idx = 0;
    for (const f of activeFactors) idx += (factors[f.key] ?? 0) * f.weight;
    idx /= totalWeight;

    const trafficCov = traffic.get(s.id)?.coverageRatio ?? 0;
    const count = agg.get(s.id)?.count ?? 0;
    const verified = agg.get(s.id)?.verifiedRatio ?? 0;
    // Uncertainty rises with low counts, low traffic coverage and imprecise geocoding.
    const uncertainty = Math.min(
      1,
      0.42 * (1 / (1 + count / 2)) + 0.33 * (1 - trafficCov) + 0.25 * (1 - verified),
    );

    return {
      ...s,
      accidentCount: count,
      severityWeightedIndex: Math.round((agg.get(s.id)?.severityWeighted ?? 0) * 10) / 10,
      factors,
      riskIndex: Math.round(idx * 1000) / 1000,
      riskRank: 0,
      exposureCoverage: trafficCov,
      uncertainty: Math.round(uncertainty * 100) / 100,
    };
  });

  const sorted = [...results].sort((a, b) => b.riskIndex - a.riskIndex);
  sorted.forEach((s, i) => (s.riskRank = i + 1));
  const byId = new Map(sorted.map((s) => [s.id, s.riskRank]));
  for (const r of results) r.riskRank = byId.get(r.id) ?? 0;

  const accs = accidents.map((a) => a.positionalAccuracyM).sort((x, y) => x - y);
  const times = accidents.map((a) => Date.parse(a.occurredAt));
  const coveredTraffic = segments.filter((s) => (traffic.get(s.id)?.coverageRatio ?? 0) > 0.5).length;

  return {
    segments: results,
    factors: activeFactors,
    statistics: {
      segments: segments.length,
      ranked: results.filter((r) => r.accidentCount! > 0).length,
      meanIndex: Math.round(mean(results.map((r) => r.riskIndex)) * 1000) / 1000,
      maxIndex: Math.round(Math.max(...results.map((r) => r.riskIndex)) * 1000) / 1000,
      meanUncertainty: Math.round(mean(results.map((r) => r.uncertainty)) * 100) / 100,
    },
    coverage: {
      segmentCoverageRatio: segments.length ? results.filter((r) => r.accidentCount! > 0).length / segments.length : 0,
      trafficCoverageRatio: segments.length ? coveredTraffic / segments.length : 0,
      positionalAccuracyMedian: quantile(accs, 0.5),
      verifiedRatio: accidents.length ? accidents.filter((a) => a.status === "verified").length / accidents.length : 0,
      temporalSpanDays: times.length ? (Math.max(...times) - Math.min(...times)) / 86400000 : 0,
      caveats: [
        "The index is a relative ranking within this dataset. It is not a calibrated accident probability and must not be read as one.",
        "Traffic exposure is modelled synthetically; real deployments must substitute observed counts before exposure-aware interpretation.",
        "Crowdsourced reports under-count low-severity events. Absolute frequencies are lower bounds.",
        "No independent validation against held-out crash data has been performed, so no predictive accuracy is claimed.",
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Mode -> styled layer
// ---------------------------------------------------------------------------

export function buildLayer(
  mode: "points" | "clusters" | "kde" | "hotspot" | "segments" | "risk",
  params: LayerParams,
  accidents: Accident[],
  segments: RoadSegment[],
  traffic: Map<number, { aadt: number | null; coverageRatio: number; volume: number }>,
  riskParams: RiskParams,
): MapLayerPayload {
  const pts = toPoints(accidents);

  if (mode === "points") {
    const stops: LegendStop[] = SEVERITIES.map((s) => ({
      value: s.rank,
      colour: s.colour,
      label: s.label,
    }));
    return {
      kind: "points",
      data: null,
      legend: {
        title: "Reported accident severity",
        unit: "class",
        stops,
        ramp: "categorical",
        note: "Opacity encodes verification status: solid = verified, dimmed = pending.",
      },
      method: {
        name: "Individual report locations",
        formula: "point(lon, lat) — no aggregation applied",
        explanation:
          "Every accepted report is plotted at its validated coordinate. Reported coordinates are preserved separately from the snapped geometry so positional error stays auditable.",
        caveat:
          "Points show reported events only. Unreported or unrecorded collisions are invisible here.",
        params: `n = ${accidents.length} records`,
      },
    };
  }

  if (mode === "clusters") {
    return {
      kind: "clusters",
      data: null,
      legend: {
        title: "Report aggregation cells",
        unit: "reports / cell",
        stops: [
          { value: 1, colour: "rgba(242,160,61,0.16)", label: "1" },
          { value: 20, colour: "rgba(242,160,61,0.16)", label: "20" },
          { value: 100, colour: "rgba(242,160,61,0.16)", label: "100+" },
        ],
        ramp: "sequential",
        note: "Radius is proportional to the number of reports in each cell; the printed figure is the exact count.",
      },
      method: {
        name: "Point clustering (equal-area cells)",
        formula: "count(p ∈ cell), cell ≈ 330 m",
        explanation:
          "Reports are aggregated into fixed metric cells so dense areas stay legible at small scales. Clicking a cluster zooms in until individual reports resolve.",
        caveat:
          "Clustering is a cartographic device. It does not test whether the observed concentration differs from randomness.",
        params: `cell ≈ 330 m · ${accidents.length} records`,
      },
    };
  }

  if (mode === "kde") {
    const res = kernelDensity(pts, {
      bandwidthM: params.bandwidthM,
      cellSizeM: params.cellSizeM,
      weighting: params.weighting,
      normalisation: "density",
    });
    const values = res.grid.cells.map((c) => c.value);
    const max = Math.max(...values);
    const stops = rampStops(0, max, AMBER_RAMP, "per km²", (v) => v.toFixed(1));
    const data = gridPolygons(
      res.grid.cells.map((c) => ({
        ...c,
        fill: colourAt(c.value, stops),
        opacity: c.value <= 0 ? 0 : 0.22 + 0.62 * Math.min(1, c.value / (max || 1)),
      })),
      res.grid.cellSizeM,
      res.grid.minLon,
      res.grid.minLat,
      (c) => ({ densityPerKm2: c.value }),
    );
    return {
      kind: "kde",
      data,
      legend: {
        title: "Kernel density estimate",
        unit: "events · km⁻²",
        stops,
        ramp: "sequential",
        note: "Gaussian kernel, fixed bandwidth. Values are estimated intensity, not observed counts.",
      },
      method: {
        name: "Kernel Density Estimation",
        formula: "f̂(s) = Σ K(‖s − sᵢ‖ / h) · wᵢ   with K Gaussian, σ = h",
        explanation:
          "Each event is spread over a Gaussian surface of bandwidth h and the surfaces are summed on a regular metric lattice. Larger bandwidths reveal regional tendency; smaller bandwidths reveal local structure.",
        caveat:
          "KDE is descriptive. A bright cell means many reports nearby — it does not establish statistical significance.",
        params: `h = ${params.bandwidthM} m · cell = ${params.cellSizeM} m · weight = ${params.weighting} · n = ${pts.length}`,
      },
      statistics: res.statistics,
    };
  }

  if (mode === "hotspot") {
    const res = giStar(pts, {
      bandM: params.bandM,
      cellSizeM: params.cellSizeM,
      fdr: params.fdr,
      valueSource: params.weighting === "severity" ? "severity_weighted" : "count",
    });
    const zs = res.grid.cells.map((c) => c.zScore ?? 0);
    const zMax = Math.max(2.2, ...zs.map(Math.abs));
    const stops = rampStops(-zMax, zMax, DIVERGING, "z", (v) => v.toFixed(1));
    const data = gridPolygons(
      res.grid.cells.map((c) => {
        const sig = c.significant ?? false;
        return {
          ...c,
          fill: sig ? colourAt(c.zScore ?? 0, stops) : "#232b31",
          opacity: sig ? 0.82 : 0.28,
          stroke: sig ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.02)",
        };
      }),
      res.grid.cellSizeM,
      res.grid.minLon,
      res.grid.minLat,
      (c) => ({
        zScore: c.zScore,
        pValue: c.pValue,
        significant: c.significant,
      }),
    );
    return {
      kind: "hotspot",
      data,
      legend: {
        title: "Getis-Ord Gi* z-score",
        unit: "z",
        stops,
        ramp: "diverging",
        note: "Cyan = statistically significant cold spot · amber = significant hotspot · grey cells are not significant at the chosen correction.",
      },
      method: {
        name: "Getis-Ord Gi* hotspot analysis",
        formula: "Gi* = [Σ wᵢⱼxⱼ − X̄ Σ wᵢⱼ] / S · √([n Σ wᵢⱼ² − (Σ wᵢⱼ)²] / (n−1))",
        explanation:
          "Each cell is compared with its neighbours inside the distance band. The resulting z-score is converted to a two-sided p-value; " +
          (params.fdr
            ? "Benjamini–Hochberg false-discovery-rate correction is applied across all cells."
            : "no multiple-testing correction is applied."),
        caveat:
          "Gi* assumes stationarity and a meaningful distance band. With clustered event data the normal approximation can be optimistic — treat borderline cells with caution.",
        params: `band = ${params.bandM} m · cell = ${params.cellSizeM} m · FDR = ${params.fdr ? "on" : "off"} · value = ${params.weighting}`,
      },
      statistics: {
        ...res.statistics,
        significantShare: res.grid.cells.length
          ? res.grid.cells.filter((c) => c.significant).length / res.grid.cells.length
          : 0,
      },
    };
  }

  if (mode === "segments") {
    const agg = aggregateBySegment(accidents, segments);
    const counts = segments.map((s) => agg.get(s.id)?.count ?? 0);
    const max = Math.max(1, ...counts);
    const stops = rampStops(0, max, AMBER_RAMP, "events", (v) => v.toFixed(0));
    const features = segments.map((s): GeoJsonFeature => {
      const rec = agg.get(s.id);
      const count = rec?.count ?? 0;
      return {
        type: "Feature",
        id: s.id,
        geometry: { type: "LineString", coordinates: s.coordinates },
        properties: {
          segmentCode: s.segmentCode,
          streetName: s.streetName,
          count,
          severityWeighted: rec?.severityWeighted ?? 0,
          densityPerKm: rec?.densityPerKm ?? 0,
          lineColor: colourAt(count, stops),
          width: 0.8 + 5.2 * Math.min(1, count / (max || 1)),
          opacity: count === 0 ? 0.16 : 0.92,
        },
      };
    });
    return {
      kind: "segments",
      data: { type: "FeatureCollection", features },
      legend: {
        title: "Accidents per road segment",
        unit: "events / segment",
        stops,
        ramp: "sequential",
        note: "Line width and colour both encode the event count. Segments with no snapped reports are drawn faint.",
      },
      method: {
        name: "Road-segment aggregation",
        formula: "C(seg) = Σ 1[accident snapped to seg], snap radius 120 m",
        explanation:
          "Reports are assigned to the nearest road segment by perpendicular distance in the metric frame, then counted. Length-normalised density is reported alongside raw counts so long segments are not automatically ranked higher.",
        caveat:
          "Segments with low traffic exposure can appear safe simply because few vehicles use them.",
        params: `segments = ${segments.length} · events assigned = ${accidents.filter((a) => a.roadSegmentId != null).length}`,
      },
      statistics: {
        segmentsWithEvents: counts.filter((c) => c > 0).length,
        maxCount: max,
        meanCount: mean(counts),
      },
    };
  }

  // risk
  const risk = computeRisk(accidents, segments, traffic, riskParams);
  const idx = risk.segments.map((s) => s.riskIndex);
  const maxI = Math.max(...idx, 0.001);
  const stops = rampStops(0, maxI, AMBER_RAMP, "index", (v) => v.toFixed(2));
  const features = risk.segments.map((s): GeoJsonFeature => ({
    type: "Feature",
    id: s.id,
    geometry: { type: "LineString", coordinates: s.coordinates },
    properties: {
      segmentCode: s.segmentCode,
      streetName: s.streetName,
      riskIndex: s.riskIndex,
      accidentCount: s.accidentCount,
      severityWeightedIndex: s.severityWeightedIndex,
      uncertainty: s.uncertainty,
      exposureCoverage: s.exposureCoverage,
      lineColor: colourAt(s.riskIndex, stops),
      width: 0.8 + 5.4 * Math.min(1, s.riskIndex / (maxI || 1)),
      opacity: s.riskIndex < 0.02 ? 0.2 : 0.95,
    },
  }));
  return {
    kind: "risk",
    data: { type: "FeatureCollection", features },
    legend: {
      title: "Relative risk index (weighted composite)",
      unit: "0 – 1, dataset-relative",
      stops,
      ramp: "sequential",
      note: "This is a weighted composite index relative to the current dataset. It is NOT a calibrated probability of accident occurrence.",
    },
    method: {
      name: "Configurable weighted composite risk index",
      formula: "R(seg) = Σ wᵢ · x̂ᵢ(seg) / Σ wᵢ   with x̂ᵢ min–max normalised",
      explanation:
          "Each factor is normalised to 0–1 across the network, multiplied by its configured weight and averaged. Every factor is individually inspectable, so the ranking can be audited and reproduced by hand.",
      caveat:
        "A weighted index is a relative ordering, not a modelled probability and not evidence of causation. Weights encode judgement, not estimation.",
      params: risk.factors.map((f) => `${f.key}=${f.weight.toFixed(2)}`).join(" · "),
    },
    statistics: risk.statistics,
  };
}

export function riskPayload(
  accidents: Accident[],
  segments: RoadSegment[],
  traffic: Map<number, { aadt: number | null; coverageRatio: number; volume: number }>,
  params: RiskParams,
) {
  return computeRisk(accidents, segments, traffic, params);
}
