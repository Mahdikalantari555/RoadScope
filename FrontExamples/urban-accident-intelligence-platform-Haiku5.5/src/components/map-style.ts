/**
 * Map styling: basemaps (offline vector background by default; raster basemaps are optional
 * and online), analytical colour ramps, and legend definitions for each analytical layer.
 */
import type { StyleSpecification } from "maplibre-gl";
import type { GeoFeatureCollection } from "@/lib/domain";
import { SEVERITY_META, type AnalysisType } from "@/lib/domain";

export type BasemapId = "dark" | "light" | "carto-dark" | "osm";

export const BASEMAPS: { id: BasemapId; label: string; online: boolean }[] = [
  { id: "dark", label: "Neutral dark (offline)", online: false },
  { id: "light", label: "Neutral light (offline)", online: false },
  { id: "carto-dark", label: "CARTO dark (online)", online: true },
  { id: "osm", label: "OpenStreetMap (online)", online: true },
];

export function buildBasemapStyle(id: BasemapId): StyleSpecification {
  if (id === "carto-dark" || id === "osm") {
    const tiles = id === "carto-dark" ? ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"] : ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];
    const attribution = id === "carto-dark" ? "© OpenStreetMap contributors © CARTO" : "© OpenStreetMap contributors";
    return {
      version: 8,
      sources: { base: { type: "raster", tiles, tileSize: 256, attribution, maxzoom: 19 } },
      layers: [{ id: "base", type: "raster", source: "base" }],
    };
  }
  const background = id === "light" ? "#e9edf2" : "#0a0e14";
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": background } }],
  };
}

const RAMP = ["#1e1b4b", "#312e81", "#1d4ed8", "#0891b2", "#10b981", "#facc15", "#f97316", "#dc2626"];

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Sequential colour ramp for normalised values in [0, 1]. */
export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (RAMP.length - 1);
  const lo = Math.floor(x);
  const hi = Math.min(RAMP.length - 1, lo + 1);
  const f = x - lo;
  const a = hexToRgb(RAMP[lo]!);
  const b = hexToRgb(RAMP[hi]!);
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export const RAMP_GRADIENT = `linear-gradient(90deg, ${RAMP.join(",")})`;

export const GI_COLORS: Record<string, string> = {
  hot99: "#b91c1c",
  hot95: "#ef4444",
  hot90: "#fb923c",
  ns: "#334155",
  cold90: "#7dd3fc",
  cold95: "#38bdf8",
  cold99: "#0284c7",
  not_evaluated: "#475569",
};

export const GI_LABELS: Record<string, string> = {
  hot99: "Hotspot · 99%",
  hot95: "Hotspot · 95%",
  hot90: "Hotspot · 90%",
  ns: "Not significant",
  cold90: "Coldspot · 90%",
  cold95: "Coldspot · 95%",
  cold99: "Coldspot · 99%",
  not_evaluated: "Not evaluated",
};

const CLUSTER_PALETTE = ["#22d3ee", "#a78bfa", "#f472b6", "#facc15", "#34d399", "#fb7185", "#60a5fa", "#f97316", "#c084fc", "#2dd4bf"];

export function severityColorExpression(): unknown[] {
  return [
    "match",
    ["get", "severityId"],
    1,
    SEVERITY_META[1].colorHex,
    2,
    SEVERITY_META[2].colorHex,
    3,
    SEVERITY_META[3].colorHex,
    4,
    SEVERITY_META[4].colorHex,
    "#94a3b8",
  ];
}

type Props = Record<string, unknown>;

/** Adds render properties (colour, width, opacity) to analysis features, without mutating input. */
export function decorateAnalysis(kind: AnalysisType | null, fc: GeoFeatureCollection | null): GeoFeatureCollection | null {
  if (!fc || !kind) return fc;
  const values = fc.features.map((f) => Number((f.properties as Props).value ?? (f.properties as Props).count ?? 0)).filter((v) => Number.isFinite(v));
  const max = values.length ? Math.max(...values) : 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rankOf = (v: number) => {
    if (sorted.length <= 1) return 1;
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / (sorted.length - 1);
  };
  const features = fc.features.map((f) => {
    const p = f.properties as Props;
    let color = "#94a3b8";
    let opacity = 0.6;
    let width = 2;
    switch (kind) {
      case "kde": {
        const v = Number(p.value ?? 0);
        color = rampColor(max > 0 ? Math.sqrt(v / max) : 0);
        opacity = 0.2 + 0.6 * (max > 0 ? Math.sqrt(v / max) : 0);
        break;
      }
      case "gistar": {
        color = GI_COLORS[String(p.class)] ?? GI_COLORS.not_evaluated!;
        opacity = p.class === "ns" || p.class === "not_evaluated" ? 0.1 : 0.72;
        break;
      }
      case "dbscan": {
        color = CLUSTER_PALETTE[(Number(p.clusterId) - 1) % CLUSTER_PALETTE.length]!;
        opacity = 0.22;
        break;
      }
      case "segment_aggregation":
      case "spatial_comparison": {
        const t = rankOf(Number(p.value ?? 0));
        color = rampColor(t);
        width = 2 + 4 * t;
        opacity = 0.95;
        break;
      }
      case "risk": {
        const s = Number(p.score ?? 0) / 100;
        color = rampColor(s);
        width = 2 + 4.5 * s;
        opacity = 0.95;
        break;
      }
    }
    return { ...f, properties: { ...p, color, opacity, width } };
  });
  return { type: "FeatureCollection", features };
}

export interface LegendItem {
  color: string;
  label: string;
}

export interface LegendSpec {
  title: string;
  note?: string;
  items?: LegendItem[];
  gradient?: { from: string; to: string; caption: string };
}

export function legendFor(kind: AnalysisType | "points" | "clusters" | "heatmap", summary?: Record<string, unknown>): LegendSpec {
  switch (kind) {
    case "points":
    case "clusters":
      return {
        title: "Recorded incidents by severity",
        note: "Hollow markers are pending citizen reports. Only verified records appear unless administrators include pending records.",
        items: ([1, 2, 3, 4] as const).map((id) => ({ color: SEVERITY_META[id].colorHex, label: SEVERITY_META[id].label })),
      };
    case "heatmap":
      return {
        title: "Incident heatmap",
        note: "Kernel-rendered intensity of recorded incidents, weighted by severity. Relative visual density only.",
        gradient: { from: "transparent", to: "#fef3c7", caption: "Low → high intensity" },
      };
    case "kde":
      return {
        title: "Kernel density (events per km²)",
        note: `Bandwidth ${summary?.bandwidthM ?? "—"} m · ${summary?.kernel ?? "quartic"} kernel. Recorded incidents, not exposure-normalised.`,
        gradient: { from: "#1e1b4b", to: "#dc2626", caption: `0 → ${summary?.maxDensityPerKm2 ?? "max"} per km²` },
      };
    case "gistar":
      return {
        title: "Getis-Ord Gi* classes",
        note: "Only FDR-adjusted significant cells are classed as hot or cold. Grey cells are not significant.",
        items: ["hot99", "hot95", "hot90", "ns", "cold90", "cold95", "cold99"].map((c) => ({ color: GI_COLORS[c]!, label: GI_LABELS[c]! })),
      };
    case "dbscan":
      return {
        title: "DBSCAN clusters",
        note: "Convex hulls of density-connected incidents. Colours distinguish clusters; they carry no ordinal meaning.",
        items: [
          { color: CLUSTER_PALETTE[0]!, label: "Cluster 1" },
          { color: CLUSTER_PALETTE[1]!, label: "Cluster 2" },
          { color: CLUSTER_PALETTE[2]!, label: "Cluster 3" },
          { color: "#94a3b8", label: "Other clusters (cycled palette)" },
        ],
      };
    case "segment_aggregation":
      return {
        title: "Incidents per km of road",
        note: "Line colour and width encode the rank of incidents per kilometre among segments.",
        gradient: { from: "#1e1b4b", to: "#dc2626", caption: "Lower → higher rank" },
      };
    case "spatial_comparison":
      return {
        title: "Incidents per km (rank)",
        note: "Association analysis: correlations and rates are shown in the results panel.",
        gradient: { from: "#1e1b4b", to: "#dc2626", caption: "Lower → higher rank" },
      };
    case "risk":
      return {
        title: "Relative risk index (0–100)",
        note: "Relative ranking aid. Not a probability of collision. Not validated against independent outcomes.",
        gradient: { from: "#1e1b4b", to: "#dc2626", caption: "0 → 100 (weighted, normalised)" },
      };
  }
}
