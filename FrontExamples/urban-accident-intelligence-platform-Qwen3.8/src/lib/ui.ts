"use client";

import type { MapLayerSpec } from "@/components/MapCanvas";
import type { GeoCollection } from "@/lib/clientApi";
import { RAMPS, ROAD_CLASS_COLORS, SEVERITY_COLORS, colorFor, normalizeWithBreaks, classBreaks } from "@/lib/util/colors";

export const SEVERITY_ORDER = ["fatal", "serious_injury", "minor_injury", "property_damage", "near_miss"];
export const SEVERITY_LABELS: Record<string, string> = {
  fatal: "Fatal (K)",
  serious_injury: "Serious injury (A)",
  minor_injury: "Minor injury (B/C)",
  property_damage: "Property damage only",
  near_miss: "Near miss / conflict",
};
export const CLASS_LABELS: Record<string, string> = {
  motorway: "Motorway",
  primary: "Primary arterial",
  secondary: "Secondary arterial",
  tertiary: "Tertiary collector",
  residential: "Residential",
  service: "Service / access",
};
export const SIGNIFICANCE_COLORS: Record<string, string> = {
  hotspot_p01: "#d81b60",
  hotspot_p05: "#fb8c00",
  not_significant: "#5a6a80",
  coldspot_p05: "#42a5f5",
  coldspot_p01: "#1565c0",
};

export function severityColor(code: string | null | undefined): string {
  return SEVERITY_COLORS[code ?? ""] ?? "#8fa3bd";
}

export function classColor(code: string | null | undefined): string {
  return ROAD_CLASS_COLORS[code ?? ""] ?? "#8fa3bd";
}

/** Road network base layer, styled by functional class or exposure gap. */
export function networkLayer(data: GeoCollection | null | undefined, mode: "class" | "exposure" | "plain" = "class", dim = 0.5): MapLayerSpec {
  return {
    id: "network",
    label: "Road network",
    data,
    visible: true,
    zIndex: 1,
    opacity: dim,
    stroke: (p) => {
      if (mode === "plain") return "#4a5a72";
      if (mode === "exposure") return p.hasExposure ? "#3d6f8e" : "#a05a2c";
      return classColor(p.roadClass);
    },
    width: (p, scale) => {
      const base = p.roadClass === "motorway" ? 2.6 : p.roadClass === "primary" ? 1.9 : p.roadClass === "secondary" ? 1.5 : p.roadClass === "tertiary" ? 1.1 : 0.75;
      return Math.max(0.4, base * Math.min(2.4, Math.max(0.55, Math.log2(Math.max(1.2, scale)) / 4)));
    },
    pickable: true,
  };
}

export function lixelChoroplethLayer(
  data: GeoCollection | null | undefined,
  opts: { valueKey: string; ramp: string; width?: number; opacity?: number; breaks?: number[]; zIndex?: number; id?: string; label?: string; logScale?: boolean },
): MapLayerSpec {
  const values = (data?.features ?? []).map((f) => Number(f.properties?.[opts.valueKey] ?? 0)).filter((v) => Number.isFinite(v));
  const transformed = opts.logScale ? values.map((v) => Math.log10(Math.max(1e-9, v))) : values;
  const breaks = opts.breaks ?? classBreaks(transformed.filter((v) => v > (opts.logScale ? -9 : -Infinity)), 6, "quantile");
  const lo = breaks[0];
  const hi = breaks[breaks.length - 1];
  return {
    id: opts.id ?? `choropleth:${opts.valueKey}`,
    label: opts.label ?? opts.valueKey,
    data,
    visible: true,
    zIndex: opts.zIndex ?? 5,
    opacity: opts.opacity ?? 0.92,
    stroke: (p) => {
      const raw = Number(p?.[opts.valueKey] ?? 0);
      const v = opts.logScale ? Math.log10(Math.max(1e-9, raw)) : raw;
      const t = normalizeWithBreaks(v, [lo, hi]);
      return colorFor(opts.ramp, t);
    },
    width: (p, scale) => {
      const raw = Number(p?.[opts.valueKey] ?? 0);
      const v = opts.logScale ? Math.log10(Math.max(1e-9, raw)) : raw;
      const t = normalizeWithBreaks(v, [lo, hi]);
      return Math.max(opts.width ?? 2, (opts.width ?? 2) + t * 3.4 * Math.min(1.6, Math.max(0.6, Math.log2(Math.max(1.2, scale)) / 4.5)));
    },
    pickable: true,
  };
}

export function incidentPointLayer(data: GeoCollection | null | undefined, opts: { clusterRadiusPx?: number; zIndex?: number; opacity?: number; id?: string } = {}): MapLayerSpec {
  return {
    id: opts.id ?? "incidents",
    label: "Incidents",
    data,
    visible: true,
    zIndex: opts.zIndex ?? 12,
    opacity: opts.opacity ?? 0.95,
    clusterRadiusPx: opts.clusterRadiusPx,
    stroke: (p) => severityColor(p.severityCode),
    fill: (p) => severityColor(p.severityCode),
    radius: (p) => (p.severityRank >= 4 ? 5 : p.severityRank === 3 ? 3.8 : 2.9),
    width: () => 0.7,
    pickable: true,
  };
}

export function polygonLayer(data: GeoCollection | null | undefined, opts: { color: (p: any) => string; fill: (p: any) => string | null; id: string; zIndex?: number; width?: number }): MapLayerSpec {
  return {
    id: opts.id,
    data,
    visible: true,
    zIndex: opts.zIndex ?? 9,
    stroke: opts.color,
    fill: opts.fill,
    width: () => opts.width ?? 1.4,
    pickable: true,
  };
}

export function rampOptions(): Array<{ value: string; label: string }> {
  return Object.keys(RAMPS).map((k) => ({ value: k, label: k }));
}

export { colorFor, classBreaks, normalizeWithBreaks, RAMPS };
