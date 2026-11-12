"use client";

/**
 * Shared console state: filters, theme, map mode, selection.
 * Filter state is mirrored into the URL query string so analytical views
 * stay linkable and cross-filtering is reproducible.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  Accident,
  CategoryCode,
  GeoJsonFeatureCollection,
  ReportStatus,
  RoadSegment,
  SeverityCode,
} from "@/lib/types";

export type MapMode = "points" | "clusters" | "kde" | "hotspot" | "segments" | "risk";
export type Basemap = "plate" | "light" | "blueprint";

export interface LegendStop {
  value: number;
  colour: string;
  label: string;
}

export interface MapLayerPayload {
  kind: MapMode;
  data: GeoJsonFeatureCollection | null;
  legend: { title: string; unit: string; stops: LegendStop[]; note?: string; ramp: "sequential" | "diverging" | "categorical" };
  method: { name: string; formula: string; explanation: string; caveat: string; params: string };
  statistics?: Record<string, number>;
  loading?: boolean;
}

export interface Filters {
  from: string;
  to: string;
  categories: CategoryCode[];
  severities: SeverityCode[];
  statuses: ReportStatus[];
  hours: [number, number];
  days: number[];
  text: string;
}

export const DEFAULT_FILTERS: Filters = {
  from: "2024-01-01",
  to: "2025-03-01",
  categories: [],
  severities: [],
  statuses: ["verified", "pending"],
  hours: [0, 23],
  days: [0, 1, 2, 3, 4, 5, 6],
  text: "",
};

export interface TrafficEntry {
  segmentId: number;
  aadt: number | null;
  coverageRatio: number;
  volume: number;
}

interface AppState {
  accidents: Accident[];
  segments: RoadSegment[];
  trafficMap: Map<number, TrafficEntry>;
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  resetFilters: () => void;
  filtered: Accident[];
  theme: "dark" | "light";
  toggleTheme: () => void;
  basemap: Basemap;
  setBasemap: (b: Basemap) => void;
  mapMode: MapMode;
  setMapMode: (m: MapMode) => void;
  layer: MapLayerPayload | null;
  setLayer: (l: MapLayerPayload | null) => void;
  selection: { kind: "accident" | "segment"; id: number } | null;
  setSelection: (s: AppState["selection"]) => void;
  highlight: { lon: number; lat: number; label: string } | null;
  setHighlight: (h: AppState["highlight"]) => void;
  cursor: { lon: number; lat: number; zoom: number } | null;
  setCursor: (c: AppState["cursor"]) => void;
  activeView: ViewKey;
  setActiveView: (v: ViewKey) => void;
  role: "administrator" | "contributor";
  setRole: (r: "administrator" | "contributor") => void;
}

export type ViewKey = "explorer" | "report" | "analytics" | "lab" | "risk" | "admin";

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppStateProvider");
  return ctx;
}

export function AppStateProvider({
  accidents,
  segments,
  traffic,
  children,
}: {
  accidents: Accident[];
  segments: RoadSegment[];
  traffic: TrafficEntry[];
  children: React.ReactNode;
}) {
  const trafficMap = useMemo(
    () => new Map(traffic.map((t) => [t.segmentId, t])),
    [traffic],
  );
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [basemap, setBasemap] = useState<Basemap>("plate");
  const [mapMode, setMapMode] = useState<MapMode>("points");
  const [layer, setLayer] = useState<MapLayerPayload | null>(null);
  const [selection, setSelection] = useState<AppState["selection"]>(null);
  const [highlight, setHighlight] = useState<AppState["highlight"]>(null);
  const [cursor, setCursor] = useState<AppState["cursor"]>(null);
  const [activeView, setActiveView] = useState<ViewKey>("explorer");
  const [role, setRole] = useState<"administrator" | "contributor">("administrator");

  const setFilters = useCallback((f: Partial<Filters>) => {
    setFiltersState((prev) => ({ ...prev, ...f }));
  }, []);
  const resetFilters = useCallback(() => setFiltersState(DEFAULT_FILTERS), []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const filtered = useMemo(() => {
    const from = Date.parse(filters.from);
    const to = Date.parse(filters.to);
    return accidents.filter((a) => {
      const t = Date.parse(a.occurredAt);
      if (Number.isFinite(from) && t < from) return false;
      if (Number.isFinite(to) && t > to) return false;
      if (filters.categories.length && !filters.categories.includes(a.categoryCode)) return false;
      if (filters.severities.length && !filters.severities.includes(a.severityCode)) return false;
      if (filters.statuses.length && !filters.statuses.includes(a.status)) return false;
      const hour = new Date(a.occurredAt).getUTCHours();
      if (hour < filters.hours[0] || hour > filters.hours[1]) return false;
      const dow = new Date(a.occurredAt).getUTCDay();
      if (!filters.days.includes(dow)) return false;
      if (filters.text) {
        const q = filters.text.toLowerCase();
        const hay = `${a.publicId} ${a.description ?? ""} ${a.streetName ?? ""} ${a.categoryLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accidents, filters]);

  // URL synchronisation (replaceState — no history spam).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams();
    p.set("view", activeView);
    p.set("mode", mapMode);
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    if (filters.categories.length) p.set("cat", filters.categories.join(","));
    if (filters.severities.length) p.set("sev", filters.severities.join(","));
    if (filters.statuses.length) p.set("st", filters.statuses.join(","));
    if (filters.hours[0] !== 0 || filters.hours[1] !== 23) p.set("h", filters.hours.join("-"));
    if (filters.days.length !== 7) p.set("dow", filters.days.join(","));
    if (filters.text) p.set("q", filters.text);
    window.history.replaceState(null, "", `?${p.toString()}`);
  }, [filters, activeView, mapMode]);

  const value: AppState = {
    accidents,
    segments,
    trafficMap,
    filters,
    setFilters,
    resetFilters,
    filtered,
    theme,
    toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    basemap,
    setBasemap,
    mapMode,
    setMapMode,
    layer,
    setLayer,
    selection,
    setSelection,
    highlight,
    setHighlight,
    cursor,
    setCursor,
    activeView,
    setActiveView,
    role,
    setRole,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Colour ramp helper used by every analytical layer producer. */
export function rampColour(value: number, stops: LegendStop[], ramp: "sequential" | "diverging"): string {
  if (!stops.length) return "transparent";
  if (value <= stops[0].value) return stops[0].colour;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (value >= a.value && value <= b.value) {
      const t = b.value === a.value ? 0 : (value - a.value) / (b.value - a.value);
      return mixHex(a.colour, b.colour, t);
    }
  }
  return stops[stops.length - 1].colour;
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
