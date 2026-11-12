/** Map layer definitions + legends for every explorer mode (kept separate from React UI). */
import type { ExpressionSpecification, Map as MLMap } from "maplibre-gl";
import { removeLayers, upsertSource, type GeoJSONData } from "../map/MapView";

export type Mode = "points" | "clusters" | "heatmap" | "kde" | "hotspot" | "segments" | "risk";

export const SEVERITY_COLOR: ExpressionSpecification = ["match", ["get", "severity"], "fatal", "#e11d48", "serious", "#f97316", "slight", "#eab308", "#8b9bb0"];
export const GI_COLORS: Record<string, string> = { hot99: "#d7301f", hot95: "#fc8d59", hot90: "#fdcc8a", ns: "#6b7483", cold90: "#c6dbef", cold95: "#6baed6", cold99: "#2171b5" };
export const KDE_RAMP: [number, string][] = [
  [0, "#3b0f70"],
  [0.15, "#641a80"],
  [0.3, "#8c2981"],
  [0.45, "#de4968"],
  [0.65, "#fe9f6d"],
  [1, "#fcfdbf"],
];
export const SEG_COLORS = ["#2a9d8f", "#8ab17d", "#e9c46a", "#f4a261", "#e76f51"];
export const RISK_RAMP: [number, string][] = [
  [0, "#1a9850"],
  [40, "#a6d96a"],
  [60, "#fee08b"],
  [75, "#fc8d59"],
  [90, "#d73027"],
];

export const ALL_LAYERS = ["acc-points", "acc-pending", "acc-heat", "cl-circles", "cl-count", "cl-single", "kde-fill", "gi-fill", "gi-line", "seg-zero", "seg-line", "risk-line", "risk-low", "sel-line", "sel-point", "overlay-points"];

export const MODE_INFO: Record<Mode, { title: string; short: string; body: string[]; statistical: boolean }> = {
  points: {
    title: "Individual incidents",
    short: "Each symbol is one report at its validated (network-snapped) location.",
    body: ["Filled circles: verified incidents. Hollow circles: unverified citizen reports.", "Colour encodes severity. Positions are snapped to the nearest road segment (≤ 60 m); original coordinates are preserved separately."],
    statistical: false,
  },
  clusters: {
    title: "Clustered distribution",
    short: "Screen-space aggregation for readability at small scales.",
    body: ["Clusters merge nearby points within ~45 px on screen. Cluster sizes depend on zoom level and are a cartographic generalisation, not a spatial-statistical cluster.", "Ring colour reflects the share of fatal + serious incidents."],
    statistical: false,
  },
  heatmap: {
    title: "Visual heatmap",
    short: "Screen-space density rendering (zoom-dependent).",
    body: ["Rendered by the map client with a pixel-based kernel; intensity is unitless and changes with zoom. Use KDE for a reproducible density surface in events/km²."],
    statistical: false,
  },
  kde: {
    title: "Kernel Density Estimation",
    short: "Planar quartic KDE in EPSG:32633; unit: events per km².",
    body: [
      "Bandwidth from a spatial Silverman rule unless set in the Analysis Lab. Describes concentration only — high density does not imply statistical significance or elevated risk.",
      "Planar KDE ignores network topology and spreads density off-road; network-constrained KDE is a planned extension.",
    ],
    statistical: false,
  },
  hotspot: {
    title: "Getis-Ord Gi* hotspots",
    short: "Local spatial autocorrelation on a 200 m lattice, 500 m distance band, FDR-corrected.",
    body: [
      "Cells are classified by FDR-adjusted significance (Benjamini–Hochberg). Hot spots indicate locations where high counts are surrounded by high counts more than expected under spatial randomness.",
      "The analysis is only executed when pre-conditions hold (≥ 30 units, ≥ 30 events, every unit has neighbours); otherwise it is refused.",
    ],
    statistical: true,
  },
  segments: {
    title: "Road-segment aggregation",
    short: "Verified incidents per km per year on each segment (nearest-segment assignment).",
    body: ["Classes are quintiles of non-zero segments. Short segments with few events produce unstable densities — inspect the 95% Poisson interval in the inspector before drawing conclusions."],
    statistical: false,
  },
  risk: {
    title: "Relative risk index",
    short: "Configurable composite (0–100) of EB frequency, severity, exposure, road and environment indicators.",
    body: [
      "Ordinal and uncalibrated: not an accident probability. Dashed segments have low reliability (n < 3, i.e. 95% Poisson CI wider than 3× the count).",
      "Adjust weights and inspect rank uncertainty in the Risk workspace.",
    ],
    statistical: false,
  },
};

export function clearModeLayers(map: MLMap) {
  removeLayers(map, ALL_LAYERS.filter((l) => !l.startsWith("sel-")));
}

export function drawPoints(map: MLMap, data: GeoJSONData) {
  upsertSource(map, "acc", data);
  map.addLayer({
    id: "acc-points",
    type: "circle",
    source: "acc",
    filter: ["!=", ["get", "status"], "reported"],
    paint: {
      "circle-color": SEVERITY_COLOR,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["match", ["get", "severity"], "fatal", 3.5, "serious", 3, 2], 16, ["match", ["get", "severity"], "fatal", 8, "serious", 7, 5.5]],
      "circle-opacity": 0.85,
      "circle-stroke-width": 0.6,
      "circle-stroke-color": "rgba(0,0,0,0.45)",
    },
  });
  map.addLayer({
    id: "acc-pending",
    type: "circle",
    source: "acc",
    filter: ["==", ["get", "status"], "reported"],
    paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 6], "circle-stroke-width": 1.4, "circle-stroke-color": SEVERITY_COLOR },
  });
}

export function drawClusters(map: MLMap, data: GeoJSONData) {
  upsertSource(map, "acc-cl", data, { cluster: true, clusterRadius: 45, clusterMaxZoom: 16, clusterProperties: { fs: ["+", ["case", ["in", ["get", "severity"], ["literal", ["fatal", "serious"]]], 1, 0]] } });
  map.addLayer({
    id: "cl-circles",
    type: "circle",
    source: "acc-cl",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "rgba(79,209,197,0.18)",
      "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 10, 50, 18, 300, 30, 1500, 42],
      "circle-stroke-width": 2,
      "circle-stroke-color": ["interpolate", ["linear"], ["/", ["get", "fs"], ["get", "point_count"]], 0, "#4fd1c5", 0.1, "#eab308", 0.2, "#f97316", 0.35, "#e11d48"],
    },
  });
  map.addLayer({ id: "cl-count", type: "symbol", source: "acc-cl", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Open Sans Regular"], "text-size": 11 }, paint: { "text-color": "#e6e9ee" } });
  map.addLayer({ id: "cl-single", type: "circle", source: "acc-cl", filter: ["!", ["has", "point_count"]], paint: { "circle-color": SEVERITY_COLOR, "circle-radius": 4, "circle-stroke-width": 0.6, "circle-stroke-color": "#000" } });
}

export function drawHeatmap(map: MLMap, data: GeoJSONData) {
  upsertSource(map, "acc", data);
  map.addLayer({
    id: "acc-heat",
    type: "heatmap",
    source: "acc",
    paint: {
      "heatmap-weight": ["match", ["get", "severity"], "fatal", 1, "serious", 0.8, "slight", 0.5, 0.35],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 30],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 1.6],
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.15, "#3b0f70", 0.35, "#8c2981", 0.55, "#de4968", 0.8, "#fe9f6d", 1, "#fcfdbf"],
      "heatmap-opacity": 0.85,
    },
  });
}

export function drawKde(map: MLMap, data: GeoJSONData) {
  upsertSource(map, "kde", data);
  map.addLayer({
    id: "kde-fill",
    type: "fill",
    source: "kde",
    paint: { "fill-color": ["interpolate", ["linear"], ["get", "rel"], ...KDE_RAMP.flat()] as unknown as ExpressionSpecification, "fill-opacity": ["interpolate", ["linear"], ["get", "rel"], 0, 0.15, 0.2, 0.55, 1, 0.85] },
  });
}

export function drawHotspots(map: MLMap, data: GeoJSONData) {
  upsertSource(map, "gi", data);
  const color = ["match", ["get", "cls"], ...Object.entries(GI_COLORS).flat(), "#6b7483"] as unknown as ExpressionSpecification;
  map.addLayer({ id: "gi-fill", type: "fill", source: "gi", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": ["match", ["get", "cls"], "ns", 0.06, 0.62] } });
  map.addLayer({ id: "gi-line", type: "line", source: "gi", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": color, "line-width": ["match", ["get", "cls"], "ns", 1, 4] } });
}

export function quantileBreaks(values: number[], k = 5): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i < k; i++) out.push(v[Math.min(v.length - 1, Math.floor((i / k) * v.length))]);
  return [...new Set(out)];
}

export function drawSegments(map: MLMap, data: GeoJSON.FeatureCollection, breaks: number[]) {
  upsertSource(map, "seg", data);
  const step: unknown[] = ["step", ["get", "densityKmYr"], SEG_COLORS[0]];
  breaks.forEach((b, i) => step.push(b, SEG_COLORS[Math.min(SEG_COLORS.length - 1, i + 1)]));
  map.addLayer({ id: "seg-zero", type: "line", source: "seg", filter: ["==", ["get", "n"], 0], paint: { "line-color": "#6b7483", "line-opacity": 0.35, "line-width": 1 } });
  map.addLayer({
    id: "seg-line",
    type: "line",
    source: "seg",
    filter: [">", ["get", "n"], 0],
    layout: { "line-cap": "round" },
    paint: { "line-color": step as unknown as ExpressionSpecification, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 17, 9] },
  });
}

export function drawRisk(map: MLMap, data: GeoJSON.FeatureCollection) {
  upsertSource(map, "risk", data);
  const color = ["interpolate", ["linear"], ["get", "index"], ...RISK_RAMP.flat()] as unknown as ExpressionSpecification;
  const width: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, ["interpolate", ["linear"], ["get", "index"], 0, 1, 100, 4], 17, ["interpolate", ["linear"], ["get", "index"], 0, 3, 100, 11]];
  map.addLayer({ id: "risk-line", type: "line", source: "risk", filter: ["!=", ["get", "reliability"], "low"], layout: { "line-cap": "round" }, paint: { "line-color": color, "line-width": width } });
  map.addLayer({ id: "risk-low", type: "line", source: "risk", filter: ["==", ["get", "reliability"], "low"], paint: { "line-color": color, "line-width": width, "line-dasharray": [1.2, 1.2], "line-opacity": 0.75 } });
}

export function drawOverlayPoints(map: MLMap, data: GeoJSONData) {
  upsertSource(map, "acc", data);
  map.addLayer({ id: "overlay-points", type: "circle", source: "acc", paint: { "circle-color": "#e6e9ee", "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1, 17, 3.5], "circle-opacity": 0.55 } });
}

export function drawSelection(map: MLMap, data: GeoJSON.FeatureCollection) {
  upsertSource(map, "sel", data);
  if (!map.getLayer("sel-line")) map.addLayer({ id: "sel-line", type: "line", source: "sel", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#4fd1c5", "line-width": 3, "line-dasharray": [2, 1] } });
  if (!map.getLayer("sel-point")) map.addLayer({ id: "sel-point", type: "circle", source: "sel", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#4fd1c5", "circle-stroke-width": 2.5 } });
  ["sel-line", "sel-point"].forEach((l) => map.moveLayer(l));
}
